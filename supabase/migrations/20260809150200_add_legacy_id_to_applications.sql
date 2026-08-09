-- ============================================================================
-- applications: add legacy_id (bridge-integrity correction)
-- ============================================================================
--
-- Corrective, additive migration inserted between 20260809150100 and
-- supabase/seed_applications_dev.sql / 20260809150300, found by a
-- bridge-integrity review performed before the seed or finalize migration
-- were executed. Gap found: once 20260809150300_finalize_requirement_
-- slots_application_id.sql drops requirement_slots.application_legacy_id,
-- there is no column anywhere in the schema that durably records "this
-- applications.id used to be demo application ap-001" —
-- client_legacy_id cannot serve that role (one client can have multiple
-- applications), application_number is a freshly DB-generated string
-- unrelated to the demo id, and requirement_slots.application_id only
-- points forward (slot -> application), never back to a demo identity.
-- Without a durable bridge, a future migration of Solicitudes/the
-- Dossier view off demo data would have no deterministic way to discover
-- that a real Application already exists for a given demo application
-- id, risking a duplicate Application row for data already backfilled.
--
-- legacy_id follows the exact same philosophy already established for
-- profiles.legacy_id (see 20260808032630_add_legacy_id_and_auth_user_id_
-- to_profiles.sql): a temporary, nullable, unique text bridge to the
-- existing demo-data string id (e.g. "ap-001"), populated ONLY for
-- Application rows backfilled from an existing demo LoanApplication
-- record (see supabase/seed_applications_dev.sql). Every application
-- created going forward through the real application flow
-- (src/lib/services/applications.ts#createApplication) leaves it null —
-- it has no demo predecessor to bridge to. Not meant to be permanent:
-- drop once Solicitudes and the Dossier view no longer reference any
-- demo application id anywhere — at that point nothing can look this
-- column up by value, so it has no remaining purpose.
--
-- Deliberately does not touch requirement_slots, the seed, or the
-- finalize migration's own DDL — this file only adds the missing column
-- + constraint on the already-live applications table. Written to be
-- safe against the current live schema: applications already exists
-- (from 20260809150000, already applied) with no legacy_id column yet;
-- requirement_slots.application_id already exists (from 20260809150100,
-- already applied), nullable and unconstrained. No other assumption
-- about live state is made — add column if not exists / guarded
-- constraint creation make this safe to re-run.

alter table public.applications
  add column if not exists legacy_id text;

comment on column public.applications.legacy_id is
  'TEMPORARY bridge to the existing demo-data application ids (e.g. '
  '"ap-001") — same philosophy as profiles.legacy_id. Null for every '
  'application created going forward through the real application flow '
  '(src/lib/services/applications.ts#createApplication never sets it); '
  'only populated for Application rows backfilled from an existing demo '
  'LoanApplication record (see supabase/seed_applications_dev.sql), so a '
  'future migration of Solicitudes/the Dossier view off demo data has a '
  'deterministic way to find the real Application that already exists '
  'for a given demo application id instead of creating a duplicate. Not '
  'meant to be permanent — drop once Solicitudes and the Dossier view no '
  'longer reference any demo application id anywhere.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'applications_legacy_id_key'
      and conrelid = 'public.applications'::regclass
  ) then
    alter table public.applications
      add constraint applications_legacy_id_key
      unique (legacy_id);
  end if;
end $$;
