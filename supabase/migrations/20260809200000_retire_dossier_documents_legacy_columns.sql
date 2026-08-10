-- ============================================================================
-- dossier_documents: retire the legacy client/application/type/status model (Milestone 12E4)
-- ============================================================================
--
-- The FINAL step of the staged Document Evidence migration begun in
-- Milestone 12A (20260809160000_add_requirement_slot_id_to_dossier_
-- documents.sql). Every consumer of the legacy client_legacy_id /
-- application_legacy_id / type / status columns was removed in application
-- code before this migration was written (Milestone 12E1 through 12E4 —
-- see the Milestone 12E architecture review): SummaryTab and the Dashboard
-- KPI moved onto the Requirement Slot model (12E1/12E1b), the dead
-- getDocumentsByClientId data flow was deleted (12E2), the two unmapped
-- dev fixture rows were deleted (12E3), and src/lib/services/documents.ts,
-- src/types/dossier-document.ts, and document-evidence.ts's write
-- shim were all deleted in this same milestone (12E4), before this file.
-- After this migration, dossier_documents is exactly and only the
-- Document Evidence Engine's table — every row is evidence for one
-- Requirement Slot, nothing more.
--
-- Explicitly, deliberately, NOT part of this migration:
--   - renaming this table to document_evidence, or renaming the
--     dossier-documents Storage bucket (Milestone 12E architecture
--     review, Question — deferred: no functional value, added risk)
--   - any Storage object being moved, renamed, uploaded, or deleted —
--     Storage cleanup is always a separate, deliberate, manual step, same
--     posture as 20260809190000_delete_unmapped_dossier_documents_dev_
--     rows.sql
--   - any change to requirement_slot_id's or replaces_evidence_id's
--     existing foreign keys, uniqueness, or self-reference guard
--     (dossier_documents_requirement_slot_id_fkey, dossier_documents_
--     replaces_evidence_id_fkey/_key/_not_self_check) — all untouched
--   - any change to the file-metadata invariant (dossier_documents_
--     file_metadata_check), the MIME/file-size/SHA-256 format checks, the
--     storage_path uniqueness constraint, the two requirement_slot_id-
--     scoped indexes, the uploaded_source CHECK (still including 'ai'),
--     or Row Level Security / service_role grants — all untouched
--
-- Safety: every destructive step below is guarded (existence-checked
-- before acting) so this migration is safe to re-run after a partial or
-- full prior success. The defensive pre-check block runs first and is
-- itself wrapped so a failure aborts the entire migration transaction
-- before any destructive statement runs.

-- ----------------------------------------------------------------------------
-- Pre-check
-- ----------------------------------------------------------------------------
--
-- Verifies, before touching anything: (1) the table this migration targets
-- actually exists; (2)/(3) every row already has a real Requirement Slot —
-- the only way a row in this table could still be "legacy-only" (unmapped,
-- pre-12E) is exactly this condition, since the write shim that could
-- create such a row no longer exists as of this same milestone and
-- 20260809190000 already removed the last two known unmapped dev
-- fixtures. If this ever finds a nonzero count, something unexpected has
-- happened since 20260809190000 ran, and this migration must not proceed
-- — promoting requirement_slot_id to NOT NULL and dropping the legacy
-- columns below would either fail outright or silently discard whatever
-- unexpected row exists.
do $$
declare
  v_null_slot_count integer;
begin
  if to_regclass('public.dossier_documents') is null then
    raise exception
      'Milestone 12E4 safety check failed: public.dossier_documents does '
      'not exist. Aborting — this migration only makes sense against the '
      'table created by 20260808110000_create_dossier_documents_table.sql.';
  end if;

  select count(*)
    into v_null_slot_count
  from public.dossier_documents
  where requirement_slot_id is null;

  if v_null_slot_count != 0 then
    raise exception
      'Milestone 12E4 safety check failed: % row(s) still have '
      'requirement_slot_id is null. This migration promotes '
      'requirement_slot_id to NOT NULL and drops every legacy column — it '
      'must not run until every row has a real Requirement Slot mapping. '
      'See 20260809190000_delete_unmapped_dossier_documents_dev_rows.sql '
      'for the last known cleanup of this exact kind; investigate what '
      'created this row before re-running. Aborting without making any '
      'change.', v_null_slot_count;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- (A) Promote requirement_slot_id to NOT NULL
-- ----------------------------------------------------------------------------
--
-- The pre-check above just confirmed zero rows would violate this. Guarded
-- on the column's current nullability so re-running this migration after
-- it has already succeeded is a safe no-op.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'dossier_documents'
      and column_name = 'requirement_slot_id' and is_nullable = 'YES'
  ) then
    alter table public.dossier_documents
      alter column requirement_slot_id set not null;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- (B) Drop the four legacy-specific constraints
-- ----------------------------------------------------------------------------
--
-- Each guarded so re-running this migration after it has already
-- succeeded is a safe no-op (the constraint is simply already gone).
-- dossier_documents_status_file_check and dossier_documents_legacy_
-- review_check both reference `status`, dropped in (E) below — dropped
-- here explicitly, ahead of the column drop, for auditability, even
-- though Postgres would drop them automatically alongside their column
-- regardless.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'dossier_documents_type_check'
      and conrelid = 'public.dossier_documents'::regclass
  ) then
    alter table public.dossier_documents drop constraint dossier_documents_type_check;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'dossier_documents_status_check'
      and conrelid = 'public.dossier_documents'::regclass
  ) then
    alter table public.dossier_documents drop constraint dossier_documents_status_check;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'dossier_documents_status_file_check'
      and conrelid = 'public.dossier_documents'::regclass
  ) then
    alter table public.dossier_documents drop constraint dossier_documents_status_file_check;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'dossier_documents_legacy_review_check'
      and conrelid = 'public.dossier_documents'::regclass
  ) then
    alter table public.dossier_documents drop constraint dossier_documents_legacy_review_check;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- (C) Add the FINAL review-pair invariant
-- ----------------------------------------------------------------------------
--
-- Replaces dossier_documents_legacy_review_check now that `status` is
-- gone and every row is a real Document Evidence row. No longer tied to
-- any status vocabulary — just requires reviewed_at and reviewed_by_
-- profile_id to be populated together or not at all.
-- src/lib/services/document-evidence.ts#reviewDocumentEvidence's own
-- guarded update (reject if already reviewed) remains the sole
-- enforcement of "reviewed once, immutably"; this CHECK only enforces
-- that the two columns move together.
--
-- Pre-check: the constraint this replaces (dossier_documents_legacy_
-- review_check, and before it dossier_documents_review_check) never
-- actually guaranteed this pairing for every row — its status-driven
-- formula only forced BOTH columns non-null when status was concluded,
-- never forced BOTH null otherwise, so a row written through the old
-- legacy path could in principle have exactly one of the two columns
-- set. Verify that no such row exists before adding a CHECK that would
-- reject it.
do $$
declare
  v_review_pair_mismatch_count integer;
begin
  select count(*)
    into v_review_pair_mismatch_count
  from public.dossier_documents
  where (reviewed_at is null) != (reviewed_by_profile_id is null);

  if v_review_pair_mismatch_count != 0 then
    raise exception
      'Milestone 12E4 safety check failed: % row(s) have inconsistent '
      'review information (reviewed_at and reviewed_by_profile_id do not '
      'agree on whether this row has been reviewed). Aborting — adding '
      'dossier_documents_review_pair_check would promote the schema to '
      'an invariant this data does not actually satisfy; investigate '
      'and resolve these rows before re-running.', v_review_pair_mismatch_count;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'dossier_documents_review_pair_check'
      and conrelid = 'public.dossier_documents'::regclass
  ) then
    alter table public.dossier_documents
      add constraint dossier_documents_review_pair_check
      check ((reviewed_at is null) = (reviewed_by_profile_id is null));
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- (D) Drop the legacy client-id lookup index
-- ----------------------------------------------------------------------------
--
-- No code path queries by client_legacy_id anymore — its only consumer,
-- src/lib/services/documents.ts, was deleted in this same milestone.
-- DROP INDEX IF EXISTS is natively idempotent; no guard DO block needed.
drop index if exists public.dossier_documents_client_legacy_id_idx;

-- ----------------------------------------------------------------------------
-- (E) Drop the four legacy columns
-- ----------------------------------------------------------------------------
--
-- client_legacy_id, application_legacy_id, type, status. ALTER TABLE ...
-- DROP COLUMN IF EXISTS is natively idempotent; no guard DO block needed.
-- Every other column (requirement_slot_id, replaces_evidence_id,
-- metadata, storage_bucket, storage_path, file_name, mime_type,
-- file_size_bytes, file_sha256, uploaded_source, uploaded_at, uploaded_
-- by_profile_id, reviewed_at, reviewed_by_profile_id, created_at) is
-- untouched.
alter table public.dossier_documents
  drop column if exists client_legacy_id,
  drop column if exists application_legacy_id,
  drop column if exists type,
  drop column if exists status;

-- ----------------------------------------------------------------------------
-- Comment refresh (documentation only — no functional change)
-- ----------------------------------------------------------------------------
--
-- The table comment and two column comments (storage_path, reviewed_at)
-- still described the retired legacy model. Comments on client_legacy_id,
-- application_legacy_id, type, and status themselves were dropped
-- automatically along with their columns in (E) above — nothing to do
-- for those.
comment on table public.dossier_documents is
  'The Document Evidence Engine''s sole, final table (Milestone 12B, '
  'finalized in Milestone 12E4 — see the Milestone 12 and 12E '
  'architecture reviews). Every row is Evidence for exactly one '
  'Requirement Slot (requirement_slot_id, NOT NULL) — "requirement slot" '
  'no longer means the one-row-per-document-type pattern this table '
  'originally shipped with. Every row always has a real file attached: '
  'an Evidence row is only ever created at the moment a file is uploaded '
  '(dossier_documents_file_metadata_check), never as an empty '
  'placeholder.';

comment on column public.dossier_documents.storage_path is
  'Real Supabase Storage object path within storage_bucket. Format: '
  'applications/{application_id}/requirements/{requirement_slot_id}/'
  '{iso_timestamp}-{upload_uuid}.{ext} (src/lib/services/document-'
  'evidence.ts#createDocumentEvidence) — the {client_legacy_id}/'
  '{application_legacy_id}/{type}/... format this comment originally '
  'described belonged to the legacy write path removed in Milestone '
  '12E4. The extension is always derived server-side from the validated '
  'mime_type, never from the user-supplied original filename (stored '
  'only in file_name, for display).';

comment on column public.dossier_documents.reviewed_at is
  'When this Evidence row was reviewed — an immutable audit fact, not a '
  'status. Populated exactly once, by src/lib/services/document-'
  'evidence.ts#reviewDocumentEvidence, and never cleared or overwritten '
  'afterward; that function''s own guarded update (reject if already '
  'reviewed) is the sole enforcement of "reviewed once, immutably". No '
  'longer tied to any status vocabulary — see dossier_documents_review_'
  'pair_check, which only requires this and reviewed_by_profile_id to '
  'move together.';
