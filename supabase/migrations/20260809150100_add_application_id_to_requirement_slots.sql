-- ============================================================================
-- requirement_slots: add application_id (step 1 of 2 — nullable, unconstrained)
-- ============================================================================
--
-- First step of the requirement_slots.application_legacy_id ->
-- application_id evolution, promised in the requirement_slots table
-- migration's own header comment and the Milestone 10B critical review:
-- now that a real applications table exists (Milestone 11), the temporary
-- bridge column must be fully replaced, not kept alongside a new one.
--
-- Deliberately split into three migrations rather than one, matching the
-- Milestone 11 architecture instructions exactly:
--   1. (this file) add application_id as a plain nullable column — no FK,
--      no NOT NULL, no index yet. Purely additive; safe to run with
--      existing data present.
--   2. (supabase/seed_applications_dev.sql) create the real Application
--      row(s) needed for existing dev requirement_slots rows, then map
--      application_legacy_id -> application_id for each.
--   3. (20260809150300_finalize_requirement_slots_application_id.sql)
--      verify complete mapping, promote application_id to NOT NULL, add
--      its FK constraint and indexes, then drop application_legacy_id
--      entirely.
--
-- The FK and NOT NULL constraint are deliberately deferred to step 3,
-- after the backfill in step 2 is known-complete — adding them here,
-- before any row has a value, would add no safety (every row would
-- trivially violate NOT NULL) and only forces an artificial ordering
-- dependency on how step 2 is written.

alter table public.requirement_slots
  add column if not exists application_id uuid;

comment on column public.requirement_slots.application_id is
  'The real application this slot belongs to. Nullable for now — being '
  'backfilled from application_legacy_id (see supabase/'
  'seed_applications_dev.sql) before promotion to NOT NULL with a proper '
  'FK constraint in 20260809150300_finalize_requirement_slots_'
  'application_id.sql. Once finalized, this fully replaces '
  'application_legacy_id, which is dropped in that same migration.';
