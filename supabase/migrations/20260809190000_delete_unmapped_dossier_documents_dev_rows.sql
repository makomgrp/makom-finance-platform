-- ============================================================================
-- dossier_documents: delete the two unmapped development fixture rows (Milestone 12E3)
-- ============================================================================
--
-- Purpose: `recibo_servicios` and `confirmacion_descuento` are the two
-- legacy document TYPEs (src/types/document-record.ts) that Milestone 12A's
-- backfill (supabase/seed_dossier_documents_backfill_dev.sql) deliberately
-- did NOT map to a Requirement Slot — no equivalent requirement_template
-- exists for either, and inventing one now purely to give these rows a home
-- would fabricate business meaning that was never approved (see the
-- Milestone 12E architecture review, Question 6). Both rows have carried
-- requirement_slot_id = null since the column was introduced in
-- 20260809160000_add_requirement_slot_id_to_dossier_documents.sql.
--
-- Per the Milestone 12E architecture review and the Milestone 12E2
-- verification gate: these are development-fixture rows only, not
-- production customer evidence, and per Milestone 12E4's plan to promote
-- requirement_slot_id to NOT NULL, no row may still have a null
-- requirement_slot_id by the time that promotion runs. This migration
-- removes exactly these two rows now, well ahead of and independent from
-- 12E4's own column/constraint work, so that precondition is already
-- satisfied by the time 12E4 begins.
--
-- Scope discipline (Milestone 12E3 — see its own kickoff brief):
--   - Deletes ONLY these two exact rows, identified defensively below —
--     never a broader "all null requirement_slot_id" sweep, in case some
--     other, unexpected row were ever to match that broader condition.
--   - Does NOT touch Storage. `recibo_servicios-dev-seed.pdf`'s Storage
--     object (bucket 'dossier-documents', path 'cl-001/ap-001/
--     recibo_servicios/20260808T190000Z-f11e0005-aaaa-4b22-8c33-
--     000000000005.pdf' — confirmed via live read-only query before this
--     migration was written) is a SEPARATE, deliberate cleanup step, run
--     manually after this migration is verified — never bundled into a
--     single DB+Storage operation. `confirmacion_descuento`'s row has no
--     Storage object at all (storage_bucket/storage_path are both null —
--     it was seeded at status = 'pendiente', which the file-metadata
--     invariant requires to mean "no file exists"), so there is nothing to
--     clean up in Storage for that row.
--   - Does NOT promote requirement_slot_id to NOT NULL, drop any column,
--     drop any constraint, or touch document-evidence.ts's compatibility
--     shim — all of that is 12E4's job, not this migration's.
--
-- Safety: wrapped in a single DO block so the defensive pre-check, the
-- delete, and the defensive post-check all run as one atomic unit — if
-- either RAISE EXCEPTION fires, Postgres rolls back the entire block
-- (including the delete, if it had already run) and this migration fails
-- loudly rather than leaving a partial or unexpected result.

do $$
declare
  v_matched_count integer;
  v_remaining_null_count integer;
begin
  -- Pre-check: expect EXACTLY 2 rows matching the precise, known shape of
  -- these two development fixtures. Never delete a broader or narrower
  -- set than this — if the count is anything other than 2, something about
  -- the assumed live data has changed since this migration was written,
  -- and guessing would be unsafe.
  select count(*)
    into v_matched_count
  from public.dossier_documents
  where application_legacy_id = 'ap-001'
    and type in ('recibo_servicios', 'confirmacion_descuento')
    and requirement_slot_id is null;

  if v_matched_count != 2 then
    raise exception
      'Milestone 12E3 safety check failed: expected exactly 2 unmapped '
      'development fixture rows (application_legacy_id = ''ap-001'', type '
      'in (''recibo_servicios'', ''confirmacion_descuento''), '
      'requirement_slot_id is null), found %. Aborting — refusing to '
      'delete a broader or narrower set than what this migration was '
      'written and verified against.', v_matched_count;
  end if;

  delete from public.dossier_documents
  where application_legacy_id = 'ap-001'
    and type in ('recibo_servicios', 'confirmacion_descuento')
    and requirement_slot_id is null;

  -- Post-check: these two rows were the only ones in the entire table with
  -- a null requirement_slot_id (confirmed via live read-only query before
  -- this migration was written — a global count of requirement_slot_id IS
  -- NULL rows returned exactly 2, matching the pre-check above exactly).
  -- Deleting them should therefore leave zero such rows anywhere in the
  -- table. If that is not true, something unexpected has happened
  -- (concurrent write, stale assumption) and this migration must not be
  -- allowed to silently leave the table in a state Milestone 12E4's later
  -- NOT NULL promotion could not safely build on.
  select count(*)
    into v_remaining_null_count
  from public.dossier_documents
  where requirement_slot_id is null;

  if v_remaining_null_count != 0 then
    raise exception
      'Milestone 12E3 post-check failed: % row(s) still have '
      'requirement_slot_id is null after deleting the two known unmapped '
      'development fixtures. Aborting transaction — do not proceed to '
      'Milestone 12E4''s requirement_slot_id NOT NULL promotion until this '
      'is investigated and resolved.', v_remaining_null_count;
  end if;
end $$;
