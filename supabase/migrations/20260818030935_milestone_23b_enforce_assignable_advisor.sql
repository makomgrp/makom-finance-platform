-- ============================================================================
-- Milestone 23B — Enforce the assignable-advisor invariant in the database
-- ============================================================================
--
-- CORRECTIVE MIGRATION. 20260817203114_milestone_23_advisor_restriction_employer
-- and 20260817213640_milestone_23a_fix_advisor_not_found_guard deployed
-- successfully and are immutable deployment history: neither is amended,
-- rewritten or re-run. This migration replaces one function body and changes
-- nothing else — the same posture Milestones 20A and 23A took.
--
-- ----------------------------------------------------------------------------
-- WHAT WAS WRONG
-- ----------------------------------------------------------------------------
-- The advisor guard shipped in Milestone 23 validated only that the target
-- profile existed and was active:
--
--   if not exists (select 1 from public.profiles
--                  where id = p_advisor_profile_id and active) then ...
--
-- That is weaker than the approved product rule. It permitted an application
-- to be assigned to an administrador, a gerente, an analista, a consulta, or
-- an active asesor with no linked Auth account — i.e. to people who either do
-- not carry files at all, or cannot sign in to work the one they were given.
--
-- The Milestone 23 eligibility correction fixed the DIRECTORY
-- (getAssignableAdvisors, src/lib/services/profiles.ts) so the UI offers only
-- reachable active asesores. But a Server Action ultimately receives a profile
-- UUID from the client, and UI filtering is not an integrity boundary: a
-- crafted request from a caller who legitimately holds
-- `application:assign_advisor` could still have stored an ineligible advisor.
-- This migration closes that gap at the only place that can actually
-- guarantee it.
--
-- ----------------------------------------------------------------------------
-- THE INVARIANT
-- ----------------------------------------------------------------------------
-- A profile may be stored as applications.assigned_advisor_profile_id only
-- when ALL of the following hold:
--
--   role = 'asesor'            the advisor is the person who WORKS the file.
--                              Administradores and gerentes ASSIGN files; they
--                              are not themselves the assignee. Analistas
--                              evaluate rather than carry, consulta is
--                              read-only.
--   active = true              a deactivated profile cannot enter the CRM at
--                              all, so a file assigned to one has no real
--                              owner.
--   auth_user_id is not null   a pending invitee has no way to sign in yet.
--                              Assigning work to someone who cannot open it is
--                              not an ownership record, it is a dead end.
--
-- NULL remains fully valid — unassignment is a legitimate state the column has
-- always permitted, and this migration does not touch that path.
--
-- ----------------------------------------------------------------------------
-- THIS IS A BUSINESS-DOMAIN INVARIANT, NOT CALLER AUTHORIZATION
-- ----------------------------------------------------------------------------
-- It constrains WHO MAY BE ASSIGNED. It says nothing about WHO MAY ASSIGN —
-- that remains the `application:assign_advisor` capability (administrador,
-- gerente), enforced by requireCapability() in the Server Action and defined
-- once in src/lib/auth/capabilities.ts. ROLE_CAPABILITIES is not changed by
-- this migration, no capability is added, and this function still performs no
-- caller authorization of its own.
--
-- DELIBERATE, DOCUMENTED DUPLICATION. The same rule is now expressed twice:
--
--   getAssignableAdvisors()                  -> TypeScript, provides UX
--   record_application_advisor_assignment()  -> SQL, guarantees integrity
--
-- They are NOT artificially centralised across the language boundary. Each
-- layer states the invariant in its own terms: the query decides what a human
-- is offered, the function decides what the database will accept. If they ever
-- disagree, the function wins and the UI is the thing that is broken.
--
-- ----------------------------------------------------------------------------
-- DELIBERATELY UNCHANGED
-- ----------------------------------------------------------------------------
-- Function signature, return type, SECURITY DEFINER, owner, search_path,
-- execute privileges, the `for update` application lock, the FOUND-based
-- not-found handling from 23A, the `is not distinct from` no-op check,
-- previous-advisor capture, the UPDATE, the crm_events insert shape, the
-- 'application_advisor_assigned' event type, actor/source attribution, the
-- IDS-ONLY privacy rule, transaction semantics, and unassignment semantics.
--
-- The errcode stays 22023, so src/lib/services/applications.ts continues to
-- map it to INVALID_ADVISOR with no application-code change. Only the human-
-- readable message text is updated, because the old wording ("does not exist
-- or is not active") would now be untrue for the most common rejection.
--
-- GUARD ORDERING MATTERS: validation runs BEFORE the no-op check, the UPDATE
-- and the INSERT. An invalid target therefore raises, the whole function
-- aborts, and neither the application row nor crm_events is touched.
--
-- CREATE OR REPLACE preserves a function's ownership and privileges, so the
-- Milestone 16 security posture survives on its own. The revoke/grant block is
-- restated anyway — idempotent, and it keeps the intended posture visible in
-- the schema history rather than implied.
-- ============================================================================


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
begin
  select assigned_advisor_profile_id, client_id
    into v_previous_advisor, v_client_id
  from public.applications
  where id = p_application_id
  for update;

  -- FOUND is set by the SELECT INTO above and is never NULL (Milestone 23A).
  -- v_previous_advisor cannot stand in for it: NULL is legitimate for an
  -- application that exists but has no advisor.
  if not found then
    return null;
  end if;

  -- MILESTONE 23B — the assignable-advisor invariant. Raised BEFORE any write,
  -- so an ineligible target mutates nothing and audits nothing.
  if p_advisor_profile_id is not null then
    if not exists (
      select 1 from public.profiles
      where id = p_advisor_profile_id
        and role = 'asesor'
        and active
        and auth_user_id is not null
    ) then
      raise exception
        'Profile % is not an assignable advisor (requires role = asesor, active = true, and a linked auth account).',
        p_advisor_profile_id
        using errcode = '22023';
    end if;
  end if;

  -- Genuine no-op, including NULL -> NULL. Success, but no event.
  if v_previous_advisor is not distinct from p_advisor_profile_id then
    return p_application_id;
  end if;

  update public.applications
  set assigned_advisor_profile_id = p_advisor_profile_id
  where id = p_application_id;

  -- IDs only — never staff name, e-mail or role.
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

revoke execute on function public.record_application_advisor_assignment(uuid, uuid, uuid) from public;
revoke execute on function public.record_application_advisor_assignment(uuid, uuid, uuid) from anon, authenticated;
grant execute on function public.record_application_advisor_assignment(uuid, uuid, uuid) to service_role;
