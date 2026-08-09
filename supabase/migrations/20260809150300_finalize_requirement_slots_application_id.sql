-- ============================================================================
-- requirement_slots: finalize application_id (step 3 of 3)
-- ============================================================================
--
-- Final step of the requirement_slots.application_legacy_id ->
-- application_id evolution (see 20260809150100_add_application_id_to_
-- requirement_slots.sql's header comment for the full 3-step plan, and
-- supabase/seed_applications_dev.sql for step 2, the backfill). By the
-- time this migration runs, every existing requirement_slots row must
-- already have application_id populated — this is verified below with a
-- preflight check that aborts the whole migration rather than silently
-- promoting a column that would immediately reject existing data, mirroring
-- the same "abort instead of leaving partial state" discipline already
-- used throughout this schema's dev seeds.
--
-- Deliberately run as its own migration, after the backfill, rather than
-- combined with 20260809150100: adding the FK and NOT NULL constraint
-- before the data was known-good would add no safety (every row would
-- trivially violate NOT NULL at that point) and would force an
-- artificial ordering dependency on exactly how the backfill script is
-- written. Separating "add nullable column" from "constrain it" is
-- standard safe-migration practice and matches the phased structure the
-- Milestone 11 architecture instructions explicitly requested.
--
-- application_legacy_id is dropped entirely in this same migration, not
-- kept alongside application_id — per the Milestone 10B critical review's
-- explicit conclusion (see the original requirement_slots table
-- migration's header comment): keeping both permanently would recreate,
-- in a worse form, the exact redundant-dual-source-of-truth problem
-- already rejected for product_id. Postgres automatically drops any
-- index or constraint defined over a dropped column — this includes the
-- two composite indexes previously keyed on application_legacy_id and
-- the original unique (application_legacy_id, requirement_template_id)
-- constraint from the requirement_slots table migration, both replaced
-- here with equivalent application_id-based versions before the drop.
--
-- Not touched by this migration, and not to be confused with the column
-- dropped above despite the similar name: applications.legacy_id (added
-- by 20260809150200_add_legacy_id_to_applications.sql) is a separate
-- bridge, on a different table, serving a different purpose — it maps a
-- real Application row back to a demo LoanApplication id (e.g. "ap-001")
-- for the still-outstanding future migration of Solicitudes/the Dossier
-- view off demo data. It deliberately survives this finalization and
-- every future one until that migration happens; nothing here drops or
-- otherwise references it.

do $$
declare
  v_unmapped_count int;
begin
  select count(*) into v_unmapped_count
  from public.requirement_slots
  where application_id is null;

  if v_unmapped_count > 0 then
    raise exception 'Cannot finalize requirement_slots.application_id: % row(s) still have a null application_id. Run supabase/seed_applications_dev.sql (or the equivalent backfill for any other legacy application ids) first, and re-verify before re-running this migration.', v_unmapped_count;
  end if;
end $$;

alter table public.requirement_slots
  alter column application_id set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'requirement_slots_application_id_fkey'
      and conrelid = 'public.requirement_slots'::regclass
  ) then
    alter table public.requirement_slots
      add constraint requirement_slots_application_id_fkey
      foreign key (application_id) references public.applications(id) on delete restrict;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'requirement_slots_application_id_requirement_template_id_key'
      and conrelid = 'public.requirement_slots'::regclass
  ) then
    alter table public.requirement_slots
      add constraint requirement_slots_application_id_requirement_template_id_key
      unique (application_id, requirement_template_id);
  end if;
end $$;

-- Replaces requirement_slots_application_legacy_id_display_order_idx /
-- requirement_slots_application_legacy_id_status_idx, which Postgres
-- automatically drops along with the application_legacy_id column below.
create index if not exists requirement_slots_application_id_display_order_idx
  on public.requirement_slots (application_id, display_order);

create index if not exists requirement_slots_application_id_status_idx
  on public.requirement_slots (application_id, status);

alter table public.requirement_slots
  drop column if exists application_legacy_id;

comment on column public.requirement_slots.application_id is
  'The application this slot belongs to — fully replaces the former '
  'application_legacy_id text bridge (dropped by this migration). NOT '
  'NULL, ON DELETE RESTRICT: applications are never hard-deleted in this '
  'schema, only moved to a terminal status, so this never faces a '
  'dangling reference in practice.';
