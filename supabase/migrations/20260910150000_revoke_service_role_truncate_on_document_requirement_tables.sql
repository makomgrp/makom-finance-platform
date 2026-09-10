-- ============================================================================
-- REVOKE TRUNCATE ON DOCUMENT/REQUIREMENT TABLES (service_role)
-- ============================================================================
--
-- Follow-up to 20260910130000, which closed the anon/authenticated half of
-- this gap on the same three tables. That migration deliberately left
-- service_role untouched, flagging it for explicit confirmation rather than
-- assuming it too should be revoked. This migration is that confirmation,
-- applied.
--
-- WHY service_role's TRUNCATE WAS SAFE TO ASSUME UNUSED, AND WHY IT WAS
-- CONFIRMED ANYWAY RATHER THAN JUST ASSUMED:
--   * the three creation migrations (20260808110000, 20260809130000,
--     20260809140000) each grant service_role exactly
--     `select, insert, update` — TRUNCATE was never requested, only inherited
--     from Supabase's default privileges at table creation;
--   * a repository-wide search of application code and migrations finds no
--     reference to TRUNCATE on any of these three tables;
--   * a search of every function body in the public schema
--     (`pg_proc.prosrc ilike '%truncate%'`) returns zero matches — no RPC
--     depends on it either.
--
-- SCOPE, DELIBERATELY NARROW. Only TRUNCATE, only these three tables, only
-- service_role. SELECT/INSERT/UPDATE/REFERENCES/TRIGGER are untouched — they
-- are the normal, actually-used privileges every service in this codebase
-- reads and writes through, and revoking them would break the application.
-- RLS and its policies are untouched.

revoke truncate on table public.dossier_documents from service_role;
revoke truncate on table public.requirement_slots from service_role;
revoke truncate on table public.requirement_templates from service_role;
