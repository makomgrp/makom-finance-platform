-- ============================================================================
-- Milestone 20A — Fix record_client_profile_update's field-name array append
-- ============================================================================
--
-- CORRECTIVE MIGRATION. 20260817095539_milestone_20_crm_audit_trail deployed
-- successfully and is historical fact: it is NOT amended, rewritten or
-- re-run. This migration replaces one function body and changes nothing else.
--
-- ----------------------------------------------------------------------------
-- THE DEFECT
-- ----------------------------------------------------------------------------
-- Runtime verification of the Milestone 20 deployment found that
-- record_client_profile_update raised, on every edit that changed a field:
--
--   ERROR:  22P02: malformed array literal: "phone"
--   DETAIL: Array value must start with "{" or dimension information.
--   QUERY:  v_fields := v_fields || 'phone'
--
-- ROOT CAUSE. In `text[] || 'literal'`, PostgreSQL resolves the untyped
-- literal to text[] and applies the array-to-ARRAY concatenation operator,
-- so it tries to parse 'phone' as an array literal — rather than resolving
-- it to text and applying array-to-ELEMENT concatenation. All twelve
-- editable-field branches were written this way.
--
-- IMPACT. The function threw whenever any field genuinely changed, so
-- updateClientProfileAction would have failed for every real client edit.
-- The no-change and client-not-found paths were unaffected. Nothing was ever
-- corrupted: the exception aborted the whole function, which incidentally
-- demonstrated that the milestone's atomicity design works — neither the
-- client UPDATE nor the crm_events INSERT survived.
--
-- Static review missed this because it is a PL/pgSQL type-resolution
-- subtlety, not a logic error. It is exactly what runtime verification is for.
--
-- ----------------------------------------------------------------------------
-- THE CORRECTION — MECHANICAL, AND NOTHING ELSE
-- ----------------------------------------------------------------------------
--   v_fields := v_fields || 'fullName';            -- ambiguous, throws
--   v_fields := array_append(v_fields, 'fullName') -- unambiguous
--
-- array_append(text[], text) has no ambiguity to resolve. Applied to all
-- twelve branches and to nothing else.
--
-- The body below was produced by taking the DEPLOYED function definition from
-- 20260817095539 verbatim and applying only that substitution: 12 of its 93
-- lines differ, and every differing line is one of those twelve appends.
--
-- DELIBERATELY UNCHANGED: parameters and their order, return type, SECURITY
-- DEFINER, owner, search_path, row locking (`for update`), the diff via
-- `is distinct from`, the UPDATE, actor and source handling, the crm_events
-- insert structure, the FIELD-NAMES-ONLY privacy rule, and the no-op and
-- not-found semantics.
--
-- CREATE OR REPLACE preserves a function's ownership and privileges, so the
-- Milestone 16 security posture survives on its own. The revoke/grant block
-- at the end restates it anyway — idempotent, and it keeps the intended
-- posture visible in the schema history rather than implied.
-- ============================================================================


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

  -- `is distinct from` throughout: company_legacy_id and observations are
  -- nullable, and `<>` would evaluate to NULL rather than TRUE when one side
  -- is null, silently missing a real change.
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

  -- Nothing genuinely changed. The existing service treats a no-change save as
  -- a success and returns the row, so this does too — without fabricating an
  -- audit event for an edit that did not happen.
  if array_length(v_fields, 1) is null then
    return p_client_id;
  end if;

  -- A duplicate (identification_type, identification_number) raises 23505 from
  -- clients_identification_type_identification_number_key exactly as it does
  -- today. The exception aborts this whole function, so neither the update nor
  -- the event is written, and the caller still sees SQLSTATE 23505 and maps it
  -- to DUPLICATE_IDENTIFICATION.
  update public.clients
  set full_name = p_full_name,
      identification_type = p_identification_type,
      identification_number = p_identification_number,
      phone = p_phone,
      email = p_email,
      address = p_address,
      company_legacy_id = p_company_legacy_id,
      "position" = p_position,
      monthly_salary = p_monthly_salary,
      birth_date = p_birth_date,
      nationality = p_nationality,
      observations = p_observations
  where id = p_client_id;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value
  ) values (
    'client_profile_updated', 'client', p_client_id,
    p_client_id, null,
    p_actor_profile_id,
    case when p_actor_profile_id is null then 'system' else 'human' end,
    'crm_manual',
    -- FIELD NAMES ONLY. No values. See the privacy rule above.
    jsonb_build_object('fields', to_jsonb(v_fields)),
    jsonb_build_object('fields', to_jsonb(v_fields))
  );

  return p_client_id;
end;
$$;


-- ----------------------------------------------------------------------------
-- Security posture — restated, not changed
-- ----------------------------------------------------------------------------
-- A SECURITY DEFINER function runs as its owner (postgres), so PUBLIC EXECUTE
-- on one is the privilege-escalation shape Milestone 16 removed from
-- rls_auto_enable. CREATE OR REPLACE above did not alter the existing ACL;
-- these statements assert it explicitly.

revoke execute on function public.record_client_profile_update(uuid, text, text, text, text, text, text, text, text, numeric, date, text, text, uuid) from public;
revoke execute on function public.record_client_profile_update(uuid, text, text, text, text, text, text, text, text, numeric, date, text, text, uuid) from anon, authenticated;
grant  execute on function public.record_client_profile_update(uuid, text, text, text, text, text, text, text, text, numeric, date, text, text, uuid) to service_role;
