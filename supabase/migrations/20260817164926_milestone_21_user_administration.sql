-- ============================================================================
-- Milestone 21 — Staff (user) administration
-- ============================================================================
--
-- PURPOSE. Milestone 18 removed a toast-only "Invite user" button because it
-- did nothing. Milestone 16 deliberately withheld the privilege that would
-- have made it work, stating: "service_role still holds NO insert or update
-- privilege on public.profiles. Creating and editing users is Milestone 21's
-- scope, and granting the privilege early would open a write path this
-- milestone has no code to guard."
--
-- This migration opens that path — but NOT by granting service_role direct
-- INSERT/UPDATE. It follows Milestone 20's architecture instead: four
-- SECURITY DEFINER functions are the only writers, each performing the
-- profile mutation and its crm_events audit append in ONE transaction.
-- service_role's direct privileges on `profiles` stay exactly as Milestone 16
-- left them: SELECT only.
--
-- ----------------------------------------------------------------------------
-- AUTHORIZATION INSIDE THE FUNCTIONS — A DELIBERATE, NARROW DUPLICATION
-- ----------------------------------------------------------------------------
-- src/lib/auth/capabilities.ts is and remains the ONE authorization matrix;
-- nothing here re-encodes it. But these four functions can grant the
-- administrador role to anybody, so leaving them callable with an arbitrary
-- actor id would make a single bug in the Server Action layer a
-- privilege-escalation hole.
--
-- Each therefore re-checks exactly ONE fact — "the actor is an active
-- administrador" — as defence in depth. That is a guard, not a second matrix:
-- it duplicates one grant, not the vocabulary. If user administration is ever
-- widened beyond administrador, BOTH this file and ROLE_CAPABILITIES must
-- change; that coupling is the price of the guard and is accepted knowingly.
--
-- ----------------------------------------------------------------------------
-- WHY NO DELETION FUNCTION EXISTS
-- ----------------------------------------------------------------------------
-- Milestone 21's approved policy is deactivate-only. There is no
-- delete_staff_profile, and no auth-user deletion path anywhere in the
-- application. The database agrees: messages.sender_profile_id is
-- ON DELETE RESTRICT, so a profile that has ever sent a chat message cannot
-- be deleted at all, and profiles.id is the attribution target of nearly
-- every audit fact in this schema. Deactivation already blocks access
-- completely — getCurrentProfile() returns null for active = false, which
-- the (app) layout and all 25+ guarded Server Actions honour.
--
-- ----------------------------------------------------------------------------
-- EMAIL IS NOT AN IDENTITY JOIN KEY — VERIFIED LIVE
-- ----------------------------------------------------------------------------
-- Two of the three currently linked accounts have a DIFFERENT address in
-- auth.users than in profiles (e.g. gabriel.herrera@odlfinancial.com is
-- linked to gabriel.dev@odl.local). link_staff_profile_auth therefore takes
-- the auth UUID as an explicit parameter and never matches on e-mail. Nothing
-- in this migration reads profiles.email to establish identity.
--
-- IDEMPOTENCY: create-or-replace for functions; catalog-guarded DO blocks for
-- the constraint swaps; revokes are naturally idempotent. Matches
-- 20260817062939_milestone_16_security_floor.sql.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- A. Widen the crm_events vocabulary
-- ----------------------------------------------------------------------------
-- Additive only. Milestone 20's own table comment anticipated this: "future
-- milestones will widen this vocabulary additively, the same way this schema
-- always widens closed vocabularies." A CHECK constraint cannot be extended
-- in place, so each is dropped and re-added with the superset — the same
-- DROP/ADD pattern this schema uses for every closed vocabulary.
--
-- Staff administration is exactly the accountability case an audit trail
-- exists for: who granted whom administrador, and when.
do $$
begin
  if exists (
    select 1 from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'crm_events'
      and con.conname = 'crm_events_event_type_check'
  ) then
    alter table public.crm_events drop constraint crm_events_event_type_check;
  end if;

  alter table public.crm_events
    add constraint crm_events_event_type_check check (event_type in (
      -- Milestone 20
      'application_status_changed',
      'requirement_status_changed',
      'alert_resolved',
      'alert_reactivated',
      'client_status_changed',
      'client_profile_updated',
      'application_advisor_assigned',
      'client_restriction_changed',
      -- Milestone 21
      'user_invited',
      'user_role_changed',
      'user_deactivated',
      'user_reactivated'
    ));
end
$$;

do $$
begin
  if exists (
    select 1 from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'crm_events'
      and con.conname = 'crm_events_entity_type_check'
  ) then
    alter table public.crm_events drop constraint crm_events_entity_type_check;
  end if;

  alter table public.crm_events
    add constraint crm_events_entity_type_check check (entity_type in (
      'application',
      'requirement_slot',
      'dossier_alert',
      'client',
      -- Milestone 21: the subject of a staff-administration event.
      'profile'
    ));
end
$$;


-- ----------------------------------------------------------------------------
-- B. profiles privilege hardening
-- ----------------------------------------------------------------------------
-- Live inspection found service_role (and anon/authenticated) holding
-- TRUNCATE on public.profiles — a Supabase default-grant artifact present on
-- every table in this project, not something any migration asked for. It is
-- not reachable through PostgREST, but a role that cannot UPDATE one row
-- should certainly not be able to empty the table, and this migration is
-- already touching `profiles`.
--
-- INSERT / UPDATE / DELETE are NOT granted here and must stay withheld: the
-- four functions below are the only write path.
revoke truncate on public.profiles from anon;
revoke truncate on public.profiles from authenticated;
revoke truncate on public.profiles from service_role;


-- ============================================================================
-- C. The four staff-administration functions
-- ============================================================================
-- Same architecture as Milestone 20: SECURITY DEFINER, owner postgres,
-- `set search_path = public, pg_temp`, no dynamic SQL, EXECUTE revoked from
-- PUBLIC and granted only to service_role. Each returns the affected
-- profile's id, or NULL when nothing changed — the caller re-reads and maps
-- NULL to its own result code, the idiom review_application_analysis and the
-- Milestone 20 functions already use.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- C1. Create a staff profile (step 1 of the invitation workflow)
-- ----------------------------------------------------------------------------
-- Creates the profile with auth_user_id NULL — a pending invitation. That is
-- not a degraded state: it is the documented meaning of a null auth_user_id
-- ("staff member with no login issued yet"), and five live profiles are
-- already in it. The Supabase Auth invitation happens OUTSIDE this
-- transaction, and link_staff_profile_auth attaches its result afterwards.
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
begin
  -- Defence in depth: see this migration's header for why one fact is
  -- deliberately re-checked here.
  if not exists (
    select 1 from public.profiles
    where id = p_actor_profile_id and active and role = 'administrador'
  ) then
    raise exception 'create_staff_profile: actor is not an active administrador'
      using errcode = '42501';
  end if;

  if p_role not in ('administrador', 'gerente', 'analista', 'asesor', 'consulta') then
    raise exception 'create_staff_profile: invalid role "%"', p_role using errcode = '22023';
  end if;

  -- profiles has no CHECK on preferred_language (verified live), so this
  -- function is the only thing standing between a typo and a row the UI
  -- cannot render. Mirrors SupportedLanguage in src/types/user.ts.
  if p_preferred_language not in ('en', 'es', 'fr') then
    raise exception 'create_staff_profile: invalid preferred_language "%"', p_preferred_language
      using errcode = '22023';
  end if;

  -- legacy_id is deliberately NOT set. It is a retired compatibility bridge
  -- with no runtime reader left as of Milestone 21; new staff never get one.
  -- profiles_email_key raises 23505 on a duplicate, which the caller maps to
  -- DUPLICATE_EMAIL.
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
    -- Role is the security-relevant fact. No e-mail, no name: this table is
    -- append-only with no delete path, and the profile itself already holds
    -- the contact details.
    jsonb_build_object('role', p_role)
  );

  return v_profile_id;
end;
$$;


-- ----------------------------------------------------------------------------
-- C2. Link an auth account to a staff profile (step 3 of the workflow)
-- ----------------------------------------------------------------------------
-- NEVER matches on e-mail — see the migration header. The auth UUID is
-- supplied by the caller, taken from what Supabase Auth actually returned.
--
-- Idempotent by design so a failed step 3 can simply be retried: re-linking
-- the SAME auth user is a success, not a conflict. Re-pointing a profile at a
-- DIFFERENT auth account is refused — that is an identity change, not a
-- retry, and it is not something this milestone supports.
--
-- Writes no crm_events row: linking completes an invitation that
-- 'user_invited' already recorded. It is a mechanical completion, not a
-- decision anyone made.
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
  v_existing uuid;
  v_found boolean;
begin
  if not exists (
    select 1 from public.profiles
    where id = p_actor_profile_id and active and role = 'administrador'
  ) then
    raise exception 'link_staff_profile_auth: actor is not an active administrador'
      using errcode = '42501';
  end if;

  select auth_user_id, true into v_existing, v_found
  from public.profiles
  where id = p_profile_id
  for update;

  -- No such profile. The caller maps NULL to PROFILE_NOT_FOUND.
  if not coalesce(v_found, false) then
    return null;
  end if;

  -- Already linked to this exact account — the retry case. Success.
  if v_existing = p_auth_user_id then
    return p_profile_id;
  end if;

  if v_existing is not null then
    raise exception 'link_staff_profile_auth: profile % is already linked to a different auth user', p_profile_id
      using errcode = '22023';
  end if;

  -- profiles_auth_user_id_key raises 23505 if this auth account is already
  -- attached to some other profile — a genuine conflict the caller surfaces.
  update public.profiles
  set auth_user_id = p_auth_user_id
  where id = p_profile_id;

  return p_profile_id;
end;
$$;


-- ----------------------------------------------------------------------------
-- C3. Change a staff member's role
-- ----------------------------------------------------------------------------
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
begin
  if not exists (
    select 1 from public.profiles
    where id = p_actor_profile_id and active and role = 'administrador'
  ) then
    raise exception 'update_staff_role: actor is not an active administrador'
      using errcode = '42501';
  end if;

  if p_new_role not in ('administrador', 'gerente', 'analista', 'asesor', 'consulta') then
    raise exception 'update_staff_role: invalid role "%"', p_new_role using errcode = '22023';
  end if;

  -- `for update` holds the row so previous_value is genuinely the value being
  -- replaced, not one another transaction already changed.
  select role into v_previous_role
  from public.profiles
  where id = p_profile_id
  for update;

  if v_previous_role is null then
    return null;
  end if;

  -- Genuine no-op: success, but no event. A trail of non-changes is noise.
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

  return p_profile_id;
end;
$$;


-- ----------------------------------------------------------------------------
-- C4. Deactivate / reactivate a staff member
-- ----------------------------------------------------------------------------
-- This is the ONLY offboarding mechanism. active = false is already a hard
-- access block: getCurrentProfile() returns null for it, so the (app) layout
-- redirects to /login and every guarded Server Action returns UNAUTHENTICATED.
-- The row, and every audit fact attributed to it, is retained permanently.
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
  v_found boolean;
begin
  if not exists (
    select 1 from public.profiles
    where id = p_actor_profile_id and active and role = 'administrador'
  ) then
    raise exception 'set_staff_active_status: actor is not an active administrador'
      using errcode = '42501';
  end if;

  -- An administrator deactivating themselves would lock the last
  -- administrator out of user administration with no way back in through the
  -- product. Refused outright rather than guarded in the UI alone.
  if p_profile_id = p_actor_profile_id and p_active = false then
    raise exception 'set_staff_active_status: an administrator cannot deactivate their own profile'
      using errcode = '22023';
  end if;

  select active, true into v_previous_active, v_found
  from public.profiles
  where id = p_profile_id
  for update;

  if not coalesce(v_found, false) then
    return null;
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
-- D. Function privileges — Milestone 16 security floor
-- ----------------------------------------------------------------------------
revoke execute on function public.create_staff_profile(text, text, text, text, uuid) from public;
revoke execute on function public.link_staff_profile_auth(uuid, uuid, uuid) from public;
revoke execute on function public.update_staff_role(uuid, text, uuid) from public;
revoke execute on function public.set_staff_active_status(uuid, boolean, uuid) from public;

revoke execute on function public.create_staff_profile(text, text, text, text, uuid) from anon, authenticated;
revoke execute on function public.link_staff_profile_auth(uuid, uuid, uuid) from anon, authenticated;
revoke execute on function public.update_staff_role(uuid, text, uuid) from anon, authenticated;
revoke execute on function public.set_staff_active_status(uuid, boolean, uuid) from anon, authenticated;

grant execute on function public.create_staff_profile(text, text, text, text, uuid) to service_role;
grant execute on function public.link_staff_profile_auth(uuid, uuid, uuid) to service_role;
grant execute on function public.update_staff_role(uuid, text, uuid) to service_role;
grant execute on function public.set_staff_active_status(uuid, boolean, uuid) to service_role;
