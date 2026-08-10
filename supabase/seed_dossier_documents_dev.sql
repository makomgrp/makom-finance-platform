-- ============================================================================
-- DEVELOPMENT-ONLY seed data for the dossier documents module
-- ============================================================================
--
-- This is fixture data for local/dev verification of the documents read/
-- upload/replace/review/view path — it is NOT part of the application's
-- real data model and MUST be deleted before production delivery. Do not
-- build any logic that assumes this data exists.
--
-- IMPORTANT — run order: this SQL file must be applied AFTER the
-- companion Storage upload script (supabase/seed-dossier-documents-storage.mjs)
-- has actually uploaded the 5 placeholder PDFs referenced below. Every
-- non-pendiente row here points at a storage_path that must already exist
-- as a real object in the private dossier-documents bucket — inserting
-- this metadata first would create rows referencing files that don't
-- exist yet, violating the same "never point at a non-existent object"
-- rule the application code itself follows (see the Milestone 8
-- architecture review's upload/replace sequencing).
--
-- Removal before production:
--   delete from public.dossier_documents
--   where id in (
--     'd0c5eed0-0001-4a11-9a11-000000000001',
--     'd0c5eed0-0002-4a11-9a11-000000000002',
--     'd0c5eed0-0003-4a11-9a11-000000000003',
--     'd0c5eed0-0004-4a11-9a11-000000000004',
--     'd0c5eed0-0005-4a11-9a11-000000000005',
--     'd0c5eed0-0006-4a11-9a11-000000000006'
--   );
--   -- then also delete the 5 objects under storage_path below from the
--   -- dossier-documents bucket (e.g. via the Supabase Dashboard, or
--   -- supabase.storage.from('dossier-documents').remove([...])).
--
-- Seeds the full 6-document requirement set for application "ap-001"
-- (client "cl-001", Juan Pérez — the same client/application pairing used
-- throughout every prior milestone's dev seed data):
--   4 verificado (reviewed)   — cedula_pasaporte, carta_trabajo,
--                                comprobante_pago, recibo_servicios
--   1 en_revision (has a file, not yet concluded, no reviewer)
--                              — ficha_css
--   1 pendiente (no file at all) — confirmacion_descuento
--
-- Reviewer identities (Gabriel/Marisol, alternated for variety) are
-- resolved from the existing demo "u-00N" identifiers via
-- profiles.legacy_id, same one-time boundary lookup used by every prior
-- dev seed. Reviewing seeded data with a real dev profile is a legitimate
-- simulated action (exercises the review-display path).
--
-- uploaded_source = 'crm_manual' for every file-bearing row — per the
-- current architecture, uploaded_source describes the BUSINESS origin of
-- a document (crm_manual / website_form / whatsapp), never how the
-- database row itself happened to be created, so there is no separate
-- "seed"/"migration" value to reach for. uploaded_by_profile_id is left
-- null for all 5 rows: none of these files were actually uploaded by a
-- real staff member clicking through this app, so no specific person is
-- attributed as the uploader, even though the row is categorized as
-- crm_manual in origin. Do not read a populated uploaded_by_profile_id
-- into these rows without a real corresponding upload action.
--
-- storage_bucket = 'dossier-documents' for every file-bearing row —
-- matches the one bucket Milestone 8A creates; see the column's own
-- comment in the table migration for why this is an explicit per-row
-- value rather than a hardcoded assumption.
--
-- file_sha256 / file_size_bytes below are the REAL, exact values of the 5
-- placeholder PDFs the companion script generates and uploads — computed
-- locally (see the script) so the metadata and the actual Storage objects
-- are guaranteed consistent, not just plausible-looking.
--
-- Row ids and the timestamp/upload-uuid components embedded in each
-- storage_path are fixed (not gen_random_uuid()/now()), purely so this
-- script and the companion Storage upload are both safely re-runnable and
-- stay in agreement — they carry no other meaning.
--
-- Wrapped in a single transaction with a preflight check, so a missing
-- prerequisite profile aborts the whole seed instead of leaving partial
-- data behind.

begin;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.profiles where legacy_id = 'u-001';
  if v_count <> 1 then
    raise exception 'Dossier documents dev seed aborted: expected exactly 1 profile with legacy_id = ''u-001'' (Gabriel), found %', v_count;
  end if;

  select count(*) into v_count from public.profiles where legacy_id = 'u-002';
  if v_count <> 1 then
    raise exception 'Dossier documents dev seed aborted: expected exactly 1 profile with legacy_id = ''u-002'' (Marisol), found %', v_count;
  end if;
end $$;

-- 1. cedula_pasaporte — verificado, reviewed by Gabriel
insert into public.dossier_documents (
  id, client_legacy_id, application_legacy_id, type, status,
  storage_bucket, storage_path, file_name, mime_type, file_size_bytes, file_sha256,
  uploaded_source, uploaded_at, uploaded_by_profile_id,
  reviewed_at, reviewed_by_profile_id, created_at
)
select
  'd0c5eed0-0001-4a11-9a11-000000000001',
  'cl-001', 'ap-001', 'cedula_pasaporte', 'verificado',
  'dossier-documents',
  'cl-001/ap-001/cedula_pasaporte/20260808T190000Z-f11e0001-aaaa-4b22-8c33-000000000001.pdf',
  'cedula_pasaporte-dev-seed.pdf', 'application/pdf', 611,
  'b5e60a1808799b828a2957aa7e9e14965f5b0a8b233df3edd0685801fd3fdfc5',
  'crm_manual', timestamptz '2026-08-08T19:00:00Z', null,
  timestamptz '2026-08-08T20:00:00Z', gabriel.id,
  timestamptz '2026-08-08T18:00:00Z'
from public.profiles gabriel
where gabriel.legacy_id = 'u-001'
on conflict (id) do nothing;

-- 2. carta_trabajo — verificado, reviewed by Marisol
insert into public.dossier_documents (
  id, client_legacy_id, application_legacy_id, type, status,
  storage_bucket, storage_path, file_name, mime_type, file_size_bytes, file_sha256,
  uploaded_source, uploaded_at, uploaded_by_profile_id,
  reviewed_at, reviewed_by_profile_id, created_at
)
select
  'd0c5eed0-0002-4a11-9a11-000000000002',
  'cl-001', 'ap-001', 'carta_trabajo', 'verificado',
  'dossier-documents',
  'cl-001/ap-001/carta_trabajo/20260808T190000Z-f11e0002-aaaa-4b22-8c33-000000000002.pdf',
  'carta_trabajo-dev-seed.pdf', 'application/pdf', 608,
  '27f46c4181db169afa0ebc1b581e5f4980fce01a550247ce25107293691e7fe8',
  'crm_manual', timestamptz '2026-08-08T19:00:00Z', null,
  timestamptz '2026-08-08T20:00:00Z', marisol.id,
  timestamptz '2026-08-08T18:00:00Z'
from public.profiles marisol
where marisol.legacy_id = 'u-002'
on conflict (id) do nothing;

-- 3. ficha_css — en_revision, has a file, no reviewer yet
insert into public.dossier_documents (
  id, client_legacy_id, application_legacy_id, type, status,
  storage_bucket, storage_path, file_name, mime_type, file_size_bytes, file_sha256,
  uploaded_source, uploaded_at, uploaded_by_profile_id,
  reviewed_at, reviewed_by_profile_id, created_at
)
values (
  'd0c5eed0-0003-4a11-9a11-000000000003',
  'cl-001', 'ap-001', 'ficha_css', 'en_revision',
  'dossier-documents',
  'cl-001/ap-001/ficha_css/20260808T190000Z-f11e0003-aaaa-4b22-8c33-000000000003.pdf',
  'ficha_css-dev-seed.pdf', 'application/pdf', 604,
  '6df5c14daf526be7317914996d646e227c899bdfa82ce3c9596e2b5c267af232',
  'crm_manual', timestamptz '2026-08-08T19:00:00Z', null,
  null, null,
  timestamptz '2026-08-08T18:00:00Z'
)
on conflict (id) do nothing;

-- 4. comprobante_pago — verificado, reviewed by Gabriel
insert into public.dossier_documents (
  id, client_legacy_id, application_legacy_id, type, status,
  storage_bucket, storage_path, file_name, mime_type, file_size_bytes, file_sha256,
  uploaded_source, uploaded_at, uploaded_by_profile_id,
  reviewed_at, reviewed_by_profile_id, created_at
)
select
  'd0c5eed0-0004-4a11-9a11-000000000004',
  'cl-001', 'ap-001', 'comprobante_pago', 'verificado',
  'dossier-documents',
  'cl-001/ap-001/comprobante_pago/20260808T190000Z-f11e0004-aaaa-4b22-8c33-000000000004.pdf',
  'comprobante_pago-dev-seed.pdf', 'application/pdf', 611,
  'a7e7f035f885633587141f5e48e7b6aabc2270cb949c94fa3d3408e5d1fb3e7a',
  'crm_manual', timestamptz '2026-08-08T19:00:00Z', null,
  timestamptz '2026-08-08T20:00:00Z', gabriel.id,
  timestamptz '2026-08-08T18:00:00Z'
from public.profiles gabriel
where gabriel.legacy_id = 'u-001'
on conflict (id) do nothing;

-- 5. recibo_servicios — verificado, reviewed by Marisol
insert into public.dossier_documents (
  id, client_legacy_id, application_legacy_id, type, status,
  storage_bucket, storage_path, file_name, mime_type, file_size_bytes, file_sha256,
  uploaded_source, uploaded_at, uploaded_by_profile_id,
  reviewed_at, reviewed_by_profile_id, created_at
)
select
  'd0c5eed0-0005-4a11-9a11-000000000005',
  'cl-001', 'ap-001', 'recibo_servicios', 'verificado',
  'dossier-documents',
  'cl-001/ap-001/recibo_servicios/20260808T190000Z-f11e0005-aaaa-4b22-8c33-000000000005.pdf',
  'recibo_servicios-dev-seed.pdf', 'application/pdf', 611,
  '4a618521ab098b921890326d91de2810507155c3ae1dfa0ff1eb0f49ea40dbe6',
  'crm_manual', timestamptz '2026-08-08T19:00:00Z', null,
  timestamptz '2026-08-08T20:00:00Z', marisol.id,
  timestamptz '2026-08-08T18:00:00Z'
from public.profiles marisol
where marisol.legacy_id = 'u-002'
on conflict (id) do nothing;

-- 6. confirmacion_descuento — pendiente, no file, all file metadata null.
-- storage_bucket is explicitly passed as null here, not omitted — the
-- column now carries a default ('dossier-documents'), which Postgres
-- would otherwise apply since the column would be missing from the
-- INSERT's column list, violating dossier_documents_file_metadata_check
-- for this NO-FILE row. See that column's comment in the table migration.
insert into public.dossier_documents (
  id, client_legacy_id, application_legacy_id, type, status, storage_bucket, created_at
)
values (
  'd0c5eed0-0006-4a11-9a11-000000000006',
  'cl-001', 'ap-001', 'confirmacion_descuento', 'pendiente', null,
  timestamptz '2026-08-08T18:00:00Z'
)
on conflict (id) do nothing;

commit;
