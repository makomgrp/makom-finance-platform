-- ============================================================================
-- dossier_documents: extend uploaded_source CHECK to include 'ai' (Milestone 12B)
-- ============================================================================
--
-- dossier_documents_uploaded_source_check currently allows only
-- crm_manual / website_form / whatsapp — it predates the Requirement Slot
-- / Application multi-actor pattern (Milestone 10B/11), which extended the
-- same conceptual vocabulary with a fourth value, 'ai', for the first
-- actor-type in this schema with no corresponding authenticated CRM
-- profile at all. The Document Evidence architecture review's SHA-256/
-- Metadata section recommended closing this exact inconsistency: Evidence
-- is meant to eventually be uploadable by the same four channels Slot and
-- Application already support (e.g. a future AI-driven intake pipeline
-- auto-extracting a WhatsApp attachment), and there is no reason
-- uploaded_source should support fewer values here than it does on the
-- tables it was directly modeled after.
--
-- Purely additive: broadens the allowed value set, restricts nothing,
-- accepts no value any existing row already has. No existing row can
-- possibly violate the widened constraint — this is safe against the
-- current live data by construction, not merely by inspection.
--
-- Scope is deliberately narrow: only dossier_documents_uploaded_source_
-- check changes. No other constraint on this table (including type,
-- status, or any of the file-metadata checks) is touched.
--
-- Postgres has no ALTER CONSTRAINT to widen a CHECK in place — the
-- constraint must be dropped and re-added. Both steps are guarded and
-- idempotent: re-running this migration after it has already succeeded
-- finds the old constraint already gone (drop is skipped) and the new one
-- already present (add is skipped), a safe no-op either way.

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'dossier_documents_uploaded_source_check'
      and conrelid = 'public.dossier_documents'::regclass
  ) then
    alter table public.dossier_documents
      drop constraint dossier_documents_uploaded_source_check;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'dossier_documents_uploaded_source_check'
      and conrelid = 'public.dossier_documents'::regclass
  ) then
    alter table public.dossier_documents
      add constraint dossier_documents_uploaded_source_check
      check (uploaded_source is null or uploaded_source in ('crm_manual', 'website_form', 'whatsapp', 'ai'));
  end if;
end $$;
