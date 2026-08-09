-- ============================================================================
-- dossier_documents: scope the review invariant to legacy rows only (Milestone 12B)
-- ============================================================================
--
-- Transitional compatibility fix for the staged Document Evidence
-- migration (12A of 12E — see the Milestone 12 architecture review and
-- its sequencing-correction follow-up, plus the dedicated review that
-- diagnosed this exact conflict before this migration was written).
--
-- dossier_documents_review_check currently ties reviewed_at/reviewed_by_
-- profile_id to the legacy `status` column being one of three CONCLUDED
-- values (verificado/rechazado/requiere_actualizacion), unconditionally,
-- for every row. That is correct for the legacy model, where "reviewed"
-- and "status reached a concluded legacy outcome" were the same fact —
-- but it made src/lib/services/document-evidence.ts#reviewDocumentEvidence
-- impossible to ever succeed: every Evidence row that service creates
-- starts at status = 'recibido' (see createDocumentEvidence's own legacy-
-- compatibility shim), which the original constraint would never permit
-- alongside a populated reviewed_at.
--
-- The new Document Evidence model does not use dossier_documents.status
-- at all — Requirement Slot alone owns execution/business state (see the
-- architecture review's core philosophy: "Requirement Slot owns execution
-- state, Document Evidence owns the submitted file artifact"), and
-- reviewDocumentEvidence's own guarded update (reject if already
-- reviewed) is already the complete, sufficient enforcement of "reviewed
-- once, immutably" for these rows. Tying that fact to a legacy status
-- vocabulary the new model deliberately does not use was never correct
-- for it — this migration corrects the constraint's SCOPE, not its
-- intent, rather than inventing a new legacy-compatible status value
-- (explicitly rejected — see the review that preceded this migration).
--
-- Scoped by the one column that already, unambiguously distinguishes
-- legacy rows from new-model Evidence rows: requirement_slot_id.
--   - requirement_slot_id IS NULL (legacy rows): governed by the EXACT
--     original biconditional, byte-for-byte unchanged. src/lib/services/
--     documents.ts (setDocumentStatus, uploadDocumentFile) is completely
--     untouched and continues to satisfy it exactly as before — this
--     migration changes no behavior for any legacy consumer.
--   - requirement_slot_id IS NOT NULL (new-model Evidence rows,
--     including the four rows 12A's backfill already mapped): no longer
--     constrained by this rule at all. reviewDocumentEvidence's own
--     application-layer guard is what enforces "reviewed once,
--     immutably" for these rows instead.
--
-- This is a strict WEAKENING, never a tightening: the new condition is
-- true whenever the old one was (identical for legacy rows; unconstrained
-- for bridge rows), so every existing row that satisfied the original
-- constraint trivially satisfies this one too — no existing data can
-- become invalid by this change. No new status value is introduced
-- anywhere, `status` itself is not touched or dropped, and no other
-- column or table is affected.
--
-- Renamed from dossier_documents_review_check to dossier_documents_
-- legacy_review_check to make the now-narrower scope self-evident from
-- the name alone, rather than leaving a name that used to mean "every
-- row" quietly mean "legacy rows only." Postgres has no ALTER CONSTRAINT
-- to change a CHECK in place — the old constraint is dropped and the
-- (renamed, rescoped) replacement is added, both guarded and idempotent:
-- re-running this migration after it has already succeeded finds the old
-- name already gone and the new one already present, a safe no-op.

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'dossier_documents_review_check'
      and conrelid = 'public.dossier_documents'::regclass
  ) then
    alter table public.dossier_documents
      drop constraint dossier_documents_review_check;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'dossier_documents_legacy_review_check'
      and conrelid = 'public.dossier_documents'::regclass
  ) then
    alter table public.dossier_documents
      add constraint dossier_documents_legacy_review_check
      check (
        requirement_slot_id is not null
        or (
          (status in ('verificado', 'rechazado', 'requiere_actualizacion'))
          = (reviewed_at is not null and reviewed_by_profile_id is not null)
        )
      );
  end if;
end $$;
