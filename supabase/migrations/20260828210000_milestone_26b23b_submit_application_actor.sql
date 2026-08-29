-- ============================================================================
-- MILESTONE 26B-23B — WHO FORMALISED THIS APPLICATION?
-- ============================================================================
--
-- `submit_application` was written for the public portal, where the honest
-- answer to that question is "nobody at ODL" — an applicant pressed a button on
-- their own form, and a public applicant is not a CRM profile. So the function
-- hardcoded `actor_kind = 'system'` and a null actor, which is exactly right
-- for that caller.
--
-- Staff formalising a manual application is a different act by a named person,
-- and the audit trail should say so. Recording it as `system` would leave the
-- Activity tab claiming the CRM did it by itself.
--
-- ----------------------------------------------------------------------------
-- ONE FUNCTION, NOT TWO
-- ----------------------------------------------------------------------------
-- A separate `submit_application_manual` would be a second place that allocates
-- official numbers — two implementations of the one operation that must never
-- run twice, free to drift on locking, idempotency or the transition. The actor
-- is passed in instead, and everything else stays identical.
--
-- ----------------------------------------------------------------------------
-- WHY DROP AND RECREATE RATHER THAN `create or replace`
-- ----------------------------------------------------------------------------
-- Adding a parameter changes the signature, so `create or replace` would leave
-- the two-argument version in place beside the new one. Two functions with the
-- same name, one of which still writes `system`, is precisely the drift this
-- migration exists to avoid. The old signature is dropped so only one remains.
--
-- The portal's call is unaffected: it passes `p_application_id` and `p_source`
-- by name, and the new parameter defaults to null — which is the portal's
-- correct value anyway.
--
-- ----------------------------------------------------------------------------
-- THE ACTOR IMPLIES THE SOURCE, AND THE DATABASE ALREADY SAYS SO
-- ----------------------------------------------------------------------------
-- `applications_status_changed_by_source_check` and
-- `crm_events_actor_source_check` both require that naming a profile means
-- `crm_manual`. Rather than let a caller discover that as a constraint
-- violation two statements later, the combination is refused up front with a
-- message that says which pair is wrong.
--
-- SECURITY DEFINER, the search_path pin and the service_role-only grant are
-- carried over unchanged. `authenticated` and `anon` cannot execute this, which
-- is what makes `p_actor_profile_id` trustworthy: the only callers able to
-- supply it are server-side ones already holding the service key.
-- ============================================================================

drop function if exists public.submit_application(uuid, text);

create function public.submit_application(
  p_application_id uuid,
  p_source text,
  p_actor_profile_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_number     text;
  v_status     text;
  v_product    uuid;
  v_client_id  uuid;
  v_branch_id  uuid;
  v_actor_kind text;
begin
  if p_source is null or p_source not in ('crm_manual','website_form','whatsapp','email','ai') then
    raise exception 'submit_application: invalid source %', p_source
      using errcode = '22023';
  end if;

  -- Refused here rather than surfacing as a CHECK violation further down.
  if p_actor_profile_id is not null and p_source is distinct from 'crm_manual' then
    raise exception
      'submit_application: an identified actor may only submit with source crm_manual, got %', p_source
      using errcode = '22023';
  end if;

  v_actor_kind := case when p_actor_profile_id is null then 'system' else 'human' end;

  select application_number, status, product_id, client_id, branch_id
    into v_number, v_status, v_product, v_client_id, v_branch_id
    from public.applications
   where id = p_application_id
     for update;

  if not found then
    raise exception 'submit_application: application % does not exist', p_application_id
      using errcode = '23503';
  end if;

  -- Already carries a number: already submitted. Report the number it owns
  -- rather than issuing a second one — and, just as importantly, do not append
  -- a second submission event. Every idempotency guarantee this function makes
  -- comes from this early return sitting above both writes.
  if v_number is not null then
    return v_number;
  end if;

  v_number := public.generate_application_number(v_product);

  update public.applications
     set application_number       = v_number,
         status                   = 'in_review',
         status_changed_at        = now(),
         status_changed_source    = p_source,
         -- Null for the portal, exactly as before; the person for a manual
         -- formalisation. The CHECK above guarantees the pairing is legal.
         status_changed_by_profile_id = p_actor_profile_id
   where id = p_application_id;

  -- Same shape record_application_status_change() writes, so the Activity feed
  -- renders a portal submission and a staff transition identically.
  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value, branch_id
  ) values (
    'application_status_changed', 'application', p_application_id,
    v_client_id, p_application_id,
    p_actor_profile_id, v_actor_kind, p_source,
    jsonb_build_object('status', v_status),
    jsonb_build_object('status', 'in_review'),
    v_branch_id
  );

  return v_number;
end;
$function$;

comment on function public.submit_application(uuid, text, uuid) is
  'MILESTONE 26B-5, audit restored in 26B-5A, actor added in 26B-23B. The formal '
  'submission boundary: locks the draft, allocates the official number exactly '
  'once, transitions draft -> in_review, and appends the '
  'application_status_changed audit event — all in one transaction. Idempotent: '
  'a row that already has a number returns unchanged and appends nothing, so '
  'retries and simultaneous submits never consume a second number or duplicate '
  'the event. p_actor_profile_id is null for the public portal (actor_kind '
  'system) and the formalising employee for a CRM submission (actor_kind human), '
  'which the database only permits with source crm_manual.';

revoke all on function public.submit_application(uuid, text, uuid) from public;
revoke all on function public.submit_application(uuid, text, uuid) from anon;
revoke all on function public.submit_application(uuid, text, uuid) from authenticated;
grant execute on function public.submit_application(uuid, text, uuid) to service_role;
