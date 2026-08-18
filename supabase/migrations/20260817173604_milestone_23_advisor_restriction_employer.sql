-- ============================================================================
-- Milestone 23 — Advisor assignment, client restriction, free-text employer
-- ============================================================================
--
-- PURPOSE. The Milestone 22 pre-go-live audit found three gaps that block a
-- credible Phase 1, all of them small and all of them here:
--
--   1. `assignApplicationAdvisor()` existed in the service layer with NO
--      Server Action and NO UI. ODL could not assign a file to an advisor.
--   2. `setClientRestricted()` existed the same way — unreachable.
--   3. Employer was a closed list of 10 fabricated companies
--      (`clients.company_legacy_id` -> a static COMPANIES array). A real
--      advisor entering a real client could only pick a wrong employer or
--      leave it blank.
--
-- Both (1) and (2) already had reserved audit vocabulary waiting for them —
-- `application_advisor_assigned` and `client_restriction_changed` were added
-- to crm_events_event_type_check by Milestone 20 and have never been written,
-- precisely because the mutations had no reachable caller. This migration
-- makes them real. NO new event type and NO new entity type is introduced.
--
-- ----------------------------------------------------------------------------
-- WHY RPCs RATHER THAN DIRECT UPDATES
-- ----------------------------------------------------------------------------
-- Unchanged from Milestone 20, and restated because it is the whole reason
-- these functions exist. PostgREST makes every call its own transaction, so an
-- UPDATE followed by a separate INSERT is two transactions: a crash between
-- them leaves a mutation with no audit record. And `service_role` deliberately
-- has NO INSERT privilege on crm_events, so the application layer *cannot*
-- write an event even if it wanted to. SECURITY DEFINER functions owned by
-- `postgres` are the only path — mutation and event commit together or not at
-- all.
--
-- THIS MIGRATION GRANTS NO NEW TABLE PRIVILEGE TO ANYONE. crm_events remains
-- append-only-by-privilege-withholding: service_role still cannot INSERT.
--
-- ----------------------------------------------------------------------------
-- PRIVACY RULE — INHERITED FROM MILESTONE 20, NOT RELAXED
-- ----------------------------------------------------------------------------
-- crm_events is append-only with no delete path, so anything written here can
-- never be corrected or erased. Therefore:
--
--   * The advisor event stores advisor PROFILE IDs only. No name, no e-mail,
--     no role. `profiles` is where staff identity lives; a UUID resolves to it
--     at read time and stays correctable there.
--   * The restriction event stores the boolean before/after and nothing else.
--     No client name, no identification number, no reason text (the schema has
--     no reason column — see below), no PII of any kind.
--
-- ----------------------------------------------------------------------------
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
-- ----------------------------------------------------------------------------
--   * No fixture data is deleted. Not one row. The production cleanup is a
--     separate, reviewed, UNAPPLIED draft in supabase/cutover/.
--   * No profile is modified, no auth user is touched, no storage object is
--     removed, no sequence is reset.
--   * No `restriction_reason` column is invented. The clients table has no
--     such column and Milestone 23 does not add one — a restriction reason is
--     a real product decision, and the honest Phase 1 answer is that staff
--     record the why in `observations` or a dossier note, both of which
--     already exist and are already attributed.
--   * No companies table. Free-text employer is the approved Phase 1
--     direction; normalisation waits until employer-based lending rules
--     actually exist.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- A. clients.employer_name — the honest Phase 1 employer field
-- ----------------------------------------------------------------------------
-- NULLABLE and with NO default, on purpose. NULL means "we did not ask" /
-- "not recorded", which is a true statement about a client record; empty
-- string would be a fabricated answer to a question nobody asked.
--
-- company_legacy_id is DELIBERATELY LEFT IN PLACE and DELIBERATELY NOT
-- REPURPOSED. It holds 'c-001'..'c-010' on all 17 fixture clients, and those
-- codes resolve through the static COMPANIES bridge to display an employer
-- name for rows that predate this column. Overwriting it, or reusing it to
-- store free text, would silently destroy the only thing that still renders
-- those rows correctly, and would mix two different meanings in one column.
--
-- Forward rule, enforced in the service layer (src/lib/services/clients.ts):
-- NEW clients write employer_name and NEVER write company_legacy_id. The
-- legacy column is read-only fallback from here on, and becomes droppable
-- once the fixture clients are purged at cutover.
alter table public.clients
  add column if not exists employer_name text;

comment on column public.clients.employer_name is
  'Free-text employer name as given by the client (Milestone 23). NULL means '
  'not recorded — never an empty string. This is the ONLY employer field new '
  'clients write. The older company_legacy_id resolves a fixture client to '
  'the static COMPANIES list and is retained ONLY as a display fallback for '
  'rows created before this column existed; it is never written by the CRM '
  'any more and becomes droppable once the Milestone 23 cutover cleanup has '
  'removed the fixture clients. Deliberately free text, not a foreign key: a '
  'companies table without employer-based lending rules would be '
  'normalisation for its own sake, and Phase 1 needs to record what the '
  'advisor was actually told.';


-- ----------------------------------------------------------------------------
-- B. record_client_profile_update — extended to see employer_name
-- ----------------------------------------------------------------------------
-- WHY A DROP IS REQUIRED. PostgreSQL identifies a function by its argument
-- list, so adding p_employer_name via CREATE OR REPLACE would create a second,
-- overloaded function and leave the 14-argument version in place — two
-- functions, one of which silently cannot see the new field. The old signature
-- is therefore dropped and replaced by the 15-argument one.
--
-- WITHOUT THIS, editing a client's employer would change the row and write NO
-- audit event: the diff loop would simply never look at the column. That is a
-- silent auditability regression, which is exactly what Milestone 20 exists to
-- prevent.
--
-- EVERYTHING ELSE IS BYTE-FOR-BYTE THE MILESTONE 20A BODY: same parameter
-- order (the new one appended before p_actor_profile_id, keeping the actor
-- last as in every other function here), same SECURITY DEFINER, same
-- search_path, same `for update` lock, same `is distinct from` diffing, same
-- array_append fix from Milestone 20A, same FIELD-NAMES-ONLY privacy rule,
-- same no-op and not-found semantics. One new branch, one new UPDATE column.
drop function if exists public.record_client_profile_update(
  uuid, text, text, text, text, text, text, text, text, numeric, date, text, text, uuid
);

create or replace function public.record_client_profile_update(
  p_client_id uuid,
  p_full_name text,
  p_identification_type text,
  p_identification_number text,
  p_phone text,
  p_email text,
  p_address text,
  p_company_legacy_id text,
  p_position text,
  p_monthly_salary numeric,
  p_birth_date date,
  p_nationality text,
  p_observations text,
  p_employer_name text,
  p_actor_profile_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current public.clients%rowtype;
  v_fields text[] := array[]::text[];
begin
  select * into v_current
  from public.clients
  where id = p_client_id
  for update;

  if v_current.id is null then
    return null;
  end if;

  -- `is distinct from` throughout: company_legacy_id, observations and
  -- employer_name are nullable, and `<>` would evaluate to NULL rather than
  -- TRUE when one side is null, silently missing a real change.
  if v_current.full_name             is distinct from p_full_name             then v_fields := array_append(v_fields, 'fullName'); end if;
  if v_current.identification_type   is distinct from p_identification_type   then v_fields := array_append(v_fields, 'identificationType'); end if;
  if v_current.identification_number is distinct from p_identification_number then v_fields := array_append(v_fields, 'identificationNumber'); end if;
  if v_current.phone                 is distinct from p_phone                 then v_fields := array_append(v_fields, 'phone'); end if;
  if v_current.email                 is distinct from p_email                 then v_fields := array_append(v_fields, 'email'); end if;
  if v_current.address               is distinct from p_address               then v_fields := array_append(v_fields, 'address'); end if;
  if v_current.company_legacy_id     is distinct from p_company_legacy_id     then v_fields := array_append(v_fields, 'companyLegacyId'); end if;
  if v_current."position"            is distinct from p_position              then v_fields := array_append(v_fields, 'position'); end if;
  if v_current.monthly_salary        is distinct from p_monthly_salary        then v_fields := array_append(v_fields, 'monthlySalary'); end if;
  if v_current.birth_date            is distinct from p_birth_date            then v_fields := array_append(v_fields, 'birthDate'); end if;
  if v_current.nationality           is distinct from p_nationality           then v_fields := array_append(v_fields, 'nationality'); end if;
  if v_current.observations          is distinct from p_observations          then v_fields := array_append(v_fields, 'observations'); end if;
  if v_current.employer_name         is distinct from p_employer_name         then v_fields := array_append(v_fields, 'employerName'); end if;

  -- Nothing genuinely changed. The existing service treats a no-change save as
  -- a success and returns the row, so this does too — without fabricating an
  -- event for an edit that edited nothing.
  if array_length(v_fields, 1) is null then
    return p_client_id;
  end if;

  update public.clients
  set full_name             = p_full_name,
      identification_type   = p_identification_type,
      identification_number = p_identification_number,
      phone                 = p_phone,
      email                 = p_email,
      address               = p_address,
      company_legacy_id     = p_company_legacy_id,
      "position"            = p_position,
      monthly_salary        = p_monthly_salary,
      birth_date            = p_birth_date,
      nationality           = p_nationality,
      observations          = p_observations,
      employer_name         = p_employer_name
  where id = p_client_id;

  -- FIELD NAMES ONLY. Never the values. See the Milestone 20 header.
  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value
  ) values (
    'client_profile_updated', 'client', p_client_id,
    p_client_id, null,
    p_actor_profile_id,
    case when p_actor_profile_id is null then 'system' else 'human' end,
    'crm_manual',
    null,
    jsonb_build_object('changedFields', to_jsonb(v_fields))
  );

  return p_client_id;
end;
$$;


-- ----------------------------------------------------------------------------
-- C. record_application_advisor_assignment
-- ----------------------------------------------------------------------------
-- Assigns, REASSIGNS or UNASSIGNS the advisor who owns an application, and
-- appends the reserved `application_advisor_assigned` event atomically.
--
-- NO TRANSITION GRAPH, deliberately — unlike application status, there is no
-- legality question here: any advisor may replace any other at any time, and
-- unassigning (NULL) is a legitimate state the column has always allowed.
-- This mirrors the existing assignApplicationAdvisor() semantics exactly; the
-- function is not tightening them, only making them auditable.
--
-- ACTIVE-PROFILE CHECK. The foreign key already guarantees the profile
-- EXISTS. This additionally refuses a DEACTIVATED profile, because assigning
-- a file to someone who cannot sign in (getCurrentProfile() rejects inactive
-- profiles) creates an application nobody owns in practice. Raised as 22023 so
-- the service layer can map it to a precise, non-probing error.
--
-- Returns the application id, or NULL when no such application exists — the
-- same NULL-means-not-found convention every Milestone 20 function uses. A
-- no-op reassignment (same advisor, including NULL -> NULL) returns the id and
-- writes NO event.
create or replace function public.record_application_advisor_assignment(
  p_application_id uuid,
  p_advisor_profile_id uuid,
  p_actor_profile_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_previous_advisor uuid;
  v_client_id uuid;
  v_found boolean := false;
begin
  select assigned_advisor_profile_id, client_id, true
    into v_previous_advisor, v_client_id, v_found
  from public.applications
  where id = p_application_id
  for update;

  -- No such application. The caller maps NULL to its NOT_FOUND code.
  -- Tested on the sentinel rather than on v_previous_advisor, which is
  -- legitimately NULL for an unassigned application that DOES exist.
  if not v_found then
    return null;
  end if;

  if p_advisor_profile_id is not null then
    if not exists (
      select 1 from public.profiles
      where id = p_advisor_profile_id and active
    ) then
      raise exception
        'Advisor profile % does not exist or is not active.', p_advisor_profile_id
        using errcode = '22023';
    end if;
  end if;

  -- Genuine no-op, including NULL -> NULL. Success, but no event: a trail of
  -- non-changes is noise, not history.
  if v_previous_advisor is not distinct from p_advisor_profile_id then
    return p_application_id;
  end if;

  update public.applications
  set assigned_advisor_profile_id = p_advisor_profile_id
  where id = p_application_id;

  -- IDs only — never staff name, e-mail or role. See the privacy rule above.
  -- previous_value is omitted entirely (NULL) when the application had no
  -- advisor, rather than writing {"advisorProfileId": null}: "there was no
  -- previous assignment" and "the previous assignment was nobody" are the same
  -- fact, and one representation is enough.
  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value
  ) values (
    'application_advisor_assigned', 'application', p_application_id,
    v_client_id, p_application_id,
    p_actor_profile_id,
    case when p_actor_profile_id is null then 'system' else 'human' end,
    'crm_manual',
    case
      when v_previous_advisor is null then null
      else jsonb_build_object('advisorProfileId', v_previous_advisor)
    end,
    case
      when p_advisor_profile_id is null then jsonb_build_object('advisorProfileId', null)
      else jsonb_build_object('advisorProfileId', p_advisor_profile_id)
    end
  );

  return p_application_id;
end;
$$;


-- ----------------------------------------------------------------------------
-- D. record_client_restriction_change
-- ----------------------------------------------------------------------------
-- Toggles the compliance/risk flag and appends the reserved
-- `client_restriction_changed` event atomically.
--
-- NEVER TOUCHES `status`. clients.status and clients.restricted are a
-- deliberate split (see the clients table migration's column comment): a
-- restricted client may still be `activo`, and restricting is not a lifecycle
-- transition. This function changes exactly one boolean.
--
-- THE EVENT CARRIES NO CLIENT PII AND NO REASON TEXT. There is no reason
-- column in this schema and Milestone 23 does not invent one. Two booleans is
-- the entire truthful before/after.
--
-- Returns the client id, or NULL when no such client exists. A no-op (already
-- in the requested state) returns the id and writes NO event.
create or replace function public.record_client_restriction_change(
  p_client_id uuid,
  p_restricted boolean,
  p_actor_profile_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_previous_restricted boolean;
begin
  select restricted into v_previous_restricted
  from public.clients
  where id = p_client_id
  for update;

  -- clients.restricted is NOT NULL, so a NULL here can only mean "no such
  -- client" — unlike the advisor function above, no separate sentinel needed.
  if v_previous_restricted is null then
    return null;
  end if;

  if v_previous_restricted = p_restricted then
    return p_client_id;
  end if;

  update public.clients
  set restricted = p_restricted
  where id = p_client_id;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value
  ) values (
    'client_restriction_changed', 'client', p_client_id,
    p_client_id, null,
    p_actor_profile_id,
    case when p_actor_profile_id is null then 'system' else 'human' end,
    'crm_manual',
    jsonb_build_object('restricted', v_previous_restricted),
    jsonb_build_object('restricted', p_restricted)
  );

  return p_client_id;
end;
$$;


-- ----------------------------------------------------------------------------
-- E. Execute privileges — same posture as every other function here
-- ----------------------------------------------------------------------------
-- These functions can reassign ownership of a loan file and set a compliance
-- flag. Nothing that reaches the database as `anon` or `authenticated` may
-- call them; only the server-side service_role client can, and it can only
-- reach them through a Server Action that has already passed
-- requireCapability(). CREATE OR REPLACE preserves existing privileges, so the
-- restated block is idempotent — it keeps the intended posture visible in the
-- schema history rather than implied.
revoke execute on function public.record_client_profile_update(uuid, text, text, text, text, text, text, text, text, numeric, date, text, text, text, uuid) from public;
revoke execute on function public.record_application_advisor_assignment(uuid, uuid, uuid) from public;
revoke execute on function public.record_client_restriction_change(uuid, boolean, uuid) from public;

revoke execute on function public.record_client_profile_update(uuid, text, text, text, text, text, text, text, text, numeric, date, text, text, text, uuid) from anon, authenticated;
revoke execute on function public.record_application_advisor_assignment(uuid, uuid, uuid) from anon, authenticated;
revoke execute on function public.record_client_restriction_change(uuid, boolean, uuid) from anon, authenticated;

grant execute on function public.record_client_profile_update(uuid, text, text, text, text, text, text, text, text, numeric, date, text, text, text, uuid) to service_role;
grant execute on function public.record_application_advisor_assignment(uuid, uuid, uuid) to service_role;
grant execute on function public.record_client_restriction_change(uuid, boolean, uuid) to service_role;
