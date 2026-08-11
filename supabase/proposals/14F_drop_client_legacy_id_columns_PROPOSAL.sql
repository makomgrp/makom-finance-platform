-- ============================================================================
-- PROPOSAL — NOT A MIGRATION. NOT EXECUTED. NOT SCHEDULED.
-- Drop applications/dossier_notes/dossier_alerts.client_legacy_id (Milestone 14F)
-- ============================================================================
--
-- This file lives in supabase/proposals/, not supabase/migrations/,
-- specifically so it is never picked up by migration tooling as pending
-- work. It is a PROPOSAL only, per Milestone 14F's explicit instruction:
-- "prepare a SEPARATE destructive migration proposal. But do NOT execute
-- it." It has not been run against any environment. If you decide to
-- proceed, move/rename it into supabase/migrations/ with a fresh
-- timestamp and review it once more immediately before running it — do
-- not run it verbatim from this location.
--
-- ----------------------------------------------------------------------------
-- Why this is being proposed now
-- ----------------------------------------------------------------------------
--
-- client_legacy_id was relaxed from NOT NULL to nullable, and superseded
-- as the primary relationship by client_id, in Milestone 14E
-- (20260810220000_add_client_id_to_applications_notes_alerts.sql). That
-- migration's own column comments explicitly promised: "final drop
-- belongs to a later, explicit destructive migration." Milestone 14F's
-- full pre-cleanup audit (see the Milestone 14F implementation report)
-- confirmed, for all three columns:
--   - zero active TypeScript runtime consumers (no code reads or writes
--     client_legacy_id anywhere in src/ as of this milestone)
--   - zero foreign keys defined on any of the three columns
--   - zero Row Level Security policies reference them (RLS is enabled
--     with zero policies on all three tables, unchanged since each
--     table's creation)
--   - zero database functions, triggers, or views reference them
--     (grepped across every file in supabase/migrations/)
--   - the only remaining database objects touching them are the three
--     legacy-shaped indexes addressed below, which now serve zero
--     runtime queries for the same reason
--
-- ----------------------------------------------------------------------------
-- Why this is a PROPOSAL and not an executed step of Milestone 14F
-- ----------------------------------------------------------------------------
--
-- Dropping a populated column is irreversible: every existing row's
-- client_legacy_id value (e.g. "cl-001") would be permanently lost,
-- including on rows outside the current dev dataset if this is ever run
-- against a populated environment. Milestone 14F's own instructions are
-- explicit that this decision must be separate, explicit, and never
-- forced "merely for aesthetic reasons" — so this is offered for your
-- review and a future, deliberate decision, not applied as part of this
-- milestone's own changes.
--
-- ----------------------------------------------------------------------------
-- What this would do, if run
-- ----------------------------------------------------------------------------
--
-- Drops client_legacy_id from all three tables. Postgres automatically
-- drops any index defined over a dropped column — this includes the
-- three legacy-shaped indexes below, so no separate DROP INDEX
-- statements are needed (matches the exact precedent already established
-- by 20260809200000_retire_dossier_documents_legacy_columns.sql's own
-- header comment):
--   - applications_client_legacy_id_idx
--   - dossier_notes_client_legacy_id_created_at_idx
--   - dossier_alerts_client_legacy_id_created_at_idx
--
-- No other column, constraint, index, RLS policy, or grant on any of the
-- three tables is touched. client_id (NOT NULL, FK-constrained, and its
-- own supporting index) is entirely unaffected.
--
-- A defensive pre-check is still included below, even for a column this
-- thoroughly proven dead — matching this schema's established discipline
-- of never dropping something without re-verifying its precondition
-- immediately beforehand, in case time has passed since this proposal
-- was written and some new, unexpected write path has appeared.

do $$
declare
  v_recent_legacy_write_hint text;
begin
  -- Not a true "is anything using this" check (impossible to prove from
  -- SQL alone) — a final sanity read confirming the three tables still
  -- exist in the shape this proposal assumes, so a schema drift since
  -- writing wouldn't silently no-op or error confusingly below.
  if to_regclass('public.applications') is null
    or to_regclass('public.dossier_notes') is null
    or to_regclass('public.dossier_alerts') is null
  then
    raise exception
      'Milestone 14F drop-proposal safety check failed: one or more of '
      'applications / dossier_notes / dossier_alerts no longer exists as '
      'expected. Aborting — re-verify this proposal against the current '
      'schema before proceeding.';
  end if;

  select string_agg(table_name, ', ')
    into v_recent_legacy_write_hint
  from information_schema.columns
  where table_schema = 'public'
    and table_name in ('applications', 'dossier_notes', 'dossier_alerts')
    and column_name = 'client_legacy_id';

  if v_recent_legacy_write_hint is null then
    raise exception
      'Milestone 14F drop-proposal safety check failed: client_legacy_id '
      'was not found on any of the three target tables — it may already '
      'have been dropped. Aborting; nothing to do.';
  end if;
end $$;

alter table public.applications drop column if exists client_legacy_id;
alter table public.dossier_notes drop column if exists client_legacy_id;
alter table public.dossier_alerts drop column if exists client_legacy_id;

comment on table public.applications is
  'The Application Engine''s identity + lifecycle table (Milestone 11, '
  'finalized in Milestone 14F — see the Milestone 11 and 14 architecture '
  'reviews). client_id (Milestone 14E) is the sole Client relationship; '
  'the former client_legacy_id bridge was dropped by this migration.';
comment on table public.dossier_notes is
  'Internal staff notes attached to a client dossier (Milestone 6, '
  'finalized in Milestone 14F). client_id (Milestone 14E) is the sole '
  'Client relationship; the former client_legacy_id bridge was dropped '
  'by this migration.';
comment on table public.dossier_alerts is
  'Client dossier alerts/restrictions (Milestone 7, finalized in '
  'Milestone 14F). client_id (Milestone 14E) is the sole Client '
  'relationship; the former client_legacy_id bridge was dropped by this '
  'migration.';
