-- ============================================================================
-- MILESTONE 26B-5A — FORMAL SUBMISSION MUST LEAVE AN AUDIT TRAIL
-- ============================================================================
--
-- A REGRESSION INTRODUCED BY 26B-5, FOUND BY COMPARING TWO REAL SUBMISSIONS.
--
-- Before 26B-5 the portal submitted through setApplicationStatus(), which calls
-- record_application_status_change() — and that function appends an
-- `application_status_changed` row to crm_events in the same transaction as the
-- UPDATE. 26B-5 replaced that call with submit_application(), because the
-- number and the transition have to be allocated together, and in doing so it
-- stopped writing the event.
--
-- The evidence was unambiguous: the application submitted under the old path
-- has an application_status_changed event; the one submitted under the new path
-- has only its requirement events, and no record that it was ever submitted.
-- The Activity tab would simply not show the single most important thing that
-- ever happened to the application.
--
-- The event is appended HERE, inside the same function and therefore the same
-- transaction as the number allocation and the status change — the same
-- guarantee record_application_status_change() gives. It cannot be written for
-- a submission that did not happen, and a submission cannot happen without it.
--
-- EXACTLY ONCE, for free: the append sits after the early return that makes
-- this function idempotent. A retry or a concurrent second submit finds the row
-- already numbered, returns, and never reaches the insert. No guard is needed
-- because the guard already exists.
--
-- Actor is null and actor_kind is 'system': a public applicant is not a CRM
-- profile, which is exactly what the existing function does for automated
-- sources too.
create or replace function public.submit_application(
  p_application_id uuid,
  p_source text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_number    text;
  v_status    text;
  v_product   uuid;
  v_client_id uuid;
  v_branch_id uuid;
begin
  if p_source is null or p_source not in ('crm_manual','website_form','whatsapp','email','ai') then
    raise exception 'submit_application: invalid source %', p_source
      using errcode = '22023';
  end if;

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
  -- a second submission event.
  if v_number is not null then
    return v_number;
  end if;

  v_number := public.generate_application_number(v_product);

  update public.applications
     set application_number     = v_number,
         status                 = 'in_review',
         status_changed_at      = now(),
         status_changed_source  = p_source
   where id = p_application_id;

  -- Same shape record_application_status_change() writes, so the Activity feed
  -- renders a portal submission and a staff transition identically.
  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value, branch_id
  ) values (
    'application_status_changed', 'application', p_application_id,
    v_client_id, p_application_id,
    null, 'system', p_source,
    jsonb_build_object('status', v_status),
    jsonb_build_object('status', 'in_review'),
    v_branch_id
  );

  return v_number;
end;
$function$;

comment on function public.submit_application(uuid, text) is
  'MILESTONE 26B-5, audit restored in 26B-5A. The formal submission boundary: '
  'locks the draft, allocates the official number exactly once, transitions '
  'draft -> in_review, and appends the application_status_changed audit event — '
  'all in one transaction. Idempotent: a row that already has a number returns '
  'unchanged and appends nothing, so retries and simultaneous submits never '
  'consume a second number or duplicate the event.';

revoke all on function public.submit_application(uuid, text) from public;
revoke all on function public.submit_application(uuid, text) from anon;
revoke all on function public.submit_application(uuid, text) from authenticated;
grant execute on function public.submit_application(uuid, text) to service_role;
