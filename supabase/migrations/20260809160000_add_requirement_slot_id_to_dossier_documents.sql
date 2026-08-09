-- ============================================================================
-- dossier_documents: add requirement_slot_id + replaces_evidence_id (Milestone 12A)
-- ============================================================================
--
-- Milestone 12A — schema-only, additive-only, per the Milestone 12
-- architecture review and its follow-up sequencing correction. This is the
-- FIRST step of a staged migration toward a Document Evidence model where
-- Evidence is related to a Requirement Slot, not to a client/application
-- legacy-id pair with a hardcoded `type` — see that review for the full
-- reasoning. This migration does NOT complete that migration; it only adds
-- the two columns the eventual model needs, both nullable, both unused by
-- any current code path.
--
-- Explicitly, deliberately, NOT part of this migration (all deferred to a
-- later slice, 12E, only after every consumer has moved):
--   - promoting requirement_slot_id to NOT NULL
--   - dropping client_legacy_id, application_legacy_id, type, or status
--   - renaming this table to document_evidence
--   - any change to src/lib/services/documents.ts or any UI
--   - removing the two dev rows (recibo_servicios, confirmacion_descuento)
--     that have no deterministic Requirement Slot mapping — see
--     supabase/seed_dossier_documents_backfill_dev.sql's header comment
--   - any Storage object being moved, renamed, uploaded, or deleted
--
-- client_legacy_id, application_legacy_id, type, and status remain the
-- ONLY columns any current consumer (the dossier Documents tab, the
-- standalone /documentos module, and every function in
-- src/lib/services/documents.ts) reads or writes. They remain fully
-- authoritative, unconstrained by anything in this migration, until 12E.
--
-- requirement_slot_id: the future authoritative Evidence relationship —
-- once this staged migration completes (12E), every Evidence row will
-- reference exactly one Requirement Slot, and this column will be the
-- sole way that relationship is expressed (client/application identity
-- and requirement identity will both be derived transitively through it,
-- never stored redundantly — see the architecture review's "Application/
-- Client Redundancy Analysis" and "Hardcoded Type Retirement Strategy"
-- sections). For now it is nullable — not because the FINAL model is
-- nullable, but because this is a staged migration and existing rows
-- (and any row a still-unmigrated consumer creates before 12B/12C/12D
-- land) legitimately have no value yet. The FK is added now regardless,
-- while the column is nullable, because a nullable FK carries zero risk
-- to existing data (every current row is null and therefore exempt from
-- the check) while still catching any wrong id the backfill script might
-- supply, immediately, rather than deferring that risk to whenever NOT
-- NULL is eventually promoted.
--
-- replaces_evidence_id: represents EXPLICIT supersession of one specific
-- prior Evidence row by a new upload (e.g. a clearer re-upload of a
-- Government ID front photo) — never general grouping. Two independent,
-- co-existing pieces of evidence for the same Slot (e.g. Government ID
-- front AND back) both have replaces_evidence_id = null; neither
-- supersedes the other. Only set when a new upload is genuinely intended
-- to replace a specific earlier one. Nullable and completely unused in
-- 12A — added now purely so 12B's service-layer work requires no further
-- schema migration of its own, matching the architecture review's
-- reasoning for including it this early.
--
-- No Storage object is moved, renamed, uploaded, or deleted by this
-- migration. This is a relational schema change only.
--
-- No RLS or grant change: both new columns live on a table that already
-- has RLS enabled with zero policies, and service_role's existing
-- select/insert/update grant on the table already covers them — nothing
-- about access control changes by adding a column.

alter table public.dossier_documents
  add column if not exists requirement_slot_id uuid,
  add column if not exists replaces_evidence_id uuid;

comment on column public.dossier_documents.requirement_slot_id is
  'The future authoritative Evidence relationship (Milestone 12 — see the '
  'Document Evidence architecture review). Nullable ONLY because this is '
  'a staged migration (Milestone 12A of 12E): existing rows, and any row '
  'a still-unmigrated consumer creates before every consumer has moved, '
  'legitimately have no value here yet. client_legacy_id, application_'
  'legacy_id, type, and status remain the authoritative columns for '
  'every current consumer until 12E promotes this to NOT NULL and drops '
  'them. Once populated, permanently identifies which Requirement Slot '
  'this row is evidence for; a Slot may have many Evidence rows (see '
  'requirement_slots_application_id_requirement_template_id_key''s '
  'sibling reasoning — one Slot, many pieces of evidence — no unique '
  'constraint exists on this column for exactly that reason).';
comment on column public.dossier_documents.replaces_evidence_id is
  'Explicit supersession of one specific prior Evidence row by a new '
  'upload (e.g. a clearer re-upload of the same document) — never '
  'general grouping. Two independent, co-existing pieces of evidence for '
  'the same requirement_slot_id (e.g. Government ID front and back) both '
  'have this null; neither supersedes the other. Self-referencing, ON '
  'DELETE RESTRICT: Evidence rows are never hard-deleted in this schema, '
  'so this never faces a dangling reference in practice. One Evidence '
  'row may have at most one direct successor — see '
  'dossier_documents_replaces_evidence_id_key below, which keeps the '
  'supersession history a simple chain rather than a branching graph. A '
  'row can never replace itself — see '
  'dossier_documents_replaces_evidence_id_not_self_check below. Whether '
  'the replaced row shares this row''s requirement_slot_id is NOT '
  'enforced at the database level (a CHECK constraint cannot look up '
  'another row, and requirement_slot_id is still nullable during this '
  'staged migration) — that invariant is the Milestone 12B service '
  'layer''s responsibility. Added in Milestone 12A but not used by any '
  'code path yet — reserved for the 12B service-layer work described in '
  'the Document Evidence architecture review.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'dossier_documents_requirement_slot_id_fkey'
      and conrelid = 'public.dossier_documents'::regclass
  ) then
    alter table public.dossier_documents
      add constraint dossier_documents_requirement_slot_id_fkey
      foreign key (requirement_slot_id) references public.requirement_slots(id) on delete restrict;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'dossier_documents_replaces_evidence_id_fkey'
      and conrelid = 'public.dossier_documents'::regclass
  ) then
    alter table public.dossier_documents
      add constraint dossier_documents_replaces_evidence_id_fkey
      foreign key (replaces_evidence_id) references public.dossier_documents(id) on delete restrict;
  end if;
end $$;

-- At most one direct successor per Evidence row — keeps the supersession
-- history a simple chain rather than a branching graph (two different
-- rows both claiming to replace the same prior row would make "what is
-- currently the evidence for this?" ambiguous). Multiple NULLs remain
-- allowed under a standard Postgres UNIQUE constraint, so every
-- independent, non-superseding row is unaffected — this only bites two
-- rows genuinely both pointing at the same predecessor.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'dossier_documents_replaces_evidence_id_key'
      and conrelid = 'public.dossier_documents'::regclass
  ) then
    alter table public.dossier_documents
      add constraint dossier_documents_replaces_evidence_id_key
      unique (replaces_evidence_id);
  end if;
end $$;

-- Defense-in-depth against a row claiming to replace itself — should
-- never happen given application-layer discipline, but cheap and
-- row-local to guard here, matching the same "duplicate the invariant as
-- a CHECK even when the app layer is expected to guarantee it" posture
-- already used throughout this schema.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'dossier_documents_replaces_evidence_id_not_self_check'
      and conrelid = 'public.dossier_documents'::regclass
  ) then
    alter table public.dossier_documents
      add constraint dossier_documents_replaces_evidence_id_not_self_check
      check (replaces_evidence_id is null or replaces_evidence_id <> id);
  end if;
end $$;

-- The future hot path once Evidence is Slot-scoped: every piece of
-- evidence for one Slot, newest first. Unused by any query in 12A, added
-- now so 12B needs no further migration of its own.
create index if not exists dossier_documents_requirement_slot_id_created_at_idx
  on public.dossier_documents (requirement_slot_id, created_at);

-- Supports resolving a supersession chain ("what came before this
-- upload?" / "was this ever superseded?") without a full table scan.
create index if not exists dossier_documents_replaces_evidence_id_idx
  on public.dossier_documents (replaces_evidence_id);
