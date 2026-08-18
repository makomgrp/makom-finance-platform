-- ============================================================================
-- Milestone 23A — Fix record_application_advisor_assignment's not-found guard
-- ============================================================================
--
-- CORRECTIVE MIGRATION. 20260817203114_milestone_23_advisor_restriction_employer
-- deployed successfully and is historical fact: it is NOT amended, rewritten or
-- re-run. This migration replaces one function body and changes nothing else —
-- the same posture Milestone 20A took.
--
-- ----------------------------------------------------------------------------
-- THE DEFECT
-- ----------------------------------------------------------------------------
-- Rollback-safe runtime verification of the Milestone 23 deployment found that
-- assigning an advisor to a NONEXISTENT application raised, instead of
-- returning NULL:
--
--   ERROR:  23503: insert or update on table "crm_events" violates foreign key
--           constraint "crm_events_application_id_fkey"
--   DETAIL: Key (application_id)=(000…000) is not present in table "applications".
--
-- ROOT CAUSE. The guard was written as:
--
--   v_found boolean := false;
--   select assigned_advisor_profile_id, client_id, true
--     into v_previous_advisor, v_client_id, v_found
--   from public.applications where id = p_application_id for update;
--   if not v_found then return null; end if;
--
-- When SELECT INTO matches no row, PL/pgSQL assigns NULL to EVERY target — it
-- does not leave them at their initialised values. So v_found became NULL, not
-- false; `not NULL` is NULL; and an IF on NULL does not take its branch. The
-- function fell straight through to the UPDATE (which matched nothing) and the
-- INSERT (which hit the foreign key).
--
-- The sentinel was introduced precisely because v_previous_advisor is
-- legitimately NULL for an unassigned application that DOES exist, so it could
-- not be tested the way the other functions test theirs. The idea was right;
-- the mechanism was wrong.
--
-- IMPACT. None in practice, and none possible. The defect is reachable ONLY
-- with an application id that does not exist, the assignment UI had not been
-- released, no application code had ever called this function, and the
-- exception aborted the whole function — so nothing was written and nothing
-- was corrupted. As in Milestone 20A, the failure incidentally demonstrated
-- that the atomicity design works.
--
-- Static review missed this because it is a PL/pgSQL assignment-semantics
-- subtlety, not a logic error. It is exactly what runtime verification is for.
--
-- ----------------------------------------------------------------------------
-- THE CORRECTION — MECHANICAL, AND NOTHING ELSE
-- ----------------------------------------------------------------------------
-- The hand-rolled sentinel is replaced by PL/pgSQL's built-in FOUND, which is
-- set by SELECT INTO specifically to answer this question and is never NULL:
--
--   -  v_found boolean := false;               -- removed
--   -  select …, true into …, v_found          -- select …  into … (2 targets)
--   -  if not v_found then return null; end if; -- if not found then …
--
-- DELIBERATELY UNCHANGED: parameters and their order, return type, SECURITY
-- DEFINER, owner, search_path, the `for update` row lock, the active-advisor
-- guard and its 22023 errcode, the `is not distinct from` no-op check, the
-- UPDATE, actor and source handling, the crm_events insert structure, and the
-- IDS-ONLY privacy rule.
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

  -- FOUND is set by the SELECT INTO above and is never NULL. It is the only
  -- correct test here: v_previous_advisor is legitimately NULL for an
  -- application that exists but has no advisor, so it cannot stand in for
  -- "no such row". The caller maps NULL to its NOT_FOUND code.
  if not found then
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
