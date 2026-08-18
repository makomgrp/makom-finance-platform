-- ============================================================================
-- Milestone 25A-2 — Sync grant_staff_capability's delegatable list
-- ============================================================================
--
-- CORRECTIVE MIGRATION. Neither 20260818051036 (25A) nor 20260818052... (25A-1)
-- is amended or re-run. This replaces one function body and nothing else.
--
-- ----------------------------------------------------------------------------
-- THE DEFECT — FOUND BY RUNTIME VERIFICATION
-- ----------------------------------------------------------------------------
-- Milestone 24's grant_staff_capability validates the requested capability
-- against a LITERAL LIST INSIDE ITS OWN BODY, in addition to the CHECK
-- constraint on profile_capability_grants:
--
--   if p_capability not in ('user:invite', 'user:set_active', 'user:set_role')
--
-- Milestone 25A widened the CHECK constraint to five capabilities but left that
-- literal at three. The result: `branch:manage` and `branch:transfer` satisfy
-- the table constraint and are advertised as delegatable in TypeScript, but the
-- only function that can write them refuses with 22023. Delegating branch
-- administration — the entire product reason for Milestone 25A's capability
-- work — was impossible.
--
-- This is precisely the failure mode Milestone 24's own comment predicted when
-- it called the duplication "deliberate, documented": a list in two places is a
-- list that can disagree. It disagreed at the first opportunity.
--
-- ----------------------------------------------------------------------------
-- THE CORRECTION
-- ----------------------------------------------------------------------------
-- The literal is brought into line with the CHECK constraint and with
-- DELEGATABLE_CAPABILITIES in src/lib/auth/capabilities.ts. All three now read:
--
--   user:invite · user:set_active · user:set_role · branch:manage · branch:transfer
--
-- `user:manage_permissions` and `branch:create` remain absent from all three —
-- they are the two non-delegatable capabilities, and that is the boundary the
-- whole delegation model rests on.
--
-- WHY THE IN-FUNCTION CHECK IS KEPT AT ALL rather than deleted in favour of the
-- constraint: it produces a clean 22023 the service layer maps to
-- INVALID_INPUT, instead of a raw 23514 constraint violation surfacing as an
-- opaque failure. The constraint remains the guarantee; this is the message.
--
-- DELIBERATELY UNCHANGED: signature, return type, SECURITY DEFINER, owner,
-- search_path, execute privileges, the A6 hard administrador guard, the A5
-- self-grant refusal, idempotency, and the crm_events insert.
-- ============================================================================

create or replace function public.grant_staff_capability(
  p_profile_id uuid,
  p_capability text,
  p_actor_profile_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_grant_id uuid;
  v_target_exists boolean;
begin
  -- A6. Administrador, and active. No delegated path reaches this function.
  if not exists (
    select 1 from public.profiles
    where id = p_actor_profile_id and active and role = 'administrador'
  ) then
    raise exception 'grant_staff_capability: actor is not an active administrador'
      using errcode = '42501';
  end if;

  -- A5. Nobody grants themselves anything, administrador included.
  if p_profile_id = p_actor_profile_id then
    raise exception 'grant_staff_capability: an actor cannot grant capabilities to their own profile'
      using errcode = '22023';
  end if;

  -- A7 + A8, now in step with profile_capability_grants_capability_check and
  -- with DELEGATABLE_CAPABILITIES. user:manage_permissions and branch:create
  -- are absent and must stay absent.
  if p_capability not in (
    'user:invite',
    'user:set_active',
    'user:set_role',
    'branch:manage',
    'branch:transfer'
  ) then
    raise exception 'grant_staff_capability: "%" is not a delegatable capability', p_capability
      using errcode = '22023';
  end if;

  select true into v_target_exists from public.profiles where id = p_profile_id;
  if not found then
    return null;
  end if;

  select id into v_grant_id
  from public.profile_capability_grants
  where profile_id = p_profile_id and capability = p_capability;

  if v_grant_id is not null then
    return v_grant_id;
  end if;

  insert into public.profile_capability_grants (profile_id, capability, granted_by_profile_id)
  values (p_profile_id, p_capability, p_actor_profile_id)
  returning id into v_grant_id;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value
  ) values (
    'user_capability_granted', 'profile', p_profile_id, null, null,
    p_actor_profile_id, 'human', 'crm_manual',
    null,
    jsonb_build_object('capability', p_capability)
  );

  return v_grant_id;
end;
$$;

revoke execute on function public.grant_staff_capability(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.grant_staff_capability(uuid, text, uuid) to service_role;
