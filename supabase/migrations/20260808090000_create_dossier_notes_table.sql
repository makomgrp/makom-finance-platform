-- ============================================================================
-- dossier_notes
-- ============================================================================
--
-- Purpose: persistent replacement for src/lib/demo-data/notes.ts's static
-- NOTES array — internal notes staff add inside a client's dossier
-- (Notas internas tab). One row per note.
--
-- Scope (deliberately small — see the Milestone 6 architecture review for
-- the full reasoning behind each boundary):
--   - Create + read only. No edit, no delete — the current UI doesn't
--     support either, so no updated_at/deleted_at/active column is added
--     speculatively. Trivial, zero-risk additive columns whenever editing
--     or soft-deletion is actually built (same reasoning already applied
--     to messages.edited_at / messages.deleted_at in the chat migration).
--   - No application relationship yet. Notes were historically optionally
--     tied to a specific loan application (InternalNote.applicationId),
--     but the Applications module isn't migrated yet either — deferred
--     until that migration decides its own identity strategy, rather than
--     guessing at it here. A note today is scoped to a client only.
--   - No Row Level Security policies yet — same posture already used for
--     profiles and the chat tables: RLS is enabled but left fully locked.
--     Reads/writes go through the server-only Supabase client
--     (src/lib/supabase/server.ts) in the meantime.
--
-- Identity: author_profile_id is always a real profiles.id UUID, derived
-- server-side via getCurrentProfile() — never supplied by the client. See
-- src/app/(app)/expedientes/actions.ts.
--
-- client_legacy_id is a deliberate, temporary exception to that rule: the
-- Clients module has no Supabase table yet (still 100% demo data, ids like
-- "cl-001"), so there is nothing to reference with a real foreign key.
-- This column is plain text with NO constraint tying it to anything —
-- unlike profiles.legacy_id, which bridges TO a real UUID column on an
-- existing table, there is no real "clients" table yet for this to bridge
-- to. Building one now would turn this migration into a full client-
-- identity migration, which is explicitly out of scope for this milestone.
-- The Server Action layer is responsible for validating the id against the
-- current demo client list before insert; the database cannot catch a
-- bad id here. Revisit this column (likely replacing it with a real
-- client_id uuid references clients(id)) once the Clients module is
-- migrated — see the Milestone 6 architecture review's "risks" section.

create table if not exists public.dossier_notes (
  id uuid primary key default gen_random_uuid(),
  client_legacy_id text not null,
  author_profile_id uuid not null references public.profiles(id) on delete restrict,
  body text not null,
  type text not null,
  priority text not null,
  created_at timestamptz not null default now()
);

comment on table public.dossier_notes is
  'Internal staff notes attached to a client dossier. Persistent '
  'replacement for src/lib/demo-data/notes.ts. Create + read only in V1 — '
  'no edit or delete support, matching the current UI.';
comment on column public.dossier_notes.client_legacy_id is
  'Temporary bridge to the existing demo-data client ids (e.g. "cl-001") '
  '— the Clients module has no Supabase table yet, so there is nothing '
  'for this to reference with a real foreign key. Not validated at the '
  'database level; the creating Server Action validates it against the '
  'current demo client list. Not meant to be permanent — replace with a '
  'real client_id uuid foreign key once Clients is migrated.';
comment on column public.dossier_notes.author_profile_id is
  'ON DELETE RESTRICT, not CASCADE: a profile with note history cannot be '
  'hard-deleted, only deactivated (profiles.active) — matches how '
  'messages.sender_profile_id already treats this.';
comment on column public.dossier_notes.body is
  'The note text as typed by the author.';
comment on column public.dossier_notes.type is
  'One of NoteType (src/types/internal-note.ts): general, seguimiento, '
  'documentacion, evaluacion, llamada, importante. Plain text, not a '
  'Postgres ENUM type — matches profiles.role / messages.original_language '
  'elsewhere in this schema, so adding a new value is a one-line change to '
  'both this CHECK constraint and NOTE_TYPE_VALUES, never an ALTER TYPE. '
  'Restricted to the current allowed values via '
  'dossier_notes_type_check below.';
comment on column public.dossier_notes.priority is
  'One of NotePriority (src/types/internal-note.ts): baja, media, alta. '
  'Plain text for the same reason as the type column above. Restricted to '
  'the current allowed values via dossier_notes_priority_check below.';

-- Restricts type/priority to the values the app currently understands,
-- without promoting either to a Postgres ENUM type — see the column
-- comments above for why plain text + CHECK was chosen over ENUM (matches
-- the existing profiles.role / messages.original_language convention).
-- Widening either list later is a single ALTER TABLE ... DROP CONSTRAINT +
-- ADD CONSTRAINT, not a schema-wide ENUM migration.
alter table public.dossier_notes
  add constraint dossier_notes_type_check
  check (type in ('general', 'seguimiento', 'documentacion', 'evaluacion', 'llamada', 'importante'));

alter table public.dossier_notes
  add constraint dossier_notes_priority_check
  check (priority in ('baja', 'media', 'alta'));

-- The hot path: loading one client's notes, most recent first.
create index dossier_notes_client_legacy_id_created_at_idx
  on public.dossier_notes (client_legacy_id, created_at desc);

-- ============================================================================
-- Row Level Security
-- ============================================================================

-- Enabled with zero policies, same posture as profiles and the chat
-- tables: fully locked to both `anon` and `authenticated` until a real
-- per-client-note permissions model exists (which itself depends on the
-- Clients module having real, UUID-backed advisor-assignment data — see
-- the Milestone 6 architecture review). Reads/writes go through the
-- server-only Supabase client in the meantime.
alter table public.dossier_notes enable row level security;

-- ============================================================================
-- service_role grants
-- ============================================================================

-- Select + insert only, matching what the server-only notes service
-- actually does in V1 — no update or delete privilege, since neither
-- operation exists in the app yet (same reasoning as the messages table's
-- grants in the chat migration).
grant select, insert on public.dossier_notes to service_role;
