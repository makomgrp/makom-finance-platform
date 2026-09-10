-- ============================================================================
-- REVOKE TRUNCATE ON public.applications
-- ============================================================================
--
-- Follow-up to the 2.3 and 2.4 audits, which both surfaced this finding on
-- `applications` but deliberately left it unremediated pending its own
-- explicit authorization, given how central this table is. This migration is
-- that authorization, applied.
--
-- CONFIRMED NO DEPENDENCY, READ-ONLY, BEFORE WRITING THIS MIGRATION:
--   * `20260809150000_create_applications_table.sql` grants service_role
--     exactly `select, insert, update` (line 464) — TRUNCATE was never
--     requested, only inherited from Supabase's default privileges at table
--     creation, the same root cause as every prior instance in this project;
--   * a search of every function body in the public schema
--     (`pg_proc.prosrc ilike '%truncate%'` combined with `%applications%`)
--     returns zero matches — no RPC depends on it;
--   * a repository-wide search of application code and migrations for
--     TRUNCATE combined with `applications` finds no real usage, only this
--     migration's own note and unrelated CSS `truncate` utility-class matches
--     elsewhere in the codebase.
--
-- SCOPE, DELIBERATELY NARROW. Only TRUNCATE, only this table, all three roles
-- it was found on (anon, authenticated, service_role) — same shape as the
-- 2.3 and 2.4 remediations on the other tables. SELECT/INSERT/UPDATE/
-- REFERENCES/TRIGGER are untouched. RLS and its policies are untouched.
-- `applications.status` and every other business column are untouched.

revoke truncate on table public.applications from anon;
revoke truncate on table public.applications from authenticated;
revoke truncate on table public.applications from service_role;
