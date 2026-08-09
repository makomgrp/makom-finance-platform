-- ============================================================================
-- dossier_alerts
-- ============================================================================
--
-- Purpose: persistent replacement for the dossier Alerts tab's in-memory
-- ClientAlert state (src/lib/demo-data/alerts.ts's ALERTS array, as read by
-- src/components/dossier/tabs/alerts-tab.tsx). One row per alert.
--
-- Scope (Milestone 7A — see the Milestone 7 architecture review):
--   - This table backs ONLY the dossier Alerts tab. src/lib/demo-data/
--     alerts.ts's ALERTS array, getActiveAlerts(), the standalone /alertas
--     module (alerts-table.tsx, alerts-summary.tsx), and the Topbar's
--     active-alert badge all keep reading demo data for now — they migrate
--     to this same table in Milestone 7B, not here. Until then, the
--     dossier tab and those other three surfaces are known to show
--     different data; this is an accepted, temporary, explicitly-decided
--     state, not an oversight.
--   - Create + read + update (resolve/reactivate) only. No delete — the
--     current UI never deletes an alert, only toggles it.
--   - No application relationship — ClientAlert never had one.
--   - No Row Level Security policies yet — same posture already used for
--     profiles, chat, and dossier_notes: RLS is enabled but left fully
--     locked. Reads/writes go through the server-only Supabase client
--     (src/lib/supabase/server.ts) in the meantime.
--
-- Identity: created_by_profile_id and resolved_by_profile_id are always
-- real profiles.id UUIDs, derived server-side via getCurrentProfile() —
-- never supplied by the client. See src/app/(app)/expedientes/actions.ts.
--
-- created_by_profile_id, not responsible_profile_id: the current UI's
-- ClientAlert.responsibleUserId is set unconditionally to whoever creates
-- the alert — there is no picker letting a user name someone else as
-- "responsible". It is actor identity (who registered the alert),
-- functionally identical to dossier_notes.author_profile_id, not a
-- business assignment like client.assignedAdvisorId. Named accordingly
-- here to reflect what it actually is. A genuine "assign this alert to
-- someone else" feature, if ever built, would be a new, separate column
-- (e.g. assigned_to_profile_id) with its own picker UI — out of scope.
--
-- client_legacy_id is the same deliberate, temporary exception used by
-- dossier_notes: the Clients module has no Supabase table yet (still
-- 100% demo data, ids like "cl-001"), so there is nothing to reference
-- with a real foreign key. Plain text, no constraint tying it to
-- anything. The creating Server Action validates it against the current
-- demo client list; the database cannot catch a bad id here. Revisit
-- (likely replacing it with a real client_id uuid references clients(id))
-- once the Clients module is migrated.

create table if not exists public.dossier_alerts (
  id uuid primary key default gen_random_uuid(),
  client_legacy_id text not null,
  created_by_profile_id uuid not null references public.profiles(id) on delete restrict,
  type text not null,
  level text not null,
  reason text not null,
  observation text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_profile_id uuid references public.profiles(id) on delete restrict
);

comment on table public.dossier_alerts is
  'Client dossier alerts/restrictions. Persistent replacement for the '
  'dossier Alerts tab''s in-memory ClientAlert state. Milestone 7A scope: '
  'the dossier tab only — /alertas, its summary, and the Topbar badge '
  'still read demo data until Milestone 7B migrates them to this table.';
comment on column public.dossier_alerts.client_legacy_id is
  'Temporary bridge to the existing demo-data client ids (e.g. "cl-001") '
  '— the Clients module has no Supabase table yet, so there is nothing '
  'for this to reference with a real foreign key. Not validated at the '
  'database level; the creating Server Action validates it against the '
  'current demo client list. Not meant to be permanent — replace with a '
  'real client_id uuid foreign key once Clients is migrated.';
comment on column public.dossier_alerts.created_by_profile_id is
  'Who registered the alert — always the caller''s own getCurrentProfile() '
  'id, never client-supplied. Named created_by, not responsible: the '
  'current UI has no "assign to someone else" picker, so this is actor '
  'identity, not a business assignment. ON DELETE RESTRICT, not CASCADE: '
  'a profile with alert history cannot be hard-deleted, only deactivated '
  '(profiles.active) — matches dossier_notes.author_profile_id and '
  'messages.sender_profile_id elsewhere in this schema.';
comment on column public.dossier_alerts.type is
  'One of AlertType (src/types/client-alert.ts): documento_inconsistente, '
  'informacion_pendiente, solicitud_duplicada, incumplimiento_previo, '
  'comportamiento_inapropiado, posible_fraude, revision_especial, '
  'restriccion_interna. Plain text, not a Postgres ENUM type — matches '
  'dossier_notes.type / profiles.role elsewhere in this schema. '
  'Restricted to the current allowed values via '
  'dossier_alerts_type_check below.';
comment on column public.dossier_alerts.level is
  'One of AlertLevel (src/types/client-alert.ts): bajo, medio, alto, '
  'critico. Plain text for the same reason as the type column above. '
  'Restricted to the current allowed values via '
  'dossier_alerts_level_check below.';
comment on column public.dossier_alerts.reason is
  'Required short reason, as typed by the creator. Maps directly to '
  'ClientAlert.reason.';
comment on column public.dossier_alerts.observation is
  'Optional longer observation, as typed by the creator. Maps directly '
  'to ClientAlert.observation. Null, not empty string, when omitted.';
comment on column public.dossier_alerts.active is
  'true = open, false = resolved. The dossier UI''s resolve/reactivate '
  'button toggles this in both directions — this is not a one-way close. '
  'See dossier_alerts_resolution_state_check below for the invariant '
  'this column participates in.';
comment on column public.dossier_alerts.resolved_at is
  'When the alert was last resolved. Describes the CURRENT resolution '
  'episode, not a permanent historical record — cleared back to null on '
  'reactivation, matching resolved_by_profile_id. A full audit history of '
  'every resolve/reactivate cycle is a future, separate concern (see the '
  'Milestone 7 architecture review''s activity-log deferral), not this '
  'column''s job.';
comment on column public.dossier_alerts.resolved_by_profile_id is
  'Who last resolved the alert — always the caller''s own '
  'getCurrentProfile() id at the moment of resolution, never '
  'client-supplied. Cleared back to null on reactivation, same lifecycle '
  'as resolved_at. ON DELETE RESTRICT for the same reason as '
  'created_by_profile_id.';

-- Restricts type/level to the values the app currently understands,
-- without promoting either to a Postgres ENUM type — matches the
-- dossier_notes precedent. Widening either list later is a single
-- DROP CONSTRAINT + ADD CONSTRAINT, not a schema-wide ENUM migration.
--
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS syntax, so each is guarded
-- with an explicit pg_constraint existence check instead — same
-- re-runnable-migration standard already used elsewhere in this schema
-- (e.g. the profiles/chat table grants and the create-if-not-exists
-- statements throughout).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'dossier_alerts_type_check'
      and conrelid = 'public.dossier_alerts'::regclass
  ) then
    alter table public.dossier_alerts
      add constraint dossier_alerts_type_check
      check (type in (
        'documento_inconsistente',
        'informacion_pendiente',
        'solicitud_duplicada',
        'incumplimiento_previo',
        'comportamiento_inapropiado',
        'posible_fraude',
        'revision_especial',
        'restriccion_interna'
      ));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'dossier_alerts_level_check'
      and conrelid = 'public.dossier_alerts'::regclass
  ) then
    alter table public.dossier_alerts
      add constraint dossier_alerts_level_check
      check (level in ('bajo', 'medio', 'alto', 'critico'));
  end if;
end $$;

-- The resolution-state invariant: an alert is always in exactly one of two
-- valid shapes — OPEN (active, no resolution metadata) or RESOLVED
-- (inactive, complete resolution metadata). Enforced here so this can
-- never be violated even by a bug in the application layer, not just by
-- convention. setDossierAlertStatus (src/lib/services/alerts.ts) is
-- written to only ever produce one of these two shapes in a single
-- UPDATE statement — see its own comments for how it stays race-safe and
-- idempotent under this constraint.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'dossier_alerts_resolution_state_check'
      and conrelid = 'public.dossier_alerts'::regclass
  ) then
    alter table public.dossier_alerts
      add constraint dossier_alerts_resolution_state_check
      check (
        (active = true and resolved_at is null and resolved_by_profile_id is null)
        or
        (active = false and resolved_at is not null and resolved_by_profile_id is not null)
      );
  end if;
end $$;

-- The hot path: loading one client's alerts, most recent first.
create index if not exists dossier_alerts_client_legacy_id_created_at_idx
  on public.dossier_alerts (client_legacy_id, created_at desc);

-- ============================================================================
-- Row Level Security
-- ============================================================================

-- Enabled with zero policies, same posture as profiles, chat, and
-- dossier_notes: fully locked to both `anon` and `authenticated` until a
-- real per-client-alert permissions model exists (which itself depends on
-- the Clients module having real, UUID-backed advisor-assignment data —
-- see the Milestone 6/7 architecture reviews). Reads/writes go through the
-- server-only Supabase client in the meantime.
alter table public.dossier_alerts enable row level security;

-- ============================================================================
-- service_role grants
-- ============================================================================

-- Select + insert + update — update is new relative to dossier_notes,
-- needed for the real resolve/reactivate flow. No delete privilege: the
-- current UI never deletes an alert, only toggles it.
grant select, insert, update on public.dossier_alerts to service_role;
