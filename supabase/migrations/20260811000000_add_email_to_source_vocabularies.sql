-- ============================================================================
-- Add 'email' to the shared source/channel vocabulary (Milestone 15B)
-- ============================================================================
--
-- Damion's Phase 1 requirement explicitly includes email as an
-- application-intake channel, alongside crm_manual/website_form/whatsapp/
-- ai. Every table in this schema that models "which channel/actor-type
-- did this" already shares one vocabulary by deliberate design (see e.g.
-- requirement_slots.status_changed_source's own comment: "mirrors
-- dossier_documents.uploaded_source"), so this migration widens every
-- CHECK constraint built on that shared vocabulary together, in one
-- place, rather than piecemeal.
--
-- Five constraints, across four tables, are affected:
--   1. applications.created_source            (applications_created_source_check)
--   2. applications.status_changed_source      (applications_status_changed_source_check)
--   3. requirement_slots.status_changed_source (requirement_slots_status_changed_source_check)
--   4. dossier_documents.uploaded_source        (dossier_documents_uploaded_source_check)
--   5. clients.created_source                   (clients_created_source_check)
--
-- (5) is not one of the three the Milestone 15B brief named explicitly
-- (ApplicationSource / RequirementSlotSource / EvidenceUploadedSource),
-- but clients.created_source is typed as `ApplicationSource` at the
-- TypeScript level (src/lib/services/clients.ts's own toClient()) and its
-- migration comment says so explicitly ("reused rather than redefined")
-- — leaving its CHECK constraint at four values while the shared
-- TypeScript type allows five would let a value TypeScript considers
-- perfectly legal (`email`) fail at the database with a raw constraint
-- violation the very first time an intake-created Client used it. Found
-- via the pre-implementation audit required by this milestone's own
-- instructions ("Audit every schema/type/config that intentionally
-- mirrors this source vocabulary").
--
-- Purely additive: broadens each allowed value set, restricts nothing,
-- accepts no value any existing row already has. No existing row can
-- possibly violate any of the five widened constraints — this is safe
-- against current live data by construction. No value is removed from
-- any of the five vocabularies.
--
-- Follows the exact drop-and-re-add pattern already established by
-- 20260809170000_extend_dossier_documents_uploaded_source_check.sql
-- (chosen there because Postgres has no ALTER CONSTRAINT to widen a
-- CHECK in place) — reused here unchanged, five times. Every step is
-- guarded and idempotent: re-running this migration after it has already
-- succeeded finds each old constraint already gone (drop skipped) and
-- each new one already present (add skipped), a safe no-op either way.

-- ----------------------------------------------------------------------------
-- 1. applications.created_source
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'applications_created_source_check'
      and conrelid = 'public.applications'::regclass
  ) then
    alter table public.applications drop constraint applications_created_source_check;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'applications_created_source_check'
      and conrelid = 'public.applications'::regclass
  ) then
    alter table public.applications
      add constraint applications_created_source_check
      check (created_source in ('crm_manual', 'website_form', 'whatsapp', 'email', 'ai'));
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2. applications.status_changed_source
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'applications_status_changed_source_check'
      and conrelid = 'public.applications'::regclass
  ) then
    alter table public.applications drop constraint applications_status_changed_source_check;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'applications_status_changed_source_check'
      and conrelid = 'public.applications'::regclass
  ) then
    alter table public.applications
      add constraint applications_status_changed_source_check
      check (status_changed_source is null or status_changed_source in ('crm_manual', 'website_form', 'whatsapp', 'email', 'ai'));
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3. requirement_slots.status_changed_source
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'requirement_slots_status_changed_source_check'
      and conrelid = 'public.requirement_slots'::regclass
  ) then
    alter table public.requirement_slots drop constraint requirement_slots_status_changed_source_check;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'requirement_slots_status_changed_source_check'
      and conrelid = 'public.requirement_slots'::regclass
  ) then
    alter table public.requirement_slots
      add constraint requirement_slots_status_changed_source_check
      check (status_changed_source is null or status_changed_source in ('crm_manual', 'website_form', 'whatsapp', 'email', 'ai'));
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 4. dossier_documents.uploaded_source
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'dossier_documents_uploaded_source_check'
      and conrelid = 'public.dossier_documents'::regclass
  ) then
    alter table public.dossier_documents drop constraint dossier_documents_uploaded_source_check;
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
      check (uploaded_source is null or uploaded_source in ('crm_manual', 'website_form', 'whatsapp', 'email', 'ai'));
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 5. clients.created_source
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'clients_created_source_check'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients drop constraint clients_created_source_check;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_created_source_check'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_created_source_check
      check (created_source in ('crm_manual', 'website_form', 'whatsapp', 'email', 'ai'));
  end if;
end $$;
