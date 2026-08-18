-- ============================================================================
-- Milestone 25A — Branch foundations
-- ============================================================================
--
-- PURPOSE. ODL is becoming a national platform with branches across Panama.
-- This migration establishes the STRUCTURE for that — branches, staff branch
-- scope, and branch ownership columns — and deliberately activates NO data
-- isolation whatsoever.
--
-- ----------------------------------------------------------------------------
-- THE ACCEPTANCE PROPERTY OF THIS MIGRATION
-- ----------------------------------------------------------------------------
-- WITH ZERO BRANCHES AND ZERO MEMBERSHIPS, THE CRM MUST BEHAVE EXACTLY AS IT
-- DID IN MILESTONE 24.
--
-- No existing read suddenly hides a row. No existing mutation suddenly fails
-- because branch data is absent. Every branch ownership column is NULLABLE and
-- unpopulated; no existing RPC is replaced; nothing is backfilled.
--
-- That is why branch ENFORCEMENT is Milestone 25B and not this migration: 25A
-- is provably behaviour-neutral and independently reviewable, while 25B is the
-- security change that deserves its own verification pass. Shipping them
-- together would bury the risky half inside a large additive diff.
--
-- ----------------------------------------------------------------------------
-- THE THIRD AXIS
-- ----------------------------------------------------------------------------
--   ROLE         what kind of work may this person perform?
--   CAPABILITY   what additional actions may this person perform?
--   BRANCH SCOPE on WHICH branch's data may they perform them?
--
-- Three independent concepts, never merged. Authorization becomes
-- hasCapability(action) AND hasBranchScope(targetBranch) — the second half
-- lands in 25B.
--
-- NATIONAL REACH IS NOT A CAPABILITY. It is profiles.branch_scope_mode, set
-- only by an administrador. Were it a capability it would be grantable through
-- profile_capability_grants, letting DATA SCOPE be widened by a mechanism built
-- for ACTION permissions. Delegating an action must never delegate scope — the
-- single rule the whole branch design rests on.
--
-- ----------------------------------------------------------------------------
-- WHO ENFORCES WHAT  (unchanged from Milestones 23/24)
-- ----------------------------------------------------------------------------
--   requireCapability()  -> CALLER AUTHORIZATION, in the Server Action.
--   these functions      -> TARGET / DOMAIN INVARIANTS (B1-B6).
--
-- Every invariant below is expressible with ROLES, IDENTITY and MEMBERSHIP
-- alone — never capabilities — so ROLE_CAPABILITIES is not duplicated in
-- PostgreSQL and never will be.
--
-- ----------------------------------------------------------------------------
-- THE INVARIANTS (B1-B6)
-- ----------------------------------------------------------------------------
--   B1  An actor may assign a profile only to branches inside the actor's own
--       server-resolved branch scope.
--   B2  An actor may modify a target's memberships only when the target's
--       CURRENT memberships are a subset of the actor's scope.
--   B3  No actor may modify their OWN memberships, primary branch, or
--       branch_scope_mode — administrador included.
--   B4  Only an administrador may set branch_scope_mode. Hard role test, never
--       capability-derived.
--   B5  Only an administrador may modify an administrador's memberships or
--       scope mode.
--   B6  Delegated branch:manage acts only inside the intersection of capability
--       authority and the actor's own branch scope. It NEVER expands scope: it
--       cannot create a branch (that is branch:create, non-delegatable), cannot
--       add the actor anywhere (B3), and cannot reach outside the actor's
--       scope (B1).
--
-- ----------------------------------------------------------------------------
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
-- ----------------------------------------------------------------------------
--   * Creates NO branch row. Not one, not a placeholder, not a TEMP. ODL's real
--     branch list is Damion's to supply; inventing organizational data would be
--     exactly the fabrication Milestones 18 and 22 spent so long removing.
--   * Backfills nothing. clients.branch_id and applications.branch_id stay
--     NULLABLE, which is why no placeholder branch is technically necessary.
--     They are promoted to NOT NULL at cutover, against real data.
--   * Replaces NO existing RPC. The M20/M21/M23/M24 functions are untouched,
--     protecting the behaviour-neutral checkpoint.
--   * Deletes no fixture, touches no Auth user, sends no invitation, modifies
--     no profile, removes no storage object.
--   * Grants service_role no new mutation privilege on any table.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- A. branches
-- ----------------------------------------------------------------------------
create table if not exists public.branches (
  id uuid primary key default gen_random_uuid(),

  -- STABLE MACHINE IDENTITY. Every foreign key uses `id`; `code` exists so an
  -- administrator can rename a branch without breaking anything, and so humans
  -- have something short to say. Milestone 21's legacy_id lesson applied in
  -- advance: an identity you can rename is not an identity.
  code text not null,
  name text not null,

  -- NOT NULL because it is the only descriptive field with real downstream
  -- consumers: regional reporting, and future website intake routing.
  province text not null,

  -- Contact detail. Nullable because a branch is legitimately created before
  -- its phone line exists, and a NOT NULL field with no value becomes
  -- fabricated data at onboarding.
  city text,
  address text,
  phone text,
  email text,

  -- Head office is a PROPERTY of a branch, not a separate entity. Modelling it
  -- separately would fork every query that touches branches.
  is_headquarters boolean not null default false,

  -- Deactivate-only. No delete path exists anywhere for branches: they are
  -- permanent FK targets on historical clients and applications.
  active boolean not null default true,

  created_at timestamptz not null default now(),

  constraint branches_code_key unique (code),
  constraint branches_code_format_check check (code ~ '^[A-Z0-9-]{2,12}$')
);

-- At most ONE headquarters, enforced rather than hoped for.
create unique index if not exists branches_single_headquarters_idx
  on public.branches (is_headquarters) where is_headquarters;

comment on table public.branches is
  'Milestone 25A. ODL organizational branches. DEACTIVATE-ONLY — no delete '
  'path, because branches are permanent foreign-key targets on historical '
  'clients and applications. `code` is the stable machine identity; `name` is '
  'display only and freely editable. Mutated exclusively through create_branch '
  '/ update_branch / set_branch_active — service_role holds SELECT and nothing '
  'else. Starts EMPTY and is never seeded: ODL''s real branch list is supplied '
  'by the business, never invented by a migration.';

comment on column public.branches.province is
  'Required. The one descriptive field with downstream consumers — regional '
  'reporting and future intake routing both key on it.';


-- ----------------------------------------------------------------------------
-- B. profile_branch_memberships
-- ----------------------------------------------------------------------------
-- A NORMALIZED JOIN, not a column on profiles and not a JSON array. One row per
-- (profile, branch) is what makes "one user in several branches" expressible at
-- all, makes "who works in David" an indexed question, and makes a duplicate
-- membership impossible by constraint rather than by application care.
create table if not exists public.profile_branch_memberships (
  id uuid primary key default gen_random_uuid(),

  -- ON DELETE RESTRICT, matching every other profile reference in this schema:
  -- staff are never hard-deleted, and a record of branch assignment must not be
  -- removable as a side effect.
  profile_id uuid not null
    references public.profiles(id) on delete restrict,

  branch_id uuid not null
    references public.branches(id) on delete restrict,

  -- Drives defaults and reporting, NEVER authorization: branch scope is the
  -- full membership set, not the primary one.
  is_primary boolean not null default false,


  assigned_by_profile_id uuid
    references public.profiles(id) on delete set null,
  assigned_at timestamptz not null default now(),

  constraint profile_branch_memberships_unique unique (profile_id, branch_id)
);

-- Deliberately NO `active` column. Two deactivation concepts (profile inactive
-- vs membership inactive) would immediately raise "is an active membership on
-- an inactive profile meaningful?" — a question with no business answer.
-- Removing someone from a branch DELETES the row and audits it, exactly as
-- capability revocation works in Milestone 24. profiles.active stays the single
-- access switch.

-- ONE primary per profile, race-safe by index rather than by application check.
create unique index if not exists profile_branch_memberships_one_primary_idx
  on public.profile_branch_memberships (profile_id) where is_primary;

create index if not exists profile_branch_memberships_branch_id_idx
  on public.profile_branch_memberships (branch_id);

comment on table public.profile_branch_memberships is
  'Milestone 25A. Which branches a staff member may act on. Unioned with '
  'profiles.branch_scope_mode to produce their effective branch scope. '
  'ADDITIVE ONLY — absence of a row means "not assigned", never "explicitly '
  'denied". Removal DELETES the row: crm_events is the append-only history, so '
  'a revoked_at column here would create a second, competing history of the '
  'same fact. Mutated exclusively through assign_profile_branch / '
  'remove_profile_branch / set_profile_primary_branch.';


-- ----------------------------------------------------------------------------
-- C. profiles.branch_scope_mode
-- ----------------------------------------------------------------------------
-- DEFAULT 'branch' is the fail-closed direction: every existing profile becomes
-- branch-scoped with zero memberships, which once 25B lands means they see
-- nothing they should not. Nobody is silently promoted to national.
alter table public.profiles
  add column if not exists branch_scope_mode text not null default 'branch';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_branch_scope_mode_check'
  ) then
    alter table public.profiles
      add constraint profiles_branch_scope_mode_check
      check (branch_scope_mode in ('branch', 'national'));
  end if;
end
$$;

comment on column public.profiles.branch_scope_mode is
  'Milestone 25A. How far this profile''s branch reach extends. ''branch'' = '
  'exactly their memberships; ''national'' = every active branch, present and '
  'future. DELIBERATELY NOT A CAPABILITY: national reach is a scope property '
  'settable only by an administrador (B4), because a capability would be '
  'grantable through profile_capability_grants and would let data scope be '
  'widened by a mechanism built for action permissions.';


-- ----------------------------------------------------------------------------
-- D. Branch ownership columns — ALL NULLABLE, NONE BACKFILLED
-- ----------------------------------------------------------------------------
-- NULLABLE is what makes a fabricated placeholder branch unnecessary. NOT NULL
-- is promoted at cutover, against real branches and real retained rows.
--
-- THE RULE 25B WILL ENFORCE, fixed here so it is not invented later:
--   a row with branch_id IS NULL is visible ONLY to national scope.
-- That fails closed, gives administrators a natural "unassigned" work queue,
-- and means an incomplete backfill can never leak a record into the WRONG
-- branch — it simply hides it from branch-scoped staff until assigned.
alter table public.clients
  add column if not exists branch_id uuid references public.branches(id) on delete restrict;

-- INDEPENDENT of clients.branch_id, and this is the load-bearing decision of
-- the whole milestone. If an application's branch were derived from its client,
-- transferring a client would retroactively rewrite which branch was
-- responsible for every past loan — destroying the truth of "David originated
-- this in March" and making every historical report a lie. crm_events cannot
-- repair that: it records transitions, not a column that never existed.
alter table public.applications
  add column if not exists branch_id uuid references public.branches(id) on delete restrict;

-- Nullable permanently by design: an intake arrives from the public website
-- before any branch is known. NULL means "not yet routed", which is a true
-- statement, and the existing needs_review path already handles it.
alter table public.application_intakes
  add column if not exists branch_id uuid references public.branches(id) on delete restrict;

-- DELIBERATE DENORMALIZATION, approved as decision 5. crm_events.client_id and
-- .application_id are ON DELETE SET NULL, so deriving an event's branch through
-- them breaks exactly when history matters most. Stamped at event creation time
-- and NEVER rewritten — a branch transfer records a new event, it does not
-- rewrite old ones. crm_events is append-only, so this value can never be
-- corrected; that permanence is the point, and the cost is accepted.
alter table public.crm_events
  add column if not exists branch_id uuid references public.branches(id) on delete restrict;

comment on column public.clients.branch_id is
  'Milestone 25A. The client''s home/responsible branch. NULLABLE until cutover '
  'backfills real data — no placeholder branch is invented to satisfy a '
  'constraint. NULL means "not yet assigned" and will be visible only to '
  'national scope once 25B enforces isolation.';

comment on column public.applications.branch_id is
  'Milestone 25A. The branch RESPONSIBLE for this application — deliberately '
  'independent of clients.branch_id. Deriving it from the client would let a '
  'client transfer retroactively rewrite which branch originated every past '
  'loan. Changed only by an explicit, audited transfer (Milestone 25B).';

comment on column public.crm_events.branch_id is
  'Milestone 25A. The branch this event belonged to AT THE MOMENT IT HAPPENED. '
  'Denormalized on purpose: client_id and application_id are ON DELETE SET '
  'NULL, so derivation breaks precisely when history matters. NEVER rewritten '
  'by a transfer — a transfer appends a new event.';

-- Partial indexes: tiny before backfill, correct after.
create index if not exists clients_branch_id_idx
  on public.clients (branch_id) where branch_id is not null;
create index if not exists applications_branch_id_status_idx
  on public.applications (branch_id, status) where branch_id is not null;
create index if not exists application_intakes_branch_id_idx
  on public.application_intakes (branch_id) where branch_id is not null;


-- ----------------------------------------------------------------------------
-- E. crm_events vocabulary — 14 -> 20 event types, +1 entity type
-- ----------------------------------------------------------------------------
-- client_branch_transferred and application_branch_transferred are added NOW so
-- the vocabulary is complete and stable, but are WRITTEN BY NOTHING until 25B
-- implements the transfer operations. Declaring them here means 25B adds
-- behaviour without touching the audit constraint again.
--
-- profile_primary_branch_changed is deliberately ABSENT: a primary change is
-- expressible through assigned/removed, and a third event type for a boolean
-- would be noise, not history.
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
      'user_capability_granted',
      'user_capability_revoked',
      -- Milestone 25A
      'branch_created',
      'branch_updated',
      'branch_deactivated',
      'profile_branch_assigned',
      'profile_branch_removed',
      'profile_branch_scope_changed',
      -- Vocabulary only in 25A; written by the transfer RPCs in 25B.
      'client_branch_transferred',
      'application_branch_transferred'
    ));
end
$$;

do $$
begin
  if exists (
    select 1 from pg_constraint con
    join pg_class rel on rel.oid = con.conrelid
    join pg_namespace nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public' and rel.relname = 'crm_events'
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
      'profile',
      -- Milestone 25A: the subject of a branch-administration event.
      'branch'
    ));
end
$$;


-- ----------------------------------------------------------------------------
-- F. profile_capability_grants allow-list — 3 -> 5 delegatable
-- ----------------------------------------------------------------------------
-- branch:create is ABSENT and must never be added: a branch nobody is yet a
-- member of lies outside every delegated manager's scope, so delegating its
-- creation could only ever be useless (they cannot touch it) or an escalation
-- (if creation assigned them to it). user:manage_permissions remains absent for
-- the Milestone 24 reason — it is the privilege boundary itself.
alter table public.profile_capability_grants
  drop constraint if exists profile_capability_grants_capability_check;

alter table public.profile_capability_grants
  add constraint profile_capability_grants_capability_check check (capability in (
    'user:invite',
    'user:set_active',
    'user:set_role',
    'branch:manage',
    'branch:transfer'
  ));


-- ----------------------------------------------------------------------------
-- G. Privileges + RLS — identical posture to profile_capability_grants
-- ----------------------------------------------------------------------------
alter table public.branches enable row level security;
alter table public.profile_branch_memberships enable row level security;

revoke truncate on public.branches from anon, authenticated, service_role;
revoke truncate on public.profile_branch_memberships from anon, authenticated, service_role;

-- SELECT ONLY. INSERT / UPDATE / DELETE are NOT granted and must stay withheld:
-- every mutation goes through the SECURITY DEFINER functions below, so a branch
-- or membership can never be written without its audit event — exactly as
-- crm_events cannot be written without its mutation.
grant select on public.branches to service_role;
grant select on public.profile_branch_memberships to service_role;

-- getCurrentProfile() resolves a user's OWN branch scope through the
-- AUTHENTICATED (RLS-scoped) client, not the admin client — resolving your own
-- scope must not require privilege escalation. Mirrors
-- profile_capability_grants_select_own exactly. Reading ANOTHER user's
-- memberships (the admin screen) goes through service_role, which bypasses RLS.
grant select on public.profile_branch_memberships to authenticated;

drop policy if exists profile_branch_memberships_select_own
  on public.profile_branch_memberships;

create policy profile_branch_memberships_select_own
  on public.profile_branch_memberships
  for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = profile_branch_memberships.profile_id
        and p.auth_user_id = auth.uid()
    )
  );

-- `branches` is deliberately NOT readable by `authenticated`: branch scope
-- resolution needs only the caller's membership rows, and the branch directory
-- itself is administrative data served through service_role.


-- ----------------------------------------------------------------------------
-- H. profile_has_branch_scope — the shared scope predicate
-- ----------------------------------------------------------------------------
-- Created in 25A, consumed primarily in 25B. Deliberately knows nothing about
-- ROLE_CAPABILITIES: it answers "does this profile reach this branch", which is
-- a question about scope mode and membership only.
create or replace function public.profile_has_branch_scope(
  p_profile_id uuid,
  p_branch_id uuid
) returns boolean
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = p_profile_id
      and p.branch_scope_mode = 'national'
  ) or exists (
    select 1 from public.profile_branch_memberships m
    where m.profile_id = p_profile_id
      and m.branch_id = p_branch_id
  );
$$;


-- ----------------------------------------------------------------------------
-- I. create_branch — STRUCTURAL OWNERSHIP, hard administrador guard
-- ----------------------------------------------------------------------------
-- The actor guard here is a HARD ROLE TEST, exactly like grant_staff_capability
-- in Milestone 24, and for the same reason: branch:create is non-delegatable,
-- so the database must not depend on a capability answer that lives in
-- TypeScript. Creating a branch defines the organization; operating one is
-- branch:manage.
--
-- NO AUTOMATIC MEMBERSHIP for the creator, and no scope-mode change. If
-- creation assigned the creator, branch administration would become a
-- scope-expansion mechanism (B6).
create or replace function public.create_branch(
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
  v_branch_id uuid;
begin
  if not exists (
    select 1 from public.profiles
    where id = p_actor_profile_id and active and role = 'administrador'
  ) then
    raise exception 'create_branch: actor is not an active administrador'
      using errcode = '42501';
  end if;

  insert into public.branches (
    code, name, province, city, address, phone, email, is_headquarters
  ) values (
    upper(btrim(p_code)), btrim(p_name), btrim(p_province),
    nullif(btrim(coalesce(p_city, '')), ''),
    nullif(btrim(coalesce(p_address, '')), ''),
    nullif(btrim(coalesce(p_phone, '')), ''),
    nullif(btrim(coalesce(p_email, '')), ''),
    coalesce(p_is_headquarters, false)
  )
  returning id into v_branch_id;

  -- Code, name and province are organizational facts, not personal data, so
  -- they are safe to record. Phone / e-mail / address are NOT written here —
  -- crm_events is append-only with no delete path, and contact details change.
  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value, branch_id
  ) values (
    'branch_created', 'branch', v_branch_id, null, null,
    p_actor_profile_id, 'human', 'crm_manual',
    null,
    jsonb_build_object('code', upper(btrim(p_code)), 'name', btrim(p_name), 'province', btrim(p_province)),
    v_branch_id
  );

  return v_branch_id;
end;
$$;


-- ----------------------------------------------------------------------------
-- J. update_branch — FIELD NAMES ONLY in the audit
-- ----------------------------------------------------------------------------
-- Same privacy rule as record_client_profile_update: this records WHICH fields
-- changed, never what they changed to. A branch's phone, e-mail and address are
-- contact data that will change over time; copying values into an append-only
-- table with no delete path would make them permanently uncorrectable.
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
begin
  if not exists (select 1 from public.profiles where id = p_actor_profile_id and active) then
    raise exception 'update_branch: actor is not an active profile'
      using errcode = '42501';
  end if;

  select * into v_current from public.branches where id = p_branch_id for update;
  if not found then
    return null;
  end if;

  -- B1/B6: an existing branch may be administered only from inside the actor's
  -- own scope. National actors qualify automatically.
  if not public.profile_has_branch_scope(p_actor_profile_id, p_branch_id) then
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

  -- Nothing genuinely changed: success, no event.
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


-- ----------------------------------------------------------------------------
-- K. set_branch_active
-- ----------------------------------------------------------------------------
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
begin
  if not exists (select 1 from public.profiles where id = p_actor_profile_id and active) then
    raise exception 'set_branch_active: actor is not an active profile'
      using errcode = '42501';
  end if;

  select active into v_previous_active from public.branches where id = p_branch_id for update;
  if not found then
    return null;
  end if;

  if not public.profile_has_branch_scope(p_actor_profile_id, p_branch_id) then
    raise exception 'set_branch_active: branch is outside the actor''s branch scope'
      using errcode = '42501';
  end if;

  if v_previous_active = p_active then
    return p_branch_id;
  end if;

  update public.branches set active = p_active where id = p_branch_id;

  -- One event type covers both directions via before/after, exactly as
  -- client_restriction_changed does. A separate branch_reactivated type would
  -- be a second name for the same fact.
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


-- ----------------------------------------------------------------------------
-- L. assign_profile_branch — B1, B2, B3, B5, B6
-- ----------------------------------------------------------------------------
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

  -- B3. Nobody widens their own reach — administrador included. This removes
  -- the SHAPE of self-escalation rather than trying to bound it.
  if p_profile_id = p_actor_profile_id then
    raise exception 'assign_profile_branch: an actor cannot modify their own branch memberships'
      using errcode = '22023';
  end if;

  select role into v_target_role from public.profiles where id = p_profile_id;
  if not found then
    return null;
  end if;

  -- B5.
  if v_target_role = 'administrador' and v_actor_role <> 'administrador' then
    raise exception 'assign_profile_branch: only an administrador may modify an administrador'
      using errcode = '42501';
  end if;

  if not exists (select 1 from public.branches where id = p_branch_id and active) then
    raise exception 'assign_profile_branch: branch does not exist or is inactive'
      using errcode = '22023';
  end if;

  -- B1/B6. The destination branch must already be inside the actor's own scope.
  -- This is what makes branch:manage incapable of expanding reach.
  if not public.profile_has_branch_scope(p_actor_profile_id, p_branch_id) then
    raise exception 'assign_profile_branch: branch is outside the actor''s branch scope'
      using errcode = '42501';
  end if;

  -- B2. A target whose CURRENT reach exceeds the actor's may not be edited at
  -- all — otherwise a David-scoped manager could quietly restructure a national
  -- or multi-region colleague.
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

  -- Already a member: idempotent success, no duplicate row, no event.
  select id into v_membership_id
  from public.profile_branch_memberships
  where profile_id = p_profile_id and branch_id = p_branch_id;

  if v_membership_id is not null then
    return v_membership_id;
  end if;

  -- One primary per profile. Demoting the previous primary here keeps the
  -- partial unique index satisfied inside the same transaction.
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

  -- Branch id only — never staff name, e-mail or role.
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


-- ----------------------------------------------------------------------------
-- M. remove_profile_branch — same invariants
-- ----------------------------------------------------------------------------
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

  -- B3.
  if p_profile_id = p_actor_profile_id then
    raise exception 'remove_profile_branch: an actor cannot modify their own branch memberships'
      using errcode = '22023';
  end if;

  select role into v_target_role from public.profiles where id = p_profile_id;
  if not found then
    return null;
  end if;

  -- B5.
  if v_target_role = 'administrador' and v_actor_role <> 'administrador' then
    raise exception 'remove_profile_branch: only an administrador may modify an administrador'
      using errcode = '42501';
  end if;

  -- B1/B6.
  if not public.profile_has_branch_scope(p_actor_profile_id, p_branch_id) then
    raise exception 'remove_profile_branch: branch is outside the actor''s branch scope'
      using errcode = '42501';
  end if;

  -- B2.
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

  delete from public.profile_branch_memberships
  where profile_id = p_profile_id and branch_id = p_branch_id
  returning id into v_deleted_id;

  -- Not a member: success, no event.
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


-- ----------------------------------------------------------------------------
-- N. set_profile_primary_branch
-- ----------------------------------------------------------------------------
-- No dedicated event type: a primary change is expressible through the
-- assigned/removed pair, and a third type for a boolean would be noise. The
-- partial unique index makes "one primary" race-safe rather than hoped-for.
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

  -- B3.
  if p_profile_id = p_actor_profile_id then
    raise exception 'set_profile_primary_branch: an actor cannot modify their own primary branch'
      using errcode = '22023';
  end if;

  select role into v_target_role from public.profiles where id = p_profile_id;
  if not found then
    return null;
  end if;

  -- B5.
  if v_target_role = 'administrador' and v_actor_role <> 'administrador' then
    raise exception 'set_profile_primary_branch: only an administrador may modify an administrador'
      using errcode = '42501';
  end if;

  -- B1/B6.
  if not public.profile_has_branch_scope(p_actor_profile_id, p_branch_id) then
    raise exception 'set_profile_primary_branch: branch is outside the actor''s branch scope'
      using errcode = '42501';
  end if;

  -- B2.
  select count(*) into v_out_of_scope
  from public.profile_branch_memberships m
  where m.profile_id = p_profile_id
    and not public.profile_has_branch_scope(p_actor_profile_id, m.branch_id);

  if v_out_of_scope > 0 then
    raise exception 'set_profile_primary_branch: target has memberships outside the actor''s branch scope'
      using errcode = '42501';
  end if;

  select id, is_primary into v_membership_id, v_already_primary
  from public.profile_branch_memberships
  where profile_id = p_profile_id and branch_id = p_branch_id
  for update;

  -- Primary requires an existing membership — you cannot be primarily assigned
  -- to a branch you are not assigned to.
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


-- ----------------------------------------------------------------------------
-- O. set_profile_branch_scope_mode — HARD administrador guard (B4)
-- ----------------------------------------------------------------------------
-- Alongside grant_staff_capability, this is one of the two functions whose
-- actor guard is a ROLE test rather than a capability test. National reach is
-- the widest thing anyone can be given; the guard on it must not depend on
-- anything delegable. branch:manage is explicitly NOT sufficient here.
create or replace function public.set_profile_branch_scope_mode(
  p_profile_id uuid,
  p_mode text,
  p_actor_profile_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_previous_mode text;
begin
  -- B4 + B5 in one guard: only an active administrador, which also means a
  -- non-administrador can never reach an administrador's scope mode.
  if not exists (
    select 1 from public.profiles
    where id = p_actor_profile_id and active and role = 'administrador'
  ) then
    raise exception 'set_profile_branch_scope_mode: actor is not an active administrador'
      using errcode = '42501';
  end if;

  -- B3.
  if p_profile_id = p_actor_profile_id then
    raise exception 'set_profile_branch_scope_mode: an actor cannot change their own branch scope mode'
      using errcode = '22023';
  end if;

  if p_mode not in ('branch', 'national') then
    raise exception 'set_profile_branch_scope_mode: invalid mode "%"', p_mode
      using errcode = '22023';
  end if;

  select branch_scope_mode into v_previous_mode
  from public.profiles where id = p_profile_id for update;

  if not found then
    return null;
  end if;

  if v_previous_mode = p_mode then
    return p_profile_id;
  end if;

  update public.profiles set branch_scope_mode = p_mode where id = p_profile_id;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value, branch_id
  ) values (
    'profile_branch_scope_changed', 'profile', p_profile_id, null, null,
    p_actor_profile_id, 'human', 'crm_manual',
    jsonb_build_object('mode', v_previous_mode),
    jsonb_build_object('mode', p_mode),
    null
  );

  return p_profile_id;
end;
$$;


-- ----------------------------------------------------------------------------
-- P. Execute privileges
-- ----------------------------------------------------------------------------
revoke execute on function public.profile_has_branch_scope(uuid, uuid) from public;
revoke execute on function public.create_branch(text, text, text, text, text, text, text, boolean, uuid) from public;
revoke execute on function public.update_branch(uuid, text, text, text, text, text, text, text, boolean, uuid) from public;
revoke execute on function public.set_branch_active(uuid, boolean, uuid) from public;
revoke execute on function public.assign_profile_branch(uuid, uuid, boolean, uuid) from public;
revoke execute on function public.remove_profile_branch(uuid, uuid, uuid) from public;
revoke execute on function public.set_profile_primary_branch(uuid, uuid, uuid) from public;
revoke execute on function public.set_profile_branch_scope_mode(uuid, text, uuid) from public;

revoke execute on function public.profile_has_branch_scope(uuid, uuid) from anon, authenticated;
revoke execute on function public.create_branch(text, text, text, text, text, text, text, boolean, uuid) from anon, authenticated;
revoke execute on function public.update_branch(uuid, text, text, text, text, text, text, text, boolean, uuid) from anon, authenticated;
revoke execute on function public.set_branch_active(uuid, boolean, uuid) from anon, authenticated;
revoke execute on function public.assign_profile_branch(uuid, uuid, boolean, uuid) from anon, authenticated;
revoke execute on function public.remove_profile_branch(uuid, uuid, uuid) from anon, authenticated;
revoke execute on function public.set_profile_primary_branch(uuid, uuid, uuid) from anon, authenticated;
revoke execute on function public.set_profile_branch_scope_mode(uuid, text, uuid) from anon, authenticated;

grant execute on function public.profile_has_branch_scope(uuid, uuid) to service_role;
grant execute on function public.create_branch(text, text, text, text, text, text, text, boolean, uuid) to service_role;
grant execute on function public.update_branch(uuid, text, text, text, text, text, text, text, boolean, uuid) to service_role;
grant execute on function public.set_branch_active(uuid, boolean, uuid) to service_role;
grant execute on function public.assign_profile_branch(uuid, uuid, boolean, uuid) to service_role;
grant execute on function public.remove_profile_branch(uuid, uuid, uuid) to service_role;
grant execute on function public.set_profile_primary_branch(uuid, uuid, uuid) to service_role;
grant execute on function public.set_profile_branch_scope_mode(uuid, text, uuid) to service_role;
