-- ============================================================================
-- dossier_documents
-- ============================================================================
--
-- Purpose: persistent replacement for the dossier Documents tab's in-memory
-- DocumentRecord state (src/lib/demo-data/documents.ts's DOCUMENTS array).
-- Today the app only ever creates exactly one row per document type per
-- loan application — a "requirement slot" that starts empty (pendiente)
-- and gets a real file attached later — but this is a CURRENT APPLICATION
-- BEHAVIOR, not a database-enforced invariant. See "Future evolution"
-- below for why no uniqueness constraint ties type to application.
--
-- Scope (Milestone 8A — see the Milestone 8 architecture review):
--   - This table backs ONLY the dossier Documents tab. The standalone
--     /documentos module, its status summary, and the dashboard's
--     "Documentos pendientes" KPI all keep reading demo data until
--     Milestone 8B migrates them to this table — same accepted, temporary
--     window as dossier_alerts had between 7A and 7B.
--   - Metadata + real Supabase Storage, not metadata-only: unlike Notes and
--     Alerts, this milestone includes an actual private Storage bucket
--     (see the companion bucket migration) — the current UI's "view" and
--     "replace" actions were confirmed to be 100% simulated (no real file
--     ever existed), so this is a genuine new capability, not a pure
--     persistence swap.
--   - No Row Level Security policies yet — same posture as every other
--     table in this schema: RLS enabled, fully locked, server-only
--     Supabase client (src/lib/supabase/server.ts) for all reads/writes.
--
-- Identity: reviewed_by_profile_id is always a real profiles.id UUID,
-- derived server-side via getCurrentProfile() — never client-supplied.
-- uploaded_by_profile_id is ALSO always server-derived when populated, but
-- is legitimately nullable — see its own column comment below.
--
-- client_legacy_id / application_legacy_id are the same deliberate,
-- temporary exception already used by dossier_notes / dossier_alerts:
-- neither Clients nor Applications has a real Supabase table yet, so
-- neither column has a foreign key. Plain text, validated only at the
-- Server Action layer against current demo data. Revisit both once
-- Clients/Applications are migrated.
--
-- ============================================================================
-- Ownership model (architectural clarification — no implementation change)
-- ============================================================================
--
-- Conceptually, an Application owns its Documents; a Client's relationship
-- to a document is only ever indirect, through the application. Both
-- client_legacy_id and application_legacy_id are stored on this table
-- today only because neither Clients nor Applications is queryable yet —
-- there is nothing to join through. Once Applications migrates to a real
-- table, the canonical foreign key here should become a single
-- application_id uuid references applications(id), and client identity
-- should be derived by joining through that relationship
-- (applications.client_id), not stored redundantly on this table. Whether
-- client_legacy_id is dropped entirely at that point, or kept briefly as
-- its own bridge during a transition, is a decision for that future
-- migration — not resolved here. This paragraph is documentation only;
-- Milestone 8A keeps both columns exactly as designed, since Clients and
-- Applications remain demo data for now.
--
-- ============================================================================
-- Future evolution: "type" is a temporary bridge, not a permanent model
-- ============================================================================
--
-- The current `type` column (a fixed, hardcoded set of six document kinds)
-- reflects today's single, non-configurable loan product. The CRM is
-- expected to evolve toward configurable financial products, where the
-- real long-term shape is closer to:
--
--   Financial Product -> Requirement Template -> Uploaded Document
--
-- A product would define which requirements exist; a requirement would
-- carry its own visible name, internal code, required/optional flag,
-- display order, validation rules, whether multiple files are allowed,
-- accepted MIME types, max file size, etc.; and an uploaded document would
-- become evidence satisfying one specific requirement (or one of several,
-- if allow_multiple_files is true for that requirement).
--
-- None of that is built now. This paragraph exists so a future migration
-- introducing requirement templates is not blocked or contradicted by
-- anything in this table: `type` should be read as a temporary stand-in
-- for "which requirement this document satisfies," not a permanent
-- business rule that a loan can only ever have these six document kinds,
-- one each. This is also *why* dossier_documents_application_type_unique
-- (a UNIQUE(application_legacy_id, type) constraint) was deliberately
-- NOT added below, despite being part of an earlier draft of this
-- migration: even today, before any requirement-template system exists,
-- some products may legitimately need multiple documents of the same
-- logical type (e.g. multiple bank statements, multiple references,
-- multiple income documents). A uniqueness constraint here would
-- permanently encode "one application has at most one document of each
-- type" at the database level — exactly the assumption this section
-- says must not be baked in. The CURRENT UI still only ever creates and
-- displays one row per type (see documents-tab.tsx's DOCUMENT_TYPE_ORDER
-- mapping), but that is an application-layer behavior, not a schema-level
-- guarantee, and the two are deliberately allowed to diverge later
-- without a migration to loosen a constraint that should never have been
-- permanent in the first place.

create table if not exists public.dossier_documents (
  id uuid primary key default gen_random_uuid(),
  client_legacy_id text not null,
  application_legacy_id text not null,
  type text not null,
  status text not null default 'pendiente',
  storage_bucket text default 'dossier-documents',
  storage_path text,
  file_name text,
  mime_type text,
  file_size_bytes bigint,
  file_sha256 text,
  uploaded_source text,
  uploaded_at timestamptz,
  uploaded_by_profile_id uuid references public.profiles(id) on delete restrict,
  reviewed_at timestamptz,
  reviewed_by_profile_id uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  metadata jsonb
);

comment on table public.dossier_documents is
  'A "requirement slot" that starts empty (pendiente) and later gets a '
  'real file attached in the private dossier-documents Storage bucket '
  '(see the companion bucket migration). Today the app only ever creates '
  'one row per document type per application, but that is current '
  'application behavior, not a schema-enforced rule — see "Future '
  'evolution" near the top of this file. Milestone 8A scope: the dossier '
  'Documents tab only — /documentos, its summary, and the dashboard '
  'pending-documents KPI still read demo data until Milestone 8B.';
comment on column public.dossier_documents.client_legacy_id is
  'Temporary bridge to the existing demo-data client ids (e.g. "cl-001") '
  '— the Clients module has no Supabase table yet. Not validated at the '
  'database level; the creating Server Action validates it against the '
  'current demo client list. Not meant to be permanent.';
comment on column public.dossier_documents.application_legacy_id is
  'Temporary bridge to the existing demo-data application ids (e.g. '
  '"ap-001") — the Applications module has no Supabase table yet, same '
  'treatment as client_legacy_id above. Documents are owned by an '
  'application (client ownership is only ever indirect, through the '
  'application) — see the "Ownership model" note near the top of this '
  'file for the canonical application_id-FK shape this should become '
  'once Applications is migrated.';
comment on column public.dossier_documents.type is
  'One of DocumentType (src/types/document-record.ts): cedula_pasaporte, '
  'carta_trabajo, ficha_css, comprobante_pago, recibo_servicios, '
  'confirmacion_descuento. Plain text, not a Postgres ENUM type — matches '
  'dossier_notes.type / dossier_alerts.type elsewhere in this schema. '
  'Restricted via dossier_documents_type_check below. Temporary bridge to '
  'a future configurable requirement-template model — see "Future '
  'evolution" near the top of this file; deliberately NOT unique per '
  'application (no UNIQUE(application_legacy_id, type) constraint exists) '
  'so a future product allowing multiple documents of the same logical '
  'type is never blocked by this schema.';
comment on column public.dossier_documents.status is
  'One of DocumentStatus (src/types/document-record.ts): pendiente, '
  'recibido, en_revision, verificado, rechazado, requiere_actualizacion. '
  'Plain text for the same reason as type. Restricted via '
  'dossier_documents_status_check below, and tied to both the file-'
  'metadata invariant (dossier_documents_status_file_check) and the '
  'review invariant (dossier_documents_review_check) below.';
comment on column public.dossier_documents.storage_bucket is
  'Which Supabase Storage bucket owns storage_path''s object. Defaults to '
  '''dossier-documents'' — for the foreseeable future almost every '
  'document belongs to that one bucket, so the default exists purely to '
  'protect against accidentally omitting it on a real upload/replace '
  'write, not to hardcode a single-bucket assumption: a future document '
  'category living in its own bucket (e.g. client-avatars, contracts, '
  'reports, loan-packages) simply provides that bucket name explicitly, '
  'which always overrides the default. No CHECK constraint restricts its '
  'values on purpose — constraining it to today''s one known bucket name '
  'would recreate the exact hidden assumption this column exists to '
  'avoid. Still nullable, and the default does NOT override an explicit '
  'null: same lockstep-with-the-file lifecycle as the other file-metadata '
  'columns (see dossier_documents_file_metadata_check below) — any INSERT '
  'creating a NO-FILE (pendiente) row must still explicitly write '
  'storage_bucket = null, since Postgres only applies a column default '
  'when the column is omitted entirely from the INSERT''s column list, '
  'never when null is passed explicitly. See '
  'supabase/seed_dossier_documents_dev.sql''s pendiente row for a worked '
  'example.';
comment on column public.dossier_documents.storage_path is
  'Real Supabase Storage object path within storage_bucket — not a '
  'display-only placeholder (contrast with the old demo fileNameDemo '
  'string, which never referenced anything real). Format: '
  '{client_legacy_id}/{application_legacy_id}/{type}/{iso_timestamp}-'
  '{upload_uuid}.{ext} — see the Milestone 8 architecture review for the '
  'full path-strategy reasoning. Null exactly when no file has been '
  'provided yet (status = pendiente); see '
  'dossier_documents_status_file_check and '
  'dossier_documents_file_metadata_check below. The extension is always '
  'derived server-side from the validated mime_type — never from the '
  'user-supplied original filename (that is stored only in file_name, for '
  'display).';
comment on column public.dossier_documents.file_name is
  'The original filename as provided by whoever uploaded the file — '
  'display purposes only, never used to derive the Storage path or '
  'extension.';
comment on column public.dossier_documents.file_sha256 is
  'Lowercase hex SHA-256 of the file''s actual bytes, computed server-side '
  'at upload time. Not enforced for uniqueness/deduplication in V1 — '
  'stored for future integrity-verification and duplicate-detection '
  'tooling. Format restricted via '
  'dossier_documents_file_sha256_format_check below.';
comment on column public.dossier_documents.uploaded_source is
  'The BUSINESS origin of the file — crm_manual (this CRM''s own manual '
  'upload/replace flow), website_form or whatsapp (future public intake '
  'channels, not built yet) — never how the database row itself happened '
  'to be created. There is deliberately no "migration"/"seed" value: this '
  'column describes where a document came from in the real world, not '
  'which script or process wrote the Postgres row. Development seed data '
  'uses crm_manual, the same value a real manual upload would use — see '
  'supabase/seed_dossier_documents_dev.sql. Null exactly when no file '
  'exists yet, same lifecycle as the other file-metadata columns.';
comment on column public.dossier_documents.uploaded_by_profile_id is
  'Who uploaded the file, when known. Deliberately nullable even once a '
  'file exists (excluded from dossier_documents_file_metadata_check on '
  'purpose): a future website-form or WhatsApp submission comes from an '
  'external client with no profiles row at all, so this being null is a '
  'legitimate, expected state for uploaded_source IN (''website_form'', '
  '''whatsapp''); it is also left null for crm_manual rows where no '
  'specific staff member is actually attributed (e.g. development seed '
  'data — see supabase/seed_dossier_documents_dev.sql). ON DELETE '
  'RESTRICT, not CASCADE, when populated: matches every other profile-id '
  'foreign key in this schema — a profile with upload history cannot be '
  'hard-deleted, only deactivated.';
comment on column public.dossier_documents.reviewed_at is
  'When the document was last reviewed to a CONCLUDED outcome. Populated '
  'only when status is verificado, rechazado, or requiere_actualizacion — '
  'cleared back to null on any transition to pendiente, recibido, or '
  'en_revision, since those states do not reflect a concluded judgment. '
  'See dossier_documents_review_check below. This is a deliberate '
  'semantics correction versus the old demo behavior (which set a '
  '"reviewer" on every status change, including non-conclusive ones, and '
  'never cleared it) — see the Milestone 8 architecture review.';
comment on column public.dossier_documents.reviewed_by_profile_id is
  'Who made the current concluded judgment — always the caller''s own '
  'getCurrentProfile() id, never client-supplied. Same lifecycle as '
  'reviewed_at. ON DELETE RESTRICT for the same reason as '
  'uploaded_by_profile_id.';
comment on column public.dossier_documents.metadata is
  'Reserved for future DERIVED information about the file only — output '
  'that some future process computes FROM the document, never data the '
  'application itself needs to operate correctly today. Examples: OCR '
  'output, extracted fields, detected language, page count, confidence '
  'score, signature detection, AI/document classification, validation '
  'results. Nothing in Milestone 8A (or any milestone after it, until '
  'explicitly built) reads or writes this column — it exists now purely '
  'so a future AI/document-processing feature has somewhere to land '
  'without a schema migration being the blocker. Deliberately '
  'unconstrained: no CHECK, no index, no assumed shape — the eventual '
  'feature that populates it should define its own shape when it '
  'actually exists. '
  'metadata must NEVER become this table''s source of truth for '
  'operational business data. status, uploaded_at, reviewed_at, '
  'reviewed_by_profile_id, uploaded_by_profile_id, storage_path, and '
  'storage_bucket all always belong in their own dedicated relational '
  'columns (above) — every one of them participates in a CHECK '
  'constraint, a foreign key, an index, or query filtering that a jsonb '
  'blob cannot support safely or efficiently. Do not let a future '
  'feature take a shortcut by writing any of that operational state into '
  'metadata instead of its real column.';

-- ============================================================================
-- Constraints
-- ============================================================================
--
-- Every ADD CONSTRAINT below is wrapped in a pg_constraint existence check
-- scoped to this table (conrelid), matching the re-runnable-migration
-- standard established for dossier_alerts — safe to re-run this migration
-- without erroring on already-applied constraints.

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'dossier_documents_type_check'
      and conrelid = 'public.dossier_documents'::regclass
  ) then
    alter table public.dossier_documents
      add constraint dossier_documents_type_check
      check (type in (
        'cedula_pasaporte',
        'carta_trabajo',
        'ficha_css',
        'comprobante_pago',
        'recibo_servicios',
        'confirmacion_descuento'
      ));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'dossier_documents_status_check'
      and conrelid = 'public.dossier_documents'::regclass
  ) then
    alter table public.dossier_documents
      add constraint dossier_documents_status_check
      check (status in (
        'pendiente',
        'recibido',
        'en_revision',
        'verificado',
        'rechazado',
        'requiere_actualizacion'
      ));
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
      check (uploaded_source is null or uploaded_source in (
        'crm_manual',
        'website_form',
        'whatsapp'
      ));
  end if;
end $$;

-- The file-metadata invariant: a document slot is either NO FILE (all
-- eight file-related columns null) or FILE PRESENT (all eight populated)
-- — never a mix. uploaded_by_profile_id is deliberately excluded (see its
-- column comment above); it is independently nullable in both states.
-- metadata (the future AI/document-processing column) is ALSO
-- deliberately excluded — per its own column comment, it is intentionally
-- unconstrained and not tied to any lifecycle yet.
--
-- storage_bucket carries a column default ('dossier-documents' — see its
-- own comment) but that default does NOT create a NO-FILE-branch
-- violation risk on its own: Postgres only applies a default when a
-- column is omitted from an INSERT's column list. Any INSERT creating a
-- NO-FILE (pendiente) row must still explicitly pass storage_bucket =
-- null to satisfy this constraint, exactly as it must for every other
-- column in the NO FILE branch below.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'dossier_documents_file_metadata_check'
      and conrelid = 'public.dossier_documents'::regclass
  ) then
    alter table public.dossier_documents
      add constraint dossier_documents_file_metadata_check
      check (
        (
          storage_bucket is null and storage_path is null and file_name is null and mime_type is null
          and file_size_bytes is null and file_sha256 is null
          and uploaded_source is null and uploaded_at is null
        )
        or
        (
          storage_bucket is not null and storage_path is not null and file_name is not null and mime_type is not null
          and file_size_bytes is not null and file_sha256 is not null
          and uploaded_source is not null and uploaded_at is not null
        )
      );
  end if;
end $$;

-- Ties the file-metadata invariant above to status: pendiente means no file
-- exists; any other status means a file exists. Combined with
-- dossier_documents_file_metadata_check, this makes "status = pendiente"
-- and "all eight file columns null" logically equivalent.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'dossier_documents_status_file_check'
      and conrelid = 'public.dossier_documents'::regclass
  ) then
    alter table public.dossier_documents
      add constraint dossier_documents_status_file_check
      check ((status = 'pendiente') = (storage_path is null));
  end if;
end $$;

-- The review invariant: reviewed_at/reviewed_by_profile_id are populated if
-- and only if status is a CONCLUDED outcome (verificado, rechazado,
-- requiere_actualizacion) — never for pendiente/recibido/en_revision. See
-- the reviewed_at column comment above for the reasoning.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'dossier_documents_review_check'
      and conrelid = 'public.dossier_documents'::regclass
  ) then
    alter table public.dossier_documents
      add constraint dossier_documents_review_check
      check (
        (status in ('verificado', 'rechazado', 'requiere_actualizacion'))
        = (reviewed_at is not null and reviewed_by_profile_id is not null)
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'dossier_documents_mime_type_check'
      and conrelid = 'public.dossier_documents'::regclass
  ) then
    alter table public.dossier_documents
      add constraint dossier_documents_mime_type_check
      check (mime_type is null or mime_type in (
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp'
      ));
  end if;
end $$;

-- 20 MB business limit (20 * 1024 * 1024 bytes). Nullable-compatible: only
-- enforced once file_size_bytes is actually populated.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'dossier_documents_file_size_check'
      and conrelid = 'public.dossier_documents'::regclass
  ) then
    alter table public.dossier_documents
      add constraint dossier_documents_file_size_check
      check (file_size_bytes is null or (file_size_bytes > 0 and file_size_bytes <= 20971520));
  end if;
end $$;

-- Lowercase 64-character hex — matches Node's crypto.createHash('sha256')
-- .digest('hex') output exactly, no normalization needed in application code.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'dossier_documents_file_sha256_format_check'
      and conrelid = 'public.dossier_documents'::regclass
  ) then
    alter table public.dossier_documents
      add constraint dossier_documents_file_sha256_format_check
      check (file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$');
  end if;
end $$;

-- Deliberately NO UNIQUE(application_legacy_id, type) constraint — see the
-- "Future evolution" note near the top of this file. The current UI only
-- ever creates one row per type per application, but the schema must not
-- permanently encode that as a database-level rule: a future configurable
-- product may legitimately require multiple documents of the same
-- logical type (multiple bank statements, multiple references, etc.).

-- No two metadata rows ever reference the same Storage object. Multiple
-- NULLs (every pendiente row) are allowed under a standard unique
-- constraint in Postgres — this only bites once storage_path is populated.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'dossier_documents_storage_path_unique'
      and conrelid = 'public.dossier_documents'::regclass
  ) then
    alter table public.dossier_documents
      add constraint dossier_documents_storage_path_unique
      unique (storage_path);
  end if;
end $$;

-- The hot path: loading every document for a client (across all of their
-- applications), most recent first.
create index if not exists dossier_documents_client_legacy_id_idx
  on public.dossier_documents (client_legacy_id, created_at desc);

-- ============================================================================
-- Row Level Security
-- ============================================================================

-- Enabled with zero policies, same posture as every other table in this
-- schema: fully locked to both `anon` and `authenticated` until a real
-- per-client-document permissions model exists. Reads/writes go through
-- the server-only Supabase client in the meantime.
alter table public.dossier_documents enable row level security;

-- ============================================================================
-- service_role grants
-- ============================================================================

-- Select + insert + update — update covers both status changes and
-- upload/replace (which updates the existing requirement-slot row rather
-- than inserting a new one). No delete privilege: the current UI never
-- deletes a document record, and replace keeps the previous Storage object
-- rather than removing anything (see the bucket migration's comments).
grant select, insert, update on public.dossier_documents to service_role;
