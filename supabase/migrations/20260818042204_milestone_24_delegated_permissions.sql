-- ============================================================================
-- Milestone 24 — Delegated staff permissions
-- ============================================================================
--
-- PURPOSE. ODL's authorization becomes:
--
--     EFFECTIVE = ROLE_CAPABILITIES[role]  UNION  per-user grants
--
-- The operational requirement is concrete: Damion is the administrador and
-- travels; Randol is the gerente and must be able to run routine staff
-- administration without waiting for him. Until now that was impossible —
-- `user:manage` was one capability covering invite, role change and
-- deactivation, and all four staff RPCs additionally hard-coded
-- `actor.role = 'administrador'`, so no application-layer delegation could
-- ever reach the database.
--
-- This migration makes delegation possible AND makes it safe, in one step.
--
-- ----------------------------------------------------------------------------
-- THE ONE RULE THAT MAKES THIS SAFE
-- ----------------------------------------------------------------------------
-- Three staff-management capabilities are DELEGATABLE:
--
--     user:invite  ·  user:set_active  ·  user:set_role
--
-- One is NOT, and can never become so:
--
--     user:manage_permissions
--
-- It is excluded by profile_capability_grants_capability_check, so the
-- database physically refuses to store it, and the grant/revoke functions
-- additionally hard-code `actor.role = 'administrador'` rather than testing
-- for it. A delegated manager can therefore run staff operations all day and
-- can never widen anyone's authority — including their own. Every other
-- protection here rests on that asymmetry.
--
-- ----------------------------------------------------------------------------
-- ARCHITECTURAL RULE — WHO ENFORCES WHAT  (the Milestone 23 discipline)
-- ----------------------------------------------------------------------------
--   requireCapability()  -> CALLER AUTHORIZATION. "May this person perform
--                           this operation at all?" Lives in TypeScript,
--                           reads the one canonical ROLE_CAPABILITIES matrix
--                           unioned with persisted grants.
--   these functions      -> TARGET / DOMAIN INVARIANTS. "Whatever the caller
--                           is allowed to do generally, is THIS specific
--                           target change legitimate?"
--
-- That split is why ROLE_CAPABILITIES is NOT duplicated in PostgreSQL and
-- never will be. Every invariant below is expressible using only ROLES and
-- IDENTITY — never capabilities — so the database needs no knowledge of the
-- capability matrix to enforce them. Same discipline as Milestone 23B's
-- assignable-advisor invariant.
--
-- ----------------------------------------------------------------------------
-- THE INVARIANTS  (A1-A8)
-- ----------------------------------------------------------------------------
--   A1  A target whose role is administrador may have role / active state /
--       permissions changed ONLY by an actor whose own role is administrador.
--   A2  A target may be GIVEN role administrador ONLY by an administrador.
--   A3  No actor may change their own role.
--   A4  No actor may change their own active status (either direction).
--   A5  No actor may grant or revoke their own capabilities.
--   A6  Grant/revoke require actor.role = 'administrador' AND actor.active.
--       Deliberately a ROLE test, not a capability test — the one guard that
--       must never depend on anything delegable.
--   A7  user:manage_permissions may never be persisted as a grant.
--   A8  Only the explicit delegatable allow-list may be persisted.
--
-- WHY THE ACTOR GUARD IS RELAXED AND THE TARGET GUARDS ADDED IN THE SAME
-- MIGRATION: deploying the relaxation first would leave a window in which any
-- active profile could reach these functions with no target protection at all.
-- There is no intermediate state. The four Milestone 21 functions are replaced
-- here via CREATE OR REPLACE; the Milestone 21 migration file itself is NOT
-- amended, rewritten or re-run — it remains immutable deployment history, the
-- same posture Milestones 20A, 23A and 23B took.
--
-- ----------------------------------------------------------------------------
-- WHAT THIS MIGRATION DOES NOT DO
-- ----------------------------------------------------------------------------
--   * Grants nothing to anyone. profile_capability_grants starts EMPTY and is
--     never seeded. Randol's delegation is a decision Damion makes in the CRM,
--     not a migration side effect.
--   * Deletes no fixture data, touches no Auth user, sends no invitation,
--     removes no storage object, resets no sequence.
--   * Grants service_role no new mutation privilege on any table. crm_events
--     remains append-only by privilege withholding.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- A. crm_events vocabulary — 12 -> 14 event types, additive
-- ----------------------------------------------------------------------------
-- entity_type is NOT widened: 'profile' already exists (Milestone 21) and is
-- exactly right — the subject of a permission change is the staff member whose
-- authority changed.
do $$
begin
  if exists (
    select 1 from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public' and rel.relname = 'crm_events'
      and con.conname = 'crm_events_event_type_check'
  ) then
    alter table public.crm_events drop constraint crm_events_event_type_check;
  end if;

  alter table public.crm_events
    add constraint crm_events_event_type_check check (event_type in (
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
      -- Milestone 24: per-user capability delegation.
      'user_capability_granted',
      'user_capability_revoked'
    ));
end
$$;


-- ----------------------------------------------------------------------------
-- B. profile_capability_grants
-- ----------------------------------------------------------------------------
-- A NORMALIZED RELATION, deliberately — not a jsonb column on profiles. One
-- row per (profile, capability) makes "who holds user:invite" an indexed
-- question, makes double-granting impossible by constraint rather than by
-- application care, and lets each grant carry its own attribution. A JSON blob
-- would make every one of those a scan and a merge.
create table if not exists public.profile_capability_grants (
  id uuid primary key default gen_random_uuid(),

  -- ON DELETE RESTRICT, matching messages.sender_profile_id and every other
  -- profile reference in this schema: staff are never hard-deleted, and a
  -- record of delegated authority must not be removable as a side effect.
  profile_id uuid not null
    references public.profiles(id) on delete restrict,

  capability text not null,

  -- ON DELETE SET NULL, matching crm_events.actor_profile_id: who granted it
  -- is worth keeping, but must never block a future profile lifecycle change.
  granted_by_profile_id uuid
    references public.profiles(id) on delete set null,

  granted_at timestamptz not null default now(),

  -- Makes a duplicate grant a no-op by construction rather than by hoping the
  -- caller checked first.
  constraint profile_capability_grants_unique unique (profile_id, capability),

  -- A7 + A8. THE SECURITY BOUNDARY OF THIS MILESTONE.
  --
  -- user:manage_permissions is absent and must never be added: if it could be
  -- delegated, a delegated manager could grant themselves anything and every
  -- other protection here would be decoration.
  --
  -- Business capabilities are absent too. Milestone 24 delegates STAFF
  -- ADMINISTRATION, not lending authority — making application:set_status
  -- delegatable would be a credit-policy decision wearing a permissions
  -- costume.
  --
  -- This list mirrors DELEGATABLE_CAPABILITIES in src/lib/auth/capabilities.ts.
  -- Deliberate, documented duplication of THREE STRINGS — never of
  -- ROLE_CAPABILITIES — following the same pattern crm_events_event_type_check
  -- already uses. Widening it requires a migration, which is the intended
  -- friction for a privilege allow-list.
  constraint profile_capability_grants_capability_check check (capability in (
    'user:invite',
    'user:set_active',
    'user:set_role'
  ))
);

comment on table public.profile_capability_grants is
  'Milestone 24. Per-user ADDITIONAL capabilities, unioned with the base role '
  'matrix to produce a profile''s effective permissions. ADDITIVE ONLY — there '
  'is no deny row and no subtraction; absence of a row means "not delegated", '
  'never "explicitly denied". Revocation DELETES the row: crm_events is the '
  'append-only history, so a revoked_at column here would create a second, '
  'competing history of the same fact. Mutated exclusively through '
  'grant_staff_capability / revoke_staff_capability — service_role holds SELECT '
  'and nothing else.';

comment on column public.profile_capability_grants.capability is
  'One of the delegatable capabilities. Constrained by CHECK rather than left '
  'to application validation: this is the difference between "we validate it" '
  'and "it cannot happen".';

comment on column public.profile_capability_grants.granted_by_profile_id is
  'The administrador who granted it. Nullable only because of ON DELETE SET '
  'NULL; the authoritative, permanent record of who granted what and when is '
  'the corresponding crm_events row, which nothing can alter.';

create index if not exists profile_capability_grants_profile_id_idx
  on public.profile_capability_grants (profile_id);


-- ----------------------------------------------------------------------------
-- C. Privileges + RLS — same posture as crm_events and profiles
-- ----------------------------------------------------------------------------
alter table public.profile_capability_grants enable row level security;

-- TRUNCATE is a Supabase default-grant artifact on new public tables (see the
-- Milestone 21 header). Revoked for the same reason it was there: nothing in
-- this application ever truncates a table, so the privilege is pure risk.
revoke truncate on public.profile_capability_grants from anon;
revoke truncate on public.profile_capability_grants from authenticated;
revoke truncate on public.profile_capability_grants from service_role;

-- SELECT ONLY for the application. INSERT / UPDATE / DELETE are NOT granted
-- and must stay withheld: every mutation goes through the two SECURITY
-- DEFINER functions below, so a grant can never be written without its audit
-- event, exactly as crm_events cannot be written without its mutation.
grant select on public.profile_capability_grants to service_role;

-- getCurrentProfile() resolves a user's own effective capabilities through the
-- AUTHENTICATED (RLS-scoped) client, not the admin client — resolving your own
-- permissions must not require privilege escalation. This policy mirrors
-- profiles_select_own: a signed-in user may read their OWN grant rows and
-- nothing else. Reading ANOTHER user's grants (the admin screen) goes through
-- service_role, which bypasses RLS, exactly as getProfiles() already does.
grant select on public.profile_capability_grants to authenticated;

drop policy if exists profile_capability_grants_select_own
  on public.profile_capability_grants;

create policy profile_capability_grants_select_own
  on public.profile_capability_grants
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.profiles p
      where p.id = profile_capability_grants.profile_id
        and p.auth_user_id = auth.uid()
    )
  );


-- ----------------------------------------------------------------------------
-- D. grant_staff_capability
-- ----------------------------------------------------------------------------
-- A6: the actor guard here is a HARD ROLE TEST, not a capability test, and
-- that is the single most important line in this migration. Testing for
-- `user:manage_permissions` would mean the database asking a question whose
-- answer lives in TypeScript; testing for the ROLE is something SQL can state
-- exactly and nothing delegable can satisfy.
--
-- Returns the grant id, NULL when the target profile does not exist. A
-- duplicate grant returns the existing id and writes NO event.
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

  -- A5. Nobody grants themselves anything, administrador included. An
  -- administrador already holds every capability, so this forbids nothing
  -- legitimate — it removes the shape of self-escalation entirely.
  if p_profile_id = p_actor_profile_id then
    raise exception 'grant_staff_capability: an actor cannot grant capabilities to their own profile'
      using errcode = '22023';
  end if;

  -- A7 + A8, stated explicitly so the caller gets a clean, mappable error
  -- instead of a raw CHECK violation. The constraint remains the guarantee.
  if p_capability not in ('user:invite', 'user:set_active', 'user:set_role') then
    raise exception 'grant_staff_capability: "%" is not a delegatable capability', p_capability
      using errcode = '22023';
  end if;

  select true into v_target_exists from public.profiles where id = p_profile_id;
  if not found then
    return null;
  end if;

  -- Already held: idempotent success, no duplicate row, no event. A trail of
  -- non-changes is noise, not history — same rule as every Milestone 20
  -- function.
  select id into v_grant_id
  from public.profile_capability_grants
  where profile_id = p_profile_id and capability = p_capability;

  if v_grant_id is not null then
    return v_grant_id;
  end if;

  insert into public.profile_capability_grants (profile_id, capability, granted_by_profile_id)
  values (p_profile_id, p_capability, p_actor_profile_id)
  returning id into v_grant_id;

  -- The capability is the entire security-relevant fact. No e-mail, no name,
  -- no role, no auth UUID: crm_events is append-only with no delete path, so
  -- anything written here can never be corrected or erased.
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


-- ----------------------------------------------------------------------------
-- E. revoke_staff_capability
-- ----------------------------------------------------------------------------
-- Same guards as the grant path. Revoking a capability the target does not
-- hold is an idempotent success that writes no event.
create or replace function public.revoke_staff_capability(
  p_profile_id uuid,
  p_capability text,
  p_actor_profile_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_deleted_id uuid;
begin
  -- A6.
  if not exists (
    select 1 from public.profiles
    where id = p_actor_profile_id and active and role = 'administrador'
  ) then
    raise exception 'revoke_staff_capability: actor is not an active administrador'
      using errcode = '42501';
  end if;

  -- A5.
  if p_profile_id = p_actor_profile_id then
    raise exception 'revoke_staff_capability: an actor cannot revoke capabilities from their own profile'
      using errcode = '22023';
  end if;

  if not exists (select 1 from public.profiles where id = p_profile_id) then
    return null;
  end if;

  delete from public.profile_capability_grants
  where profile_id = p_profile_id and capability = p_capability
  returning id into v_deleted_id;

  -- Not held. Success, no event.
  if v_deleted_id is null then
    return p_profile_id;
  end if;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value
  ) values (
    'user_capability_revoked', 'profile', p_profile_id, null, null,
    p_actor_profile_id, 'human', 'crm_manual',
    jsonb_build_object('capability', p_capability),
    null
  );

  return p_profile_id;
end;
$$;


-- ----------------------------------------------------------------------------
-- F. create_staff_profile — actor guard relaxed, A2 added
-- ----------------------------------------------------------------------------
-- Milestone 21 body, with the administrador actor guard replaced by an
-- active-profile identity check plus A2. A delegated holder of `user:invite`
-- may now invite ordinary staff; only an administrador may invite another
-- administrador.
create or replace function public.create_staff_profile(
  p_email text,
  p_full_name text,
  p_role text,
  p_preferred_language text,
  p_actor_profile_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid;
  v_actor_role text;
begin
  -- IDENTITY, not authorization. requireCapability("user:invite") is the
  -- caller-authorization boundary; this only refuses an actor who is not a
  -- real, currently-active member of staff.
  select role into v_actor_role
  from public.profiles
  where id = p_actor_profile_id and active;

  if not found then
    raise exception 'create_staff_profile: actor is not an active profile'
      using errcode = '42501';
  end if;

  -- A2. Only an administrador may bring another administrador into existence.
  if p_role = 'administrador' and v_actor_role <> 'administrador' then
    raise exception 'create_staff_profile: only an administrador may create an administrador'
      using errcode = '42501';
  end if;

  if p_role not in ('administrador', 'gerente', 'analista', 'asesor', 'consulta') then
    raise exception 'create_staff_profile: invalid role "%"', p_role using errcode = '22023';
  end if;

  -- profiles has no CHECK on preferred_language, so it is validated here.
  if p_preferred_language not in ('es', 'en', 'fr') then
    raise exception 'create_staff_profile: invalid preferred_language "%"', p_preferred_language
      using errcode = '22023';
  end if;

  insert into public.profiles (full_name, email, role, preferred_language, active)
  values (p_full_name, p_email, p_role, p_preferred_language, true)
  returning id into v_profile_id;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value
  ) values (
    'user_invited', 'profile', v_profile_id, null, null,
    p_actor_profile_id, 'human', 'crm_manual',
    null,
    jsonb_build_object('role', p_role)
  );

  return v_profile_id;
end;
$$;


-- ----------------------------------------------------------------------------
-- G. link_staff_profile_auth — actor guard relaxed, A1 added
-- ----------------------------------------------------------------------------
-- Stage 3 of the invitation flow. A delegated inviter must be able to complete
-- the invitation they started, so the actor guard matches create_staff_profile;
-- A1 still reserves anything touching an administrador for an administrador.
-- NEVER matches on e-mail — the auth UUID returned by Supabase is the only key
-- (Milestone 21 finding: 2 of 3 profile/auth e-mail pairs differ).
create or replace function public.link_staff_profile_auth(
  p_profile_id uuid,
  p_auth_user_id uuid,
  p_actor_profile_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing_auth_user_id uuid;
  v_target_role text;
  v_actor_role text;
begin
  select role into v_actor_role
  from public.profiles
  where id = p_actor_profile_id and active;

  if not found then
    raise exception 'link_staff_profile_auth: actor is not an active profile'
      using errcode = '42501';
  end if;

  select auth_user_id, role into v_existing_auth_user_id, v_target_role
  from public.profiles
  where id = p_profile_id
  for update;

  if not found then
    return null;
  end if;

  -- A1.
  if v_target_role = 'administrador' and v_actor_role <> 'administrador' then
    raise exception 'link_staff_profile_auth: only an administrador may modify an administrador'
      using errcode = '42501';
  end if;

  -- Idempotent for the SAME auth user; refuses to re-point an already-linked
  -- profile at a different one. Writes no event either way: linking is the
  -- mechanical completion of an invitation already recorded by 'user_invited'.
  if v_existing_auth_user_id is not null then
    if v_existing_auth_user_id = p_auth_user_id then
      return p_profile_id;
    end if;
    raise exception 'link_staff_profile_auth: profile % is already linked to a different auth user', p_profile_id
      using errcode = '22023';
  end if;

  update public.profiles
  set auth_user_id = p_auth_user_id
  where id = p_profile_id;

  return p_profile_id;
end;
$$;


-- ----------------------------------------------------------------------------
-- H. update_staff_role — actor guard relaxed; A1, A2, A3 added;
--    AND grants revoked atomically on role change
-- ----------------------------------------------------------------------------
-- GRANT REVOCATION IS THE POINT, not a side effect. An employee moved from
-- gerente to asesor must not silently retain delegated staff-management
-- authority: the delegation was made in the context of a role that no longer
-- applies. Revoking is safe, obvious and fully recoverable (re-grant);
-- retaining would be a permission combination nobody deliberately created.
-- Each removed grant emits its own user_capability_revoked event so the trail
-- explains WHY the authority disappeared.
create or replace function public.update_staff_role(
  p_profile_id uuid,
  p_new_role text,
  p_actor_profile_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_previous_role text;
  v_actor_role text;
  v_revoked record;
begin
  select role into v_actor_role
  from public.profiles
  where id = p_actor_profile_id and active;

  if not found then
    raise exception 'update_staff_role: actor is not an active profile'
      using errcode = '42501';
  end if;

  -- A3. Checked before the target is even read: changing your own role is
  -- never legitimate regardless of who you are, and an administrador who
  -- demoted themselves could leave the CRM with no administrador at all.
  if p_profile_id = p_actor_profile_id then
    raise exception 'update_staff_role: an actor cannot change their own role'
      using errcode = '22023';
  end if;

  if p_new_role not in ('administrador', 'gerente', 'analista', 'asesor', 'consulta') then
    raise exception 'update_staff_role: invalid role "%"', p_new_role using errcode = '22023';
  end if;

  select role into v_previous_role
  from public.profiles
  where id = p_profile_id
  for update;

  if not found then
    return null;
  end if;

  -- A1. Touching an existing administrador requires being one.
  if v_previous_role = 'administrador' and v_actor_role <> 'administrador' then
    raise exception 'update_staff_role: only an administrador may modify an administrador'
      using errcode = '42501';
  end if;

  -- A2. Creating a new administrador requires being one.
  if p_new_role = 'administrador' and v_actor_role <> 'administrador' then
    raise exception 'update_staff_role: only an administrador may assign the administrador role'
      using errcode = '42501';
  end if;

  -- Genuine no-op: success, no event, and grants are LEFT ALONE. Nothing
  -- changed, so nothing should be revoked.
  if v_previous_role = p_new_role then
    return p_profile_id;
  end if;

  update public.profiles
  set role = p_new_role
  where id = p_profile_id;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value
  ) values (
    'user_role_changed', 'profile', p_profile_id, null, null,
    p_actor_profile_id, 'human', 'crm_manual',
    jsonb_build_object('role', v_previous_role),
    jsonb_build_object('role', p_new_role)
  );

  -- Revoke every additional grant, one audited event each, in the SAME
  -- transaction as the role change. Attributed to the actor who changed the
  -- role, because that is the act that caused the revocation.
  for v_revoked in
    delete from public.profile_capability_grants
    where profile_id = p_profile_id
    returning capability
  loop
    insert into public.crm_events (
      event_type, entity_type, entity_id, client_id, application_id,
      actor_profile_id, actor_kind, source, previous_value, new_value
    ) values (
      'user_capability_revoked', 'profile', p_profile_id, null, null,
      p_actor_profile_id, 'human', 'crm_manual',
      jsonb_build_object('capability', v_revoked.capability),
      null
    );
  end loop;

  return p_profile_id;
end;
$$;


-- ----------------------------------------------------------------------------
-- I. set_staff_active_status — actor guard relaxed; A1, A4 added
-- ----------------------------------------------------------------------------
-- GRANTS ARE DELIBERATELY NOT DELETED HERE. An inactive profile cannot enter
-- the CRM at all (getCurrentProfile() returns null for it), so its grants are
-- already inert — there is nothing to protect against. Deleting them would
-- destroy the record of what was delegated and force an administrador to
-- reconstruct it from memory on reactivation. Retention matches the
-- deactivate-only, never-destroy posture of the whole staff lifecycle.
create or replace function public.set_staff_active_status(
  p_profile_id uuid,
  p_active boolean,
  p_actor_profile_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_previous_active boolean;
  v_target_role text;
  v_actor_role text;
begin
  select role into v_actor_role
  from public.profiles
  where id = p_actor_profile_id and active;

  if not found then
    raise exception 'set_staff_active_status: actor is not an active profile'
      using errcode = '42501';
  end if;

  -- A4. Milestone 21 refused self-DEACTIVATION; Milestone 24 refuses any
  -- self-change of active state. The asymmetry served no purpose, and a
  -- delegated manager toggling their own status is exactly the shape of
  -- self-modification this milestone removes everywhere else.
  if p_profile_id = p_actor_profile_id then
    raise exception 'set_staff_active_status: an actor cannot change their own active status'
      using errcode = '22023';
  end if;

  select active, role into v_previous_active, v_target_role
  from public.profiles
  where id = p_profile_id
  for update;

  if not found then
    return null;
  end if;

  -- A1. A delegated manager must never be able to lock out an administrador.
  if v_target_role = 'administrador' and v_actor_role <> 'administrador' then
    raise exception 'set_staff_active_status: only an administrador may modify an administrador'
      using errcode = '42501';
  end if;

  if v_previous_active = p_active then
    return p_profile_id;
  end if;

  update public.profiles
  set active = p_active
  where id = p_profile_id;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value
  ) values (
    case when p_active then 'user_reactivated' else 'user_deactivated' end,
    'profile', p_profile_id, null, null,
    p_actor_profile_id, 'human', 'crm_manual',
    jsonb_build_object('active', v_previous_active),
    jsonb_build_object('active', p_active)
  );

  return p_profile_id;
end;
$$;


-- ----------------------------------------------------------------------------
-- J. Execute privileges — unchanged posture, restated for all six functions
-- ----------------------------------------------------------------------------
-- CREATE OR REPLACE preserves ownership and privileges, so the four replaced
-- functions keep the Milestone 16/21 posture on their own. Restated anyway —
-- idempotent, and it keeps the intended posture visible in schema history
-- rather than implied.
revoke execute on function public.grant_staff_capability(uuid, text, uuid) from public;
revoke execute on function public.revoke_staff_capability(uuid, text, uuid) from public;
revoke execute on function public.create_staff_profile(text, text, text, text, uuid) from public;
revoke execute on function public.link_staff_profile_auth(uuid, uuid, uuid) from public;
revoke execute on function public.update_staff_role(uuid, text, uuid) from public;
revoke execute on function public.set_staff_active_status(uuid, boolean, uuid) from public;

revoke execute on function public.grant_staff_capability(uuid, text, uuid) from anon, authenticated;
revoke execute on function public.revoke_staff_capability(uuid, text, uuid) from anon, authenticated;
revoke execute on function public.create_staff_profile(text, text, text, text, uuid) from anon, authenticated;
revoke execute on function public.link_staff_profile_auth(uuid, uuid, uuid) from anon, authenticated;
revoke execute on function public.update_staff_role(uuid, text, uuid) from anon, authenticated;
revoke execute on function public.set_staff_active_status(uuid, boolean, uuid) from anon, authenticated;

grant execute on function public.grant_staff_capability(uuid, text, uuid) to service_role;
grant execute on function public.revoke_staff_capability(uuid, text, uuid) to service_role;
grant execute on function public.create_staff_profile(text, text, text, text, uuid) to service_role;
grant execute on function public.link_staff_profile_auth(uuid, uuid, uuid) to service_role;
grant execute on function public.update_staff_role(uuid, text, uuid) to service_role;
grant execute on function public.set_staff_active_status(uuid, boolean, uuid) to service_role;
