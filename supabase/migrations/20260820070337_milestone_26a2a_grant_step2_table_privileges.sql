-- ============================================================================
-- MILESTONE 26A-2A — SERVICE-ROLE PRIVILEGES ON THE STEP 2 TABLES
-- ============================================================================
--
-- A corrective follow-up to 20260820065903. That migration created six tables
-- and enabled RLS on them, but granted nothing — so service_role, the role every
-- server-side service in this app runs as, had NO privileges on them at all.
-- The Step 2 service would have failed at runtime with "permission denied for
-- table application_employment" the first time it read anything.
--
-- Enabling RLS is not what blocked it: service_role BYPASSES RLS. Table-level
-- GRANTs are a separate gate, and Supabase's default privileges did not extend
-- to tables created inside a migration.
--
-- A SEPARATE MIGRATION, NOT AN EDIT: 20260820065903 is already applied, and this
-- schema's standing discipline is that an applied migration is corrected
-- forward, never rewritten.
--
-- ----------------------------------------------------------------------------
-- WHAT IS GRANTED, AND WHY DELETE IS INCLUDED HERE WHEN IT USUALLY IS NOT
-- ----------------------------------------------------------------------------
-- The convention on this schema's data tables is SELECT, INSERT, UPDATE for
-- service_role and nothing for anon/authenticated (see clients, applications,
-- requirement_slots, dossier_documents). DELETE is deliberately withheld there
-- because those are business records that must survive: a client, an
-- application, a filed document, an audit event.
--
-- The Step 2 tables are a different kind of thing. They are the editable child
-- collections of an application still being filled in — an applicant who adds a
-- debt by mistake, or lists a guarantor and then changes their mind, has to be
-- able to remove that row. The alternative, a soft-delete flag, would be
-- actively harmful precisely here: every future "total monthly obligations"
-- calculation would have to remember to exclude the tombstones, and the one
-- that forgets produces an affordability figure that is wrong in the direction
-- that declines a good applicant.
--
-- This is also consistent with what the schema already says about these rows:
-- their foreign keys are ON DELETE CASCADE, so the database is already prepared
-- for them to disappear with their application.
--
-- anon and authenticated receive NOTHING. Combined with RLS-on/no-policies,
-- these tables remain reachable only through server-side services. The public
-- portal will not be given anonymous access to them; its access model is a
-- secure continuation session, designed in a later milestone.

grant select, insert, update, delete on public.application_employment to service_role;
grant select, insert, update, delete on public.application_financial_profiles to service_role;
grant select, insert, update, delete on public.application_bank_accounts to service_role;
grant select, insert, update, delete on public.application_obligations to service_role;
grant select, insert, update, delete on public.application_guarantors to service_role;
grant select, insert, update, delete on public.application_collateral to service_role;
grant select, insert, update, delete on public.application_business_profiles to service_role;
