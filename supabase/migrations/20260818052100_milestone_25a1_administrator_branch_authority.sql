-- ============================================================================
-- Milestone 25A-1 — Administrador branch authority (bootstrap fix)
-- ============================================================================
--
-- CORRECTIVE MIGRATION. 20260818051036_milestone_25a_branch_foundations
-- deployed successfully and is immutable deployment history: it is NOT amended,
-- rewritten or re-run. This migration replaces five function bodies and changes
-- nothing else — the posture Milestones 20A, 23A, 23B and 24A took.
--
-- ----------------------------------------------------------------------------
-- THE DEFECT — FOUND BY RUNTIME VERIFICATION, NOT BY REVIEW
-- ----------------------------------------------------------------------------
-- Milestone 25A ships branch_scope_mode defaulting to 'branch' for EVERY
-- profile (deliberately — nobody is silently promoted to national), and B1/B6
-- require an actor to already hold scope over a branch before administering it
-- or assigning anyone to it.
--
-- Applied literally, those two facts deadlock the administrador:
--
--   profile_has_branch_scope(administrador, any_branch) = FALSE
--     (mode 'branch', zero memberships)
--   -> assign_profile_branch rejects with 42501
--   -> B3 forbids the administrador from assigning themselves
--   -> the only escape is another administrador granting national scope
--
-- With ODL's single administrador, branch membership assignment is unreachable.
-- The first branch could be created (create_branch requires only the
-- administrador role) and then never staffed. Verified at runtime: the setup
-- step of the B1/B2 rejection suite failed on exactly this.
--
-- ----------------------------------------------------------------------------
-- THE CORRECTION
-- ----------------------------------------------------------------------------
-- An ACTOR whose role is administrador is exempt from the B1/B2/B6 branch-scope
-- checks in the five branch-administration functions. This is not a new idea in
-- this codebase — it is the same authority A1 and B5 already encode ("only an
-- administrador may modify an administrador"), and it matches the stated
-- business model that administrators hold organization-wide control.
--
-- DELIBERATELY NARROW, AND HERE IS WHAT IS *NOT* CHANGED:
--
--   * profile_has_branch_scope() IS UNTOUCHED. It remains a PURE SCOPE
--     predicate — mode plus memberships, no role knowledge. Milestone 25B uses
--     it for DATA isolation, and whether an administrador sees every client is
--     a separate product question that deserves its own explicit decision
--     rather than being smuggled in through a bootstrap fix.
--   * NO PROFILE IS MODIFIED. No administrador is set to 'national'. The
--     Milestone 25A decision that nobody is auto-promoted stands; this changes
--     what the GUARD asks, not what the data says.
--   * B3 is untouched — an administrador still cannot modify their own
--     memberships, primary branch or scope mode.
--   * B4 is untouched — set_profile_branch_scope_mode still hard-requires an
--     active administrador.
--   * B5 is untouched — a non-administrador still cannot touch an
--     administrador.
--   * B1/B2/B6 are untouched FOR EVERY NON-ADMINISTRADOR ACTOR, which is where
--     they do their real work: a delegated gerente holding branch:manage is
--     still confined to their own branches, still cannot reach a target whose
--     scope exceeds theirs, and still cannot expand their own scope.
--
-- In other words: the delegation model is unchanged. Only the ultimate
-- authority is no longer locked out of its own system.
--
-- ----------------------------------------------------------------------------
-- FUNCTIONS REPLACED
-- ----------------------------------------------------------------------------
--   update_branch, set_branch_active            (B1/B6 scope check)
--   assign_profile_branch, remove_profile_branch,
--   set_profile_primary_branch                  (B1/B2/B6 scope checks)
--
-- create_branch and set_profile_branch_scope_mode are NOT replaced: both
-- already hard-require an active administrador and were never affected.
--
-- Everything else in each function is byte-identical: signatures, return types,
-- SECURITY DEFINER, owner, search_path, execute privileges, row locking, no-op
-- semantics, crm_events insert shape and event types, and the actor
-- active-profile identity check.
-- ============================================================================


create or replace function public.update_branch(
  p_branch_id uuid,
  p_code text,
  p_name text,
  p_province text,
  p_city text,
  p_address text,
  p_phone text,
  p_email text,
  p_is_headquarters boolean,
  p_actor_profile_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current public.branches%rowtype;
  v_fields text[] := array[]::text[];
  v_code text := upper(btrim(p_code));
  v_actor_role text;
begin
  select role into v_actor_role
  from public.profiles where id = p_actor_profile_id and active;
  if not found then
    raise exception 'update_branch: actor is not an active profile'
      using errcode = '42501';
  end if;

  select * into v_current from public.branches where id = p_branch_id for update;
  if not found then
    return null;
  end if;

  -- B1/B6, with the administrador exemption. A delegated manager administers
  -- only their own branches; the administrador administers the organization.
  if v_actor_role <> 'administrador'
     and not public.profile_has_branch_scope(p_actor_profile_id, p_branch_id) then
    raise exception 'update_branch: branch is outside the actor''s branch scope'
      using errcode = '42501';
  end if;

  if v_current.code            is distinct from v_code            then v_fields := array_append(v_fields, 'code'); end if;
  if v_current.name            is distinct from btrim(p_name)     then v_fields := array_append(v_fields, 'name'); end if;
  if v_current.province        is distinct from btrim(p_province) then v_fields := array_append(v_fields, 'province'); end if;
  if v_current.city            is distinct from nullif(btrim(coalesce(p_city, '')), '')       then v_fields := array_append(v_fields, 'city'); end if;
  if v_current.address         is distinct from nullif(btrim(coalesce(p_address, '')), '')    then v_fields := array_append(v_fields, 'address'); end if;
  if v_current.phone           is distinct from nullif(btrim(coalesce(p_phone, '')), '')      then v_fields := array_append(v_fields, 'phone'); end if;
  if v_current.email           is distinct from nullif(btrim(coalesce(p_email, '')), '')      then v_fields := array_append(v_fields, 'email'); end if;
  if v_current.is_headquarters is distinct from coalesce(p_is_headquarters, false)            then v_fields := array_append(v_fields, 'isHeadquarters'); end if;

  if array_length(v_fields, 1) is null then
    return p_branch_id;
  end if;

  update public.branches
  set code            = v_code,
      name            = btrim(p_name),
      province        = btrim(p_province),
      city            = nullif(btrim(coalesce(p_city, '')), ''),
      address         = nullif(btrim(coalesce(p_address, '')), ''),
      phone           = nullif(btrim(coalesce(p_phone, '')), ''),
      email           = nullif(btrim(coalesce(p_email, '')), ''),
      is_headquarters = coalesce(p_is_headquarters, false)
  where id = p_branch_id;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value, branch_id
  ) values (
    'branch_updated', 'branch', p_branch_id, null, null,
    p_actor_profile_id, 'human', 'crm_manual',
    null,
    jsonb_build_object('changedFields', to_jsonb(v_fields)),
    p_branch_id
  );

  return p_branch_id;
end;
$$;


create or replace function public.set_branch_active(
  p_branch_id uuid,
  p_active boolean,
  p_actor_profile_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_previous_active boolean;
  v_actor_role text;
begin
  select role into v_actor_role
  from public.profiles where id = p_actor_profile_id and active;
  if not found then
    raise exception 'set_branch_active: actor is not an active profile'
      using errcode = '42501';
  end if;

  select active into v_previous_active from public.branches where id = p_branch_id for update;
  if not found then
    return null;
  end if;

  if v_actor_role <> 'administrador'
     and not public.profile_has_branch_scope(p_actor_profile_id, p_branch_id) then
    raise exception 'set_branch_active: branch is outside the actor''s branch scope'
      using errcode = '42501';
  end if;

  if v_previous_active = p_active then
    return p_branch_id;
  end if;

  update public.branches set active = p_active where id = p_branch_id;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value, branch_id
  ) values (
    'branch_deactivated', 'branch', p_branch_id, null, null,
    p_actor_profile_id, 'human', 'crm_manual',
    jsonb_build_object('active', v_previous_active),
    jsonb_build_object('active', p_active),
    p_branch_id
  );

  return p_branch_id;
end;
$$;


create or replace function public.assign_profile_branch(
  p_profile_id uuid,
  p_branch_id uuid,
  p_is_primary boolean,
  p_actor_profile_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_role text;
  v_target_role text;
  v_membership_id uuid;
  v_out_of_scope int;
begin
  select role into v_actor_role
  from public.profiles where id = p_actor_profile_id and active;
  if not found then
    raise exception 'assign_profile_branch: actor is not an active profile'
      using errcode = '42501';
  end if;

  -- B3. Unchanged, and it applies to the administrador too.
  if p_profile_id = p_actor_profile_id then
    raise exception 'assign_profile_branch: an actor cannot modify their own branch memberships'
      using errcode = '22023';
  end if;

  select role into v_target_role from public.profiles where id = p_profile_id;
  if not found then
    return null;
  end if;

  -- B5. Unchanged.
  if v_target_role = 'administrador' and v_actor_role <> 'administrador' then
    raise exception 'assign_profile_branch: only an administrador may modify an administrador'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.branches where id = p_branch_id and active) then
    raise exception 'assign_profile_branch: branch does not exist or is inactive'
      using errcode = '22023';
  end if;

  -- B1/B2/B6 — enforced for every NON-administrador actor, exactly as before.
  if v_actor_role <> 'administrador' then
    if not public.profile_has_branch_scope(p_actor_profile_id, p_branch_id) then
      raise exception 'assign_profile_branch: branch is outside the actor''s branch scope'
        using errcode = '42501';
    end if;

    if exists (select 1 from public.profiles where id = p_profile_id and branch_scope_mode = 'national') then
      raise exception 'assign_profile_branch: target has national scope and may only be modified by an administrador'
        using errcode = '42501';
    end if;

    select count(*) into v_out_of_scope
    from public.profile_branch_memberships m
    where m.profile_id = p_profile_id
      and not public.profile_has_branch_scope(p_actor_profile_id, m.branch_id);

    if v_out_of_scope > 0 then
      raise exception 'assign_profile_branch: target has memberships outside the actor''s branch scope'
        using errcode = '42501';
    end if;
  end if;

  select id into v_membership_id
  from public.profile_branch_memberships
  where profile_id = p_profile_id and branch_id = p_branch_id;

  if v_membership_id is not null then
    return v_membership_id;
  end if;

  if coalesce(p_is_primary, false) then
    update public.profile_branch_memberships
    set is_primary = false
    where profile_id = p_profile_id and is_primary;
  end if;

  insert into public.profile_branch_memberships (
    profile_id, branch_id, is_primary, assigned_by_profile_id
  ) values (
    p_profile_id, p_branch_id, coalesce(p_is_primary, false), p_actor_profile_id
  )
  returning id into v_membership_id;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value, branch_id
  ) values (
    'profile_branch_assigned', 'profile', p_profile_id, null, null,
    p_actor_profile_id, 'human', 'crm_manual',
    null,
    jsonb_build_object('branchId', p_branch_id, 'isPrimary', coalesce(p_is_primary, false)),
    p_branch_id
  );

  return v_membership_id;
end;
$$;


create or replace function public.remove_profile_branch(
  p_profile_id uuid,
  p_branch_id uuid,
  p_actor_profile_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_role text;
  v_target_role text;
  v_deleted_id uuid;
  v_out_of_scope int;
begin
  select role into v_actor_role from public.profiles where id = p_actor_profile_id and active;
  if not found then
    raise exception 'remove_profile_branch: actor is not an active profile'
      using errcode = '42501';
  end if;

  if p_profile_id = p_actor_profile_id then
    raise exception 'remove_profile_branch: an actor cannot modify their own branch memberships'
      using errcode = '22023';
  end if;

  select role into v_target_role from public.profiles where id = p_profile_id;
  if not found then
    return null;
  end if;

  if v_target_role = 'administrador' and v_actor_role <> 'administrador' then
    raise exception 'remove_profile_branch: only an administrador may modify an administrador'
      using errcode = '42501';
  end if;

  if v_actor_role <> 'administrador' then
    if not public.profile_has_branch_scope(p_actor_profile_id, p_branch_id) then
      raise exception 'remove_profile_branch: branch is outside the actor''s branch scope'
        using errcode = '42501';
    end if;

    if exists (select 1 from public.profiles where id = p_profile_id and branch_scope_mode = 'national') then
      raise exception 'remove_profile_branch: target has national scope and may only be modified by an administrador'
        using errcode = '42501';
    end if;

    select count(*) into v_out_of_scope
    from public.profile_branch_memberships m
    where m.profile_id = p_profile_id
      and not public.profile_has_branch_scope(p_actor_profile_id, m.branch_id);

    if v_out_of_scope > 0 then
      raise exception 'remove_profile_branch: target has memberships outside the actor''s branch scope'
        using errcode = '42501';
    end if;
  end if;

  delete from public.profile_branch_memberships
  where profile_id = p_profile_id and branch_id = p_branch_id
  returning id into v_deleted_id;

  if v_deleted_id is null then
    return p_profile_id;
  end if;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value, branch_id
  ) values (
    'profile_branch_removed', 'profile', p_profile_id, null, null,
    p_actor_profile_id, 'human', 'crm_manual',
    jsonb_build_object('branchId', p_branch_id),
    null,
    p_branch_id
  );

  return p_profile_id;
end;
$$;


create or replace function public.set_profile_primary_branch(
  p_profile_id uuid,
  p_branch_id uuid,
  p_actor_profile_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor_role text;
  v_target_role text;
  v_membership_id uuid;
  v_already_primary boolean;
  v_out_of_scope int;
begin
  select role into v_actor_role from public.profiles where id = p_actor_profile_id and active;
  if not found then
    raise exception 'set_profile_primary_branch: actor is not an active profile'
      using errcode = '42501';
  end if;

  if p_profile_id = p_actor_profile_id then
    raise exception 'set_profile_primary_branch: an actor cannot modify their own primary branch'
      using errcode = '22023';
  end if;

  select role into v_target_role from public.profiles where id = p_profile_id;
  if not found then
    return null;
  end if;

  if v_target_role = 'administrador' and v_actor_role <> 'administrador' then
    raise exception 'set_profile_primary_branch: only an administrador may modify an administrador'
      using errcode = '42501';
  end if;

  if v_actor_role <> 'administrador' then
    if not public.profile_has_branch_scope(p_actor_profile_id, p_branch_id) then
      raise exception 'set_profile_primary_branch: branch is outside the actor''s branch scope'
        using errcode = '42501';
    end if;

    select count(*) into v_out_of_scope
    from public.profile_branch_memberships m
    where m.profile_id = p_profile_id
      and not public.profile_has_branch_scope(p_actor_profile_id, m.branch_id);

    if v_out_of_scope > 0 then
      raise exception 'set_profile_primary_branch: target has memberships outside the actor''s branch scope'
        using errcode = '42501';
    end if;
  end if;

  select id, is_primary into v_membership_id, v_already_primary
  from public.profile_branch_memberships
  where profile_id = p_profile_id and branch_id = p_branch_id
  for update;

  if v_membership_id is null then
    raise exception 'set_profile_primary_branch: profile has no membership in that branch'
      using errcode = '22023';
  end if;

  if v_already_primary then
    return v_membership_id;
  end if;

  update public.profile_branch_memberships
  set is_primary = false
  where profile_id = p_profile_id and is_primary;

  update public.profile_branch_memberships
  set is_primary = true
  where id = v_membership_id;

  return v_membership_id;
end;
$$;


revoke execute on function public.update_branch(uuid, text, text, text, text, text, text, text, boolean, uuid) from public, anon, authenticated;
revoke execute on function public.set_branch_active(uuid, boolean, uuid) from public, anon, authenticated;
revoke execute on function public.assign_profile_branch(uuid, uuid, boolean, uuid) from public, anon, authenticated;
revoke execute on function public.remove_profile_branch(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.set_profile_primary_branch(uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function public.update_branch(uuid, text, text, text, text, text, text, text, boolean, uuid) to service_role;
grant execute on function public.set_branch_active(uuid, boolean, uuid) to service_role;
grant execute on function public.assign_profile_branch(uuid, uuid, boolean, uuid) to service_role;
grant execute on function public.remove_profile_branch(uuid, uuid, uuid) to service_role;
grant execute on function public.set_profile_primary_branch(uuid, uuid, uuid) to service_role;
