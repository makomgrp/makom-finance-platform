-- ============================================================================
-- DEVELOPMENT ONLY — DO NOT RUN AGAINST A PRODUCTION DATABASE
-- ============================================================================
--
-- This seed exists exclusively to support Supabase Auth testing during the
-- Milestone 2 build-out (see the Auth migration plan). The row it creates
-- must never exist in a production database and must be removed before
-- production delivery — it is throwaway test fixture data, not part of
-- the application's real user base, the same way the rest of this file's
-- reasoning already assumes.
--
-- Removal before production:
--   delete from public.profiles where email = 'qa.disabled.user@example.invalid';
-- ============================================================================
--
-- Milestone 2 of the Supabase Auth migration: creates one dedicated,
-- clearly-fake development/test profile — "QA Disabled User" — used
-- solely to validate getCurrentProfile()'s inactive-profile handling (an
-- active = false profile must resolve to null even with a fully valid,
-- linked Auth session).
--
-- Deliberately NOT one of the 7 seeded demo fixtures (see
-- supabase/seed_profiles.sql) — none of those rows are touched by this
-- file. This row:
--   - legacy_id = null: never bridges any existing demo screen — no part
--     of the CRM's static demo data (clients/applications/alerts/
--     documents/notes/chat) references it, unlike the 7 real fixtures.
--   - auth_user_id = null for now: linked in a later step (Step C), once
--     the corresponding development Auth account is created manually in
--     the Supabase Dashboard.
--   - active = false from creation: the entire point of this row is to be
--     the one profile getCurrentProfile() must resolve to null for.
--   - email uses the .invalid TLD (reserved by RFC 2606 for addresses
--     that must never resolve or receive mail) — an unambiguous signal
--     this is fake, test-only data, never a real inbox.
--   - role = 'consulta': the least-privileged existing role, appropriate
--     for a throwaway account with no real use.
--
-- Idempotent: profiles.email is unique, so re-running this is a no-op if
-- the row already exists.

insert into public.profiles (full_name, email, role, preferred_language, active, legacy_id, auth_user_id)
values (
  'QA Disabled User',
  'qa.disabled.user@example.invalid',
  'consulta',
  'en',
  false,
  null,
  null
)
on conflict (email) do nothing;
