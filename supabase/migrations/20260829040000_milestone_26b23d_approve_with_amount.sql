-- ============================================================================
-- MILESTONE 26B-23D — APPROVING A LOAN IS ONE ACT, SO IT IS ONE TRANSACTION
-- ============================================================================
--
-- 26B-23C shipped two separate operations: move the application to `approved`,
-- and record the amount. Performing an approval as two round trips would leave
-- a window in which the row says a loan was approved and does not say for how
-- much — or, worse, says an amount was decided for a file still under review.
-- Either state is a lie the database would be holding on ODL's behalf, and no
-- amount of care in the browser can close a window that exists on the server.
--
-- So the two writes and both of their audit events happen inside one function,
-- under one row lock, in one transaction. It commits completely or not at all.
--
-- ----------------------------------------------------------------------------
-- IT DOES NOT RE-ENCODE THE TRANSITION GRAPH
-- ----------------------------------------------------------------------------
-- APPLICATION_STATUS_TRANSITIONS lives in src/lib/config/application.ts and
-- stays the single definition of which move is legal. Exactly like
-- record_application_status_change, this function reproduces only the
-- `status = expected` guard, so a concurrent change matches zero rows and is
-- refused rather than silently overwritten. The caller decides that `approved`
-- is reachable; this function makes sure nothing moved underneath it.
--
-- ----------------------------------------------------------------------------
-- THE AMOUNT IS MANDATORY HERE, AND ONLY HERE
-- ----------------------------------------------------------------------------
-- An approval through this path cannot end with a null amount: the function
-- refuses one before it touches the row. That is the whole reason it exists as
-- something other than a convenience wrapper — the invariant is enforced where
-- it cannot be bypassed by a stale tab or a hand-made request, rather than by a
-- required field in a form.
--
-- It does NOT enforce any relationship to requested_amount. Approving more than
-- was asked for is legitimate business (26B-23C); the warning and the second
-- confirmation for that case belong in front of a human, not in a CHECK.
--
-- ----------------------------------------------------------------------------
-- REPLAY
-- ----------------------------------------------------------------------------
-- A second call carrying the same expected status finds a row that has already
-- moved to `approved`, matches nothing, and returns null. So a double click, a
-- retried request or a resubmitted form cannot approve twice, cannot append a
-- second pair of events, and — importantly — cannot quietly change the amount
-- of an approval that already happened. Changing a decided figure is a
-- different act and goes through set_application_approved_amount, which audits
-- it as the amendment it is.
-- ============================================================================

create or replace function public.approve_application_with_amount(
  p_application_id uuid,
  p_expected_status text,
  p_approved_amount numeric,
  p_source text,
  p_actor_profile_id uuid
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_client_id uuid;
  v_branch_id uuid;
  v_status    text;
  v_current   numeric(12,2);
  v_new       numeric(12,2);
begin
  -- There is no automated approval path and there should not be one, so an
  -- unidentified actor is refused rather than recorded as `system`.
  if p_actor_profile_id is null then
    raise exception 'approve_application_with_amount: an identified actor is required'
      using errcode = '22023';
  end if;

  -- applications_status_changed_by_source_check already requires this pairing
  -- for the row; refusing it up front gives a message that names the problem.
  if p_source is distinct from 'crm_manual' then
    raise exception 'approve_application_with_amount: source must be crm_manual, got %', p_source
      using errcode = '22023';
  end if;

  -- THE INVARIANT. An approval without a figure is not an approval.
  if p_approved_amount is null then
    raise exception 'approve_application_with_amount: an approved amount is required'
      using errcode = '22023';
  end if;
  if p_approved_amount <= 0 then
    raise exception 'approve_application_with_amount: the approved amount must be greater than zero'
      using errcode = '22023';
  end if;

  select client_id, branch_id, status, approved_amount
    into v_client_id, v_branch_id, v_status, v_current
    from public.applications
   where id = p_application_id
     for update;

  -- Unknown and out-of-scope must be indistinguishable to the caller.
  if not found then
    return null;
  end if;

  if not public.profile_has_operational_branch_scope(p_actor_profile_id, v_branch_id) then
    raise exception 'Out of branch scope.' using errcode = '42501';
  end if;

  -- Redundant with the expected-status guard below for every caller that reads
  -- the row first, and kept anyway: a draft is not an application ODL has
  -- received, and no path should be able to approve one.
  if v_status = 'draft' then
    raise exception 'approve_application_with_amount: a draft cannot be approved'
      using errcode = '22023';
  end if;

  -- Somebody else moved it between the caller's read and this lock.
  if v_status is distinct from p_expected_status then
    return null;
  end if;

  v_new := round(p_approved_amount, 2);

  update public.applications
     set approved_amount              = v_new,
         status                       = 'approved',
         status_changed_at            = now(),
         status_changed_by_profile_id = p_actor_profile_id,
         status_changed_source        = p_source
   where id = p_application_id
     and status = p_expected_status;

  if not found then
    return null;
  end if;

  -- Two events because two facts changed, and a reader of the activity feed
  -- looking for either one must find it under its own name. The amount event
  -- is skipped when the figure was already there — re-stating a number is not
  -- a decision, and the approval event alone tells that story truthfully.
  if v_current is distinct from v_new then
    insert into public.crm_events (
      event_type, entity_type, entity_id, client_id, application_id,
      actor_profile_id, actor_kind, source, previous_value, new_value, branch_id
    ) values (
      'application_approved_amount_changed', 'application', p_application_id,
      v_client_id, p_application_id,
      p_actor_profile_id, 'human', p_source,
      jsonb_build_object('approvedAmount', v_current),
      jsonb_build_object('approvedAmount', v_new),
      v_branch_id
    );
  end if;

  -- Same shape record_application_status_change writes, so the feed renders an
  -- approval identically however it was performed.
  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value, branch_id
  ) values (
    'application_status_changed', 'application', p_application_id,
    v_client_id, p_application_id,
    p_actor_profile_id, 'human', p_source,
    jsonb_build_object('status', p_expected_status),
    jsonb_build_object('status', 'approved'),
    v_branch_id
  );

  return 'approved';
end;
$function$;

comment on function public.approve_application_with_amount(uuid, text, numeric, text, uuid) is
  'MILESTONE 26B-23D. Approves an application and records the amount ODL '
  'decided to lend, with both audit events, in one transaction under one row '
  'lock. Returns ''approved'', or null when the application does not exist or '
  'its status moved away from p_expected_status. Refuses a null actor, a source '
  'other than crm_manual, a null or non-positive amount, an application outside '
  'the actor''s branch scope, and a draft. An approval performed through this '
  'function can never end with a null approved_amount. Does not re-encode the '
  'transition graph: the caller decides the move is legal, this reproduces only '
  'the status = expected guard.';

revoke all on function public.approve_application_with_amount(uuid, text, numeric, text, uuid) from public;
revoke all on function public.approve_application_with_amount(uuid, text, numeric, text, uuid) from anon;
revoke all on function public.approve_application_with_amount(uuid, text, numeric, text, uuid) from authenticated;
grant execute on function public.approve_application_with_amount(uuid, text, numeric, text, uuid) to service_role;
