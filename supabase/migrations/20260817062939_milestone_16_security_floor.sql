-- ============================================================================
-- Milestone 16 — Security Floor (database side)
-- ============================================================================
--
-- Purpose: close the three DATABASE-level findings of the Code <-> Supabase
-- cross-audit. The application-level finding from the same audit (every
-- authenticated active profile could invoke every mutation, because
-- profiles.role was display-only) is closed in code by
-- src/lib/auth/capabilities.ts + src/lib/auth/authorize.ts, not here.
--
-- SCOPE DISCIPLINE — what this migration deliberately does NOT do:
--
--   * It does NOT add or change any RLS POLICY. RLS defense-in-depth is a
--     later milestone's explicit scope. Every table already has
--     relrowsecurity = true (courtesy of the ensure_rls event trigger this
--     migration hardens), and the service layer remains the authoritative
--     access path in Milestone 16 exactly as before.
--   * It does NOT widen any grant. In particular service_role still holds
--     NO insert or update privilege on public.profiles. Creating and
--     editing users is Milestone 21's scope, and granting the privilege
--     early would open a write path this milestone has no code to guard.
--   * It does NOT modify a single row. No role is reassigned, no profile is
--     deleted, no auth_user_id is cleared. Every statement below is DDL.
--
-- REVERSIBILITY (conceptually — do not run these as-is without review):
--   revoke:  grant execute on function public.rls_auto_enable() to public;
--   check:   alter table public.profiles drop constraint profiles_role_check;
--   fk:      alter table public.profiles drop constraint profiles_auth_user_id_fkey;
--
-- IDEMPOTENCY: every statement is either natively idempotent (revoke) or
-- wrapped in a catalog existence check, so re-running this migration on a
-- database that already has it applied is a no-op rather than an error.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- A. Restrict public.rls_auto_enable()
-- ----------------------------------------------------------------------------
--
-- Finding: rls_auto_enable() is SECURITY DEFINER (it runs as its owner,
-- postgres) and its proacl is NULL — which in PostgreSQL means "default
-- ACL", and the default ACL for a function is EXECUTE to PUBLIC. Verified
-- against the live database before writing this migration:
-- has_function_privilege() returned true for anon, authenticated AND
-- service_role.
--
-- Impact today is limited rather than nil: the function body's first act is
-- to call pg_event_trigger_ddl_commands(), which raises an exception when
-- called outside an event-trigger context, so a direct call by anon or
-- authenticated errors out rather than doing anything. But a
-- PUBLIC-executable SECURITY DEFINER function that runs as postgres is
-- exactly the shape of privilege escalation that must not be left lying
-- around on the assumption that its body stays harmless — the body is one
-- future edit away from being a real escalation path.
--
-- WHY THIS DOES NOT BREAK THE ensure_rls EVENT TRIGGER: PostgreSQL does not
-- perform an EXECUTE privilege check when firing a trigger or an event
-- trigger. The function is invoked by the event-trigger machinery, not as
-- an ordinary function call, so no role needs EXECUTE for `ensure_rls` to
-- keep firing on CREATE TABLE. The owner (postgres) additionally retains
-- EXECUTE implicitly as owner, so even a direct administrative call still
-- works. Verified live before writing: event trigger `ensure_rls` is owned
-- by postgres, enabled ('O'), on ddl_command_end, tagged CREATE TABLE /
-- CREATE TABLE AS / SELECT INTO, and bound to this exact function.
--
-- Naturally idempotent: revoking a privilege that is already absent is a
-- successful no-op in PostgreSQL.
revoke execute on function public.rls_auto_enable() from public;

-- Belt and braces. Revoking from PUBLIC above already removes the only
-- grant these three roles had (none of them holds a direct grant — the live
-- proacl was NULL, i.e. no explicit entries at all). These statements exist
-- so that the intent is explicit in the schema history and so that a future
-- accidental `grant ... to authenticated` is visibly contradicted here.
revoke execute on function public.rls_auto_enable() from anon;
revoke execute on function public.rls_auto_enable() from authenticated;
revoke execute on function public.rls_auto_enable() from service_role;


-- ----------------------------------------------------------------------------
-- B. profiles.role — canonical vocabulary constraint
-- ----------------------------------------------------------------------------
--
-- Finding: profiles.role is `text NOT NULL` with no CHECK constraint and no
-- default. Any string at all is currently a valid role. Because
-- src/lib/auth/capabilities.ts fails CLOSED on an unrecognized role (an
-- unknown value yields zero capabilities rather than a permissive
-- default), a typo'd role is a lockout rather than an escalation — but a
-- silent lockout is still a defect, and the database should not accept a
-- value the application cannot interpret.
--
-- THE FIVE CANONICAL ROLES. Note that this list is FIVE values, not four:
-- `gerente` is a canonical ODL role. It is present in the live data
-- (Marisol Duarte, legacy_id u-002, active, with a linked auth account), in
-- src/types/user.ts's UserRole union, in USER_ROLE_VALUES, in both
-- messages/es.json and messages/en.json, and in supabase/seed_profiles.sql.
-- A four-value constraint would have failed to apply against live data AND
-- locked out a real user. See the Milestone 16 pre-flight report.
--
-- Verified live before writing: `select distinct role from public.profiles`
-- returns exactly these five values, so this constraint validates against
-- existing rows without any data change.
--
-- To widen this vocabulary later, use the same DROP CONSTRAINT + ADD
-- CONSTRAINT pattern this schema already uses for every closed vocabulary
-- (see automation_events_event_type_check), and update UserRole,
-- USER_ROLE_VALUES, ROLE_CAPABILITIES and both message catalogues in the
-- same change — a role the database accepts but ROLE_CAPABILITIES does not
-- map is, by the fail-closed rule above, a user who can do nothing.
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'profiles'
      and c.conname = 'profiles_role_check'
  ) then
    alter table public.profiles
      add constraint profiles_role_check
      check (role in ('administrador', 'gerente', 'analista', 'asesor', 'consulta'));
  end if;
end
$$;


-- ----------------------------------------------------------------------------
-- C. profiles.auth_user_id -> auth.users(id) foreign key
-- ----------------------------------------------------------------------------
--
-- Finding: auth_user_id is a bare uuid column with a UNIQUE constraint but
-- no foreign key, so nothing prevents it from pointing at an auth user that
-- does not exist (or no longer exists). getCurrentProfile() resolves the
-- current user by matching auth.uid() against this column; a stale value is
-- therefore an identity-resolution hazard, not merely untidy data.
--
-- NULL REMAINS VALID — DELIBERATELY. Five of the eight live profiles have
-- auth_user_id IS NULL (the seeded staff fixtures that have never been
-- issued Supabase Auth credentials). A foreign key does not constrain NULL,
-- so those rows are unaffected. The column stays nullable: "a staff member
-- who exists in the CRM but has no login yet" is a real, current product
-- state, and Milestone 16 has no mandate to change it. This FK constrains
-- only NON-NULL values — exactly the requirement.
--
-- Verified live before writing: all three non-null auth_user_id values
-- resolve to real auth.users rows, so this constraint validates against
-- existing data without any cleanup. It is added as a normal (validated)
-- constraint rather than NOT VALID because the table is tiny (8 rows) and a
-- constraint that is never validated proves nothing about existing data.
--
-- ON DELETE SET NULL — WHY, EXPLICITLY. The three candidates:
--
--   CASCADE would delete the profiles row when its auth user is deleted.
--   Rejected outright. profiles.id is the attribution target of essentially
--     every audit fact in this schema — dossier_notes.author_profile_id,
--     dossier_alerts.created_by_profile_id, dossier_documents' uploader and
--     reviewer, applications' and requirement_slots' status_changed_by,
--     application_analysis.reviewed_by_profile_id, messages.sender_profile_id.
--     Deleting one Supabase Auth account would cascade into destroying, or
--     blocking on, the history of everything that person ever did. An audit
--     trail that disappears when an account is removed is not an audit trail.
--
--   RESTRICT / NO ACTION would refuse to delete the auth user at all while a
--     profile references it. Safe for data, but it turns "offboard a user"
--     into an operation that fails with a foreign-key error until someone
--     manually unlinks the profile first — and the app already has a
--     first-class way to disable a person (profiles.active = false, which
--     getCurrentProfile() enforces).
--
--   SET NULL, chosen: deleting the auth user unlinks the profile and leaves
--     every business record and every attribution intact. The profile lands
--     in exactly the state five profiles are already in today — a real
--     person with no login — which getCurrentProfile() already handles by
--     returning null. It fails CLOSED (the account can no longer sign in)
--     while destroying nothing. It is also the only option that keeps
--     deletion of an auth user a safe, non-cascading operation.
--
-- ON UPDATE is left at the default NO ACTION: auth.users.id is a generated
-- primary key that is never rewritten, so cascading updates would encode a
-- scenario that does not occur.
--
-- NOTE FOR APPLICATION: this statement requires REFERENCES privilege on
-- auth.users, which the migration role (postgres) holds. It takes a brief
-- lock on public.profiles (8 rows) and on auth.users; at this size the
-- operation is effectively instantaneous.
do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
    where n.nspname = 'public'
      and t.relname = 'profiles'
      and c.conname = 'profiles_auth_user_id_fkey'
  ) then
    alter table public.profiles
      add constraint profiles_auth_user_id_fkey
      foreign key (auth_user_id)
      references auth.users (id)
      on delete set null;
  end if;
end
$$;


-- ----------------------------------------------------------------------------
-- D. Documentation
-- ----------------------------------------------------------------------------
comment on column public.profiles.role is
  'One of the five canonical ODL roles, enforced by profiles_role_check '
  '(Milestone 16). Authoritative for authorization: it is mapped to '
  'capabilities by ROLE_CAPABILITIES in src/lib/auth/capabilities.ts, which '
  'is the ONLY authorization matrix in the codebase, and enforced on every '
  'Server Action by requireCapability() in src/lib/auth/authorize.ts. Before '
  'Milestone 16 this column was display-only. An unrecognized value yields '
  'ZERO capabilities (fail-closed), so adding a role here without adding it '
  'to ROLE_CAPABILITIES locks that user out rather than escalating them.';

comment on column public.profiles.auth_user_id is
  'Link to the Supabase Auth account, FK-constrained to auth.users as of '
  'Milestone 16 with ON DELETE SET NULL (see that migration for the full '
  'reasoning: cascading would destroy audit attribution). NULL is valid and '
  'expected — it means "staff member with no login issued yet", the state '
  'most seeded profiles are in. getCurrentProfile() resolves the current '
  'user by matching auth.uid() against this column.';
