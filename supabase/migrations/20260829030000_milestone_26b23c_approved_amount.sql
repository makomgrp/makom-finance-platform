-- ============================================================================
-- MILESTONE 26B-23C — WHAT THE CUSTOMER ASKED FOR, AND WHAT ODL DECIDED
-- ============================================================================
--
-- `requested_amount` is the applicant's own figure. It is immutable by design
-- (there is no update path for it anywhere in the codebase) because it is a
-- record of what somebody asked for, and rewriting it to the approved figure
-- would destroy the only evidence of the request. ODL's answer therefore needs
-- a column of its own.
--
-- A customer asks for B/. 5,000 and is approved B/. 2,000. Both numbers matter,
-- both stay, and neither is derived from the other.
--
-- ----------------------------------------------------------------------------
-- NULLABLE, AND ZERO IS NOT A DECISION
-- ----------------------------------------------------------------------------
-- NULL means "ODL has not decided an amount yet" — which is the state of every
-- application the moment it is created and of most of them for most of their
-- life. No default: a default of 0 would make every new application look like
-- it had been approved for nothing, and the difference between "not decided"
-- and "decided to lend nothing" would be unrecoverable.
--
-- The CHECK is `IS NULL OR > 0`, not `>= 0`, for the same reason. An approved
-- amount of zero is not an approval; it is a refusal, and a refusal is recorded
-- by moving the application to `not_eligible`, not by approving nothing. This
-- mirrors application_intakes_requested_amount_check exactly, which is this
-- schema's existing shape for a nullable loan amount.
--
-- ----------------------------------------------------------------------------
-- NO CONSTRAINT TIES IT TO requested_amount — DELIBERATELY
-- ----------------------------------------------------------------------------
-- Approving MORE than was requested is legitimate business: an advisor may see
-- capacity the applicant did not ask for. A CHECK forbidding it would encode a
-- policy ODL has explicitly not adopted, and would be discovered as a constraint
-- violation by whoever tried to do their job. The guard rail for that case is a
-- warning and an explicit confirmation in the interface (26B-23D), which is
-- where a human can consider it — not a wall in the database.
--
-- ----------------------------------------------------------------------------
-- WHY THIS MIGRATION ALSO CARRIES AN RPC
-- ----------------------------------------------------------------------------
-- `crm_events` grants `service_role` SELECT and nothing else. The application
-- server holds the service key, so it CANNOT append an audit row on its own —
-- by design, since 26B-20. Every audited write in this system therefore happens
-- inside a SECURITY DEFINER function that performs the UPDATE and the event in
-- one transaction, and this one is no exception. Shipping the column without
-- the function would leave the only available write path an unaudited direct
-- UPDATE, which is precisely what the audit trail exists to prevent.
--
-- The event type is new vocabulary, so the CHECK that lists them has to learn
-- it. `entity_type` needs nothing: 'application' is already in its list.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. THE COLUMN
-- ----------------------------------------------------------------------------

alter table public.applications
  add column approved_amount numeric(12,2);

alter table public.applications
  add constraint applications_approved_amount_check
  check (approved_amount is null or approved_amount > 0);

comment on column public.applications.approved_amount is
  'MILESTONE 26B-23C. The amount ODL decided to lend, in the same numeric(12,2) '
  'money shape as requested_amount. NULL means no economic decision has been '
  'made yet; it is never a synonym for zero, and the CHECK forbids storing zero '
  'so the two can never be confused. Deliberately unconstrained relative to '
  'requested_amount: approving more than was asked for is legitimate, and the '
  'confirmation for that case belongs in the interface, not here. Written only '
  'through set_application_approved_amount().';

-- ----------------------------------------------------------------------------
-- 2. THE AUDIT VOCABULARY
-- ----------------------------------------------------------------------------
-- Rewritten in full rather than patched, because a CHECK cannot be extended in
-- place. Every existing value is carried over unchanged; the only difference is
-- the last entry.

alter table public.crm_events
  drop constraint crm_events_event_type_check;

alter table public.crm_events
  add constraint crm_events_event_type_check
  check (event_type = any (array[
    'application_status_changed',
    'requirement_status_changed',
    'alert_resolved',
    'alert_reactivated',
    'client_status_changed',
    'client_profile_updated',
    'application_advisor_assigned',
    'client_restriction_changed',
    'user_invited',
    'user_role_changed',
    'user_deactivated',
    'user_reactivated',
    'user_capability_granted',
    'user_capability_revoked',
    'branch_created',
    'branch_updated',
    'branch_deactivated',
    'profile_branch_assigned',
    'profile_branch_removed',
    'profile_branch_scope_changed',
    'client_branch_transferred',
    'application_branch_transferred',
    'email_sent',
    'email_linked',
    'email_unlinked',
    'application_review_recommended',
    'application_review_completed',
    'application_review_reopened',
    -- MILESTONE 26B-23C
    'application_approved_amount_changed'
  ]));

-- ----------------------------------------------------------------------------
-- 3. THE ONLY WRITE PATH
-- ----------------------------------------------------------------------------
-- Modelled directly on record_application_status_change: the same row lock, the
-- same branch-scope check, the same one-transaction pairing of the write with
-- its audit event.
--
-- IT DOES NOT TOUCH `status`. Recording an amount is not an approval. The
-- lending determination keeps going through its own function, so setting a
-- figure can never silently approve a loan and approving a loan can never
-- silently invent a figure.
--
-- AN IDENTIFIED HUMAN IS REQUIRED. There is no automated path to this decision
-- and there should not be one, so a null actor is refused rather than recorded
-- as `system`. `applications_status_changed_by_source_check` already forces the
-- pairing of a named actor with `crm_manual` elsewhere in this table, and the
-- same pairing is required here.
--
-- A DRAFT IS REFUSED. It has no official number, it is absent from the
-- register, and it can still be abandoned by the employee who created it —
-- there is nothing yet for ODL to have decided an amount about. Which of the
-- formal states should accept one is a workflow question for 26B-23D; this
-- function forbids only the state that is unambiguously wrong today.
--
-- AN UNCHANGED VALUE WRITES NOTHING. Re-submitting the same figure is not a
-- decision, and an audit trail that records it would bury the real ones.

create or replace function public.set_application_approved_amount(
  p_application_id uuid,
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
  if p_actor_profile_id is null then
    raise exception 'set_application_approved_amount: an identified actor is required'
      using errcode = '22023';
  end if;

  if p_source is distinct from 'crm_manual' then
    raise exception 'set_application_approved_amount: source must be crm_manual, got %', p_source
      using errcode = '22023';
  end if;

  select client_id, branch_id, status, approved_amount
    into v_client_id, v_branch_id, v_status, v_current
    from public.applications
   where id = p_application_id
     for update;

  -- Unknown id and out-of-scope id must be indistinguishable to the caller, so
  -- this returns the same null the status function returns.
  if not found then
    return null;
  end if;

  if not public.profile_has_operational_branch_scope(p_actor_profile_id, v_branch_id) then
    raise exception 'Out of branch scope.' using errcode = '42501';
  end if;

  if v_status = 'draft' then
    raise exception 'set_application_approved_amount: a draft has no approved amount'
      using errcode = '22023';
  end if;

  -- Rounded to the column's own scale before comparing, so 2000 and 2000.004
  -- are recognised as the same stored value rather than producing an event that
  -- records a change nobody made.
  v_new := round(p_approved_amount, 2);

  if v_current is not distinct from v_new then
    return 'unchanged';
  end if;

  update public.applications
     set approved_amount = v_new
   where id = p_application_id;

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

  return 'updated';
end;
$function$;

comment on function public.set_application_approved_amount(uuid, numeric, text, uuid) is
  'MILESTONE 26B-23C. Records ODL''s decided lending amount and its audit event '
  'in one transaction. Returns ''updated'', ''unchanged'' when the value already '
  'matched, or null when the application does not exist. Refuses a null actor, '
  'a source other than crm_manual, an application outside the actor''s branch '
  'scope, and a draft. Never changes status: recording an amount is not an '
  'approval.';

revoke all on function public.set_application_approved_amount(uuid, numeric, text, uuid) from public;
revoke all on function public.set_application_approved_amount(uuid, numeric, text, uuid) from anon;
revoke all on function public.set_application_approved_amount(uuid, numeric, text, uuid) from authenticated;
grant execute on function public.set_application_approved_amount(uuid, numeric, text, uuid) to service_role;
