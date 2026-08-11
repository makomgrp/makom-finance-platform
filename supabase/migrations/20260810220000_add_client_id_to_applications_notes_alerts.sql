-- ============================================================================
-- applications / dossier_notes / dossier_alerts: add real client_id (Milestone 14E)
-- ============================================================================
--
-- Purpose: introduces a real, FK-constrained client_id uuid on the three
-- tables that have only ever bridged to the Client Engine via the
-- unconstrained client_legacy_id text column (see the Milestone 14A
-- architecture review's Legacy Bridge Retirement Sequence, and the
-- Milestone 14B clients table migration's header comment, which
-- explicitly deferred this exact step to "Milestone 14E's scope"). After
-- this migration, client_id is the primary, always-present relationship
-- every active code path reads and writes through — see the Milestone 14E
-- implementation report for the full list of migrated consumers.
--
-- Same three-table treatment, applied identically to applications,
-- dossier_notes, and dossier_alerts — each gets its own independent
-- (A)-(F) sequence below (no cross-table ordering dependency; grouped into
-- one file only because the same six-step pattern repeats three times
-- with no genuine sequencing risk between tables):
--   (A) add client_id as a plain nullable uuid column
--   (B) backfill client_id from the existing client_legacy_id bridge, by
--       joining against clients.legacy_id — safe because Milestone 14B's
--       clients table was seeded from the exact same demo fixture id
--       space every client_legacy_id value already draws from
--   (C) defensive verification: abort loudly (RAISE EXCEPTION, rolling
--       back the whole migration) if any row's client_legacy_id has no
--       matching clients.legacy_id, and again if any row still has a null
--       client_id after the backfill — mirrors the exact discipline
--       already established by 20260809150300_finalize_requirement_
--       slots_application_id.sql and 20260809200000_retire_dossier_
--       documents_legacy_columns.sql
--   (D) promote client_id to NOT NULL
--   (E) add the FK constraint (client_id references clients(id))
--   (F) add a supporting index matching this table's actual hot-path
--       query shape
--
-- Deliberately DOES NOT drop client_legacy_id, unlike the requirement_
-- slots.application_id precedent this pattern is otherwise modeled on —
-- per this milestone's explicit scope, the legacy bridge columns remain
-- untouched, unconstrained, and still populated on every existing row
-- until a later milestone's own explicit destructive-migration decision
-- (see the Milestone 14A architecture review's retirement-sequence
-- section). What DOES change about client_legacy_id here: each of the
-- three columns is relaxed from NOT NULL to nullable. This is required,
-- not optional — client_id is now the relationship every new row is
-- created through (src/lib/services/applications.ts#createApplication,
-- notes.ts#createNote, alerts.ts#createAlert, all migrated in this same
-- milestone), and a real Client created after Milestone 14B may
-- legitimately have legacy_id = null (no legacy identity to bridge to at
-- all). Forcing every new Application/Note/Alert to keep fabricating a
-- client_legacy_id value it does not have would be exactly the
-- "compatibility shim" this milestone's instructions explicitly reject in
-- favor of leaving the column genuinely absent for new rows.
--
-- No RLS or grants change on any of the three tables — every grant/policy
-- already in place (select/insert/update as applicable, zero policies)
-- continues to apply unchanged to the new column.

-- ============================================================================
-- applications.client_id
-- ============================================================================

-- (A)
alter table public.applications
  add column if not exists client_id uuid;

-- (C, pre-backfill half): every existing client_legacy_id must already
-- resolve to a real client — verified BEFORE writing anything, so a
-- failure here leaves the table completely untouched.
do $$
declare
  v_unmatched_count integer;
begin
  select count(*)
    into v_unmatched_count
  from public.applications a
  where not exists (
    select 1 from public.clients c where c.legacy_id = a.client_legacy_id
  );

  if v_unmatched_count > 0 then
    raise exception
      'Milestone 14E safety check failed: % applications row(s) have a '
      'client_legacy_id with no matching clients.legacy_id. Aborting '
      'before any backfill — investigate and resolve these rows (or the '
      'Client Engine seed) before re-running this migration.',
      v_unmatched_count;
  end if;
end $$;

-- (B)
update public.applications a
set client_id = c.id
from public.clients c
where c.legacy_id = a.client_legacy_id
  and a.client_id is null;

-- (C, post-backfill half)
do $$
declare
  v_null_count integer;
begin
  select count(*) into v_null_count from public.applications where client_id is null;

  if v_null_count > 0 then
    raise exception
      'Milestone 14E safety check failed: % applications row(s) still '
      'have a null client_id after backfill. Aborting before promoting '
      'the column to NOT NULL.', v_null_count;
  end if;
end $$;

-- (D) — guarded on current nullability so re-running after a prior
-- success is a safe no-op.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'applications'
      and column_name = 'client_id' and is_nullable = 'YES'
  ) then
    alter table public.applications alter column client_id set not null;
  end if;
end $$;

-- (E) — ON DELETE RESTRICT, matching product_id's posture on this same
-- table: clients are never hard-deleted in this schema (only moved to
-- inactivo), so this never faces a dangling reference in practice.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'applications_client_id_fkey'
      and conrelid = 'public.applications'::regclass
  ) then
    alter table public.applications
      add constraint applications_client_id_fkey
      foreign key (client_id) references public.clients(id) on delete restrict;
  end if;
end $$;

-- (F) — mirrors applications_client_legacy_id_idx's existing role: the
-- real query shape is "one client's applications."
create index if not exists applications_client_id_idx
  on public.applications (client_id);

-- client_legacy_id relaxation — see this migration's header comment.
alter table public.applications
  alter column client_legacy_id drop not null;

comment on column public.applications.client_id is
  'The real Client this application belongs to (Milestone 14E) — the '
  'primary relationship, replacing client_legacy_id for every active '
  'code path. NOT NULL, ON DELETE RESTRICT: clients are never '
  'hard-deleted in this schema, only moved to inactivo.';
comment on column public.applications.client_legacy_id is
  'TEMPORARY bridge to the existing demo-data client ids (e.g. '
  '"cl-001") — superseded by client_id as of Milestone 14E, but not yet '
  'dropped (see the Milestone 14A architecture review''s retirement '
  'sequence; final drop belongs to a later, explicit destructive '
  'migration). Relaxed to nullable in this same migration: new '
  'applications are created through client_id only and may leave this '
  'null when their client has no legacy identity to bridge to.';

-- ============================================================================
-- dossier_notes.client_id
-- ============================================================================

-- (A)
alter table public.dossier_notes
  add column if not exists client_id uuid;

-- (C, pre-backfill half)
do $$
declare
  v_unmatched_count integer;
begin
  select count(*)
    into v_unmatched_count
  from public.dossier_notes n
  where not exists (
    select 1 from public.clients c where c.legacy_id = n.client_legacy_id
  );

  if v_unmatched_count > 0 then
    raise exception
      'Milestone 14E safety check failed: % dossier_notes row(s) have a '
      'client_legacy_id with no matching clients.legacy_id. Aborting '
      'before any backfill — investigate and resolve these rows before '
      're-running this migration.', v_unmatched_count;
  end if;
end $$;

-- (B)
update public.dossier_notes n
set client_id = c.id
from public.clients c
where c.legacy_id = n.client_legacy_id
  and n.client_id is null;

-- (C, post-backfill half)
do $$
declare
  v_null_count integer;
begin
  select count(*) into v_null_count from public.dossier_notes where client_id is null;

  if v_null_count > 0 then
    raise exception
      'Milestone 14E safety check failed: % dossier_notes row(s) still '
      'have a null client_id after backfill. Aborting before promoting '
      'the column to NOT NULL.', v_null_count;
  end if;
end $$;

-- (D)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'dossier_notes'
      and column_name = 'client_id' and is_nullable = 'YES'
  ) then
    alter table public.dossier_notes alter column client_id set not null;
  end if;
end $$;

-- (E) — ON DELETE RESTRICT, matching author_profile_id's posture on this
-- same table: a client with note history cannot be hard-deleted, only
-- moved to inactivo.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'dossier_notes_client_id_fkey'
      and conrelid = 'public.dossier_notes'::regclass
  ) then
    alter table public.dossier_notes
      add constraint dossier_notes_client_id_fkey
      foreign key (client_id) references public.clients(id) on delete restrict;
  end if;
end $$;

-- (F) — mirrors dossier_notes_client_legacy_id_created_at_idx's existing
-- role: the hot path is "one client's notes, most recent first."
create index if not exists dossier_notes_client_id_created_at_idx
  on public.dossier_notes (client_id, created_at desc);

-- client_legacy_id relaxation — see the applications section above for
-- the full reasoning; identical here.
alter table public.dossier_notes
  alter column client_legacy_id drop not null;

comment on column public.dossier_notes.client_id is
  'The real Client this note is attached to (Milestone 14E) — the '
  'primary relationship, replacing client_legacy_id for every active '
  'code path. NOT NULL, ON DELETE RESTRICT, matching author_profile_id''s '
  'posture on this same table.';
comment on column public.dossier_notes.client_legacy_id is
  'TEMPORARY bridge to the existing demo-data client ids — superseded by '
  'client_id as of Milestone 14E, but not yet dropped (final drop '
  'belongs to a later, explicit destructive migration). Relaxed to '
  'nullable in this same migration: new notes are created through '
  'client_id only and may leave this null when their client has no '
  'legacy identity to bridge to.';

-- ============================================================================
-- dossier_alerts.client_id
-- ============================================================================

-- (A)
alter table public.dossier_alerts
  add column if not exists client_id uuid;

-- (C, pre-backfill half)
do $$
declare
  v_unmatched_count integer;
begin
  select count(*)
    into v_unmatched_count
  from public.dossier_alerts al
  where not exists (
    select 1 from public.clients c where c.legacy_id = al.client_legacy_id
  );

  if v_unmatched_count > 0 then
    raise exception
      'Milestone 14E safety check failed: % dossier_alerts row(s) have a '
      'client_legacy_id with no matching clients.legacy_id. Aborting '
      'before any backfill — investigate and resolve these rows before '
      're-running this migration.', v_unmatched_count;
  end if;
end $$;

-- (B)
update public.dossier_alerts al
set client_id = c.id
from public.clients c
where c.legacy_id = al.client_legacy_id
  and al.client_id is null;

-- (C, post-backfill half)
do $$
declare
  v_null_count integer;
begin
  select count(*) into v_null_count from public.dossier_alerts where client_id is null;

  if v_null_count > 0 then
    raise exception
      'Milestone 14E safety check failed: % dossier_alerts row(s) still '
      'have a null client_id after backfill. Aborting before promoting '
      'the column to NOT NULL.', v_null_count;
  end if;
end $$;

-- (D)
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'dossier_alerts'
      and column_name = 'client_id' and is_nullable = 'YES'
  ) then
    alter table public.dossier_alerts alter column client_id set not null;
  end if;
end $$;

-- (E) — ON DELETE RESTRICT, matching created_by_profile_id's posture on
-- this same table: a client with alert history cannot be hard-deleted,
-- only moved to inactivo.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'dossier_alerts_client_id_fkey'
      and conrelid = 'public.dossier_alerts'::regclass
  ) then
    alter table public.dossier_alerts
      add constraint dossier_alerts_client_id_fkey
      foreign key (client_id) references public.clients(id) on delete restrict;
  end if;
end $$;

-- (F) — mirrors dossier_alerts_client_legacy_id_created_at_idx's existing
-- role: the hot path is "one client's alerts, most recent first."
create index if not exists dossier_alerts_client_id_created_at_idx
  on public.dossier_alerts (client_id, created_at desc);

-- client_legacy_id relaxation — see the applications section above for
-- the full reasoning; identical here.
alter table public.dossier_alerts
  alter column client_legacy_id drop not null;

comment on column public.dossier_alerts.client_id is
  'The real Client this alert is attached to (Milestone 14E) — the '
  'primary relationship, replacing client_legacy_id for every active '
  'code path. NOT NULL, ON DELETE RESTRICT, matching created_by_'
  'profile_id''s posture on this same table.';
comment on column public.dossier_alerts.client_legacy_id is
  'TEMPORARY bridge to the existing demo-data client ids — superseded by '
  'client_id as of Milestone 14E, but not yet dropped (final drop '
  'belongs to a later, explicit destructive migration). Relaxed to '
  'nullable in this same migration: new alerts are created through '
  'client_id only and may leave this null when their client has no '
  'legacy identity to bridge to.';
