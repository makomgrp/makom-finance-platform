-- ============================================================================
-- MILESTONE 26B-9A — GRANTS FOR THE EMAIL TABLES
-- ============================================================================
--
-- The tables were created with RLS on and every privilege revoked from `anon`
-- and `authenticated`, which is the project posture: the browser reaches no
-- table directly. That left `service_role` — the identity all server code runs
-- as — without the privileges it needs, so the Email page failed its first read
-- with "permission denied". This grants exactly what the application uses.
--
-- SELECT, INSERT, UPDATE. NOT DELETE, AND NOT TRUNCATE.
--
-- That is the same shape `application_follow_ups` was given, and for the same
-- reason: synchronised mail is operational history. Sync inserts, manual
-- linking updates, and the CRM has no legitimate reason to destroy a record of
-- a customer's correspondence from application code. Withholding the privilege
-- is stronger than a convention nobody can enforce — a stray `.delete()` fails
-- at the database instead of quietly succeeding.
--
-- Deleting a message therefore requires a deliberate, privileged action outside
-- the app, which is the correct amount of friction for destroying history.
--
-- `anon` and `authenticated` are re-revoked here rather than assumed: Supabase
-- applies default privileges to newly created tables, and stating the intent
-- next to the grant keeps the two from drifting apart.
-- ============================================================================

grant select, insert, update on public.email_messages    to service_role;
grant select, insert, update on public.email_attachments to service_role;
grant select, insert, update on public.email_sync_state  to service_role;

revoke all on public.email_messages    from anon, authenticated;
revoke all on public.email_attachments from anon, authenticated;
revoke all on public.email_sync_state  from anon, authenticated;
