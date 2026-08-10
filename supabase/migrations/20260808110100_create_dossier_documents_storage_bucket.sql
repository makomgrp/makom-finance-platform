-- ============================================================================
-- dossier-documents Storage bucket
-- ============================================================================
--
-- Purpose: private object storage backing public.dossier_documents. Rows
-- whose storage_bucket = 'dossier-documents' reference objects here via
-- their storage_path — every row Milestone 8A ever inserts, but
-- dossier_documents.storage_bucket is an explicit per-row column, not a
-- hardcoded assumption, precisely so a future bucket (e.g.
-- client-avatars, contracts, reports) doesn't require revisiting that
-- table's schema. See the dossier_documents table migration's
-- storage_bucket column comment for the full reasoning.
--
-- Private (public = false) — never publicly readable. All access is
-- server-mediated: uploads and signed URL generation both go exclusively
-- through the server-only Supabase client (src/lib/supabase/server.ts,
-- SUPABASE_SECRET_KEY), the same posture already used for every table in
-- this schema. No storage.objects RLS policy is added here, on purpose —
-- that subsystem already has RLS enabled by default project-wide, and
-- adding zero policies to it keeps it fully locked to both `anon` and
-- `authenticated`, mirroring the "RLS enabled, zero policies" posture used
-- for profiles/chat/dossier_notes/dossier_alerts/dossier_documents. A
-- future permissions milestone would need to design table RLS and Storage
-- access together, not this one in isolation.
--
-- Path structure (enforced by application code at upload time, not by
-- anything in this migration): {client_legacy_id}/{application_legacy_id}/
-- {document_type}/{iso_timestamp}-{upload_uuid}.{ext} — organizational
-- only, not a security boundary. See the dossier_documents table migration
-- and the Milestone 8 architecture review for the full reasoning.
--
-- Idempotent: bucket ids are unique, so re-running this is a no-op if the
-- bucket already exists.

insert into storage.buckets (id, name, public)
values ('dossier-documents', 'dossier-documents', false)
on conflict (id) do nothing;
