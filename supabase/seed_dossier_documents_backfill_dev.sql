-- ============================================================================
-- DEVELOPMENT-ONLY backfill: dossier_documents.requirement_slot_id (Milestone 12A)
-- ============================================================================
--
-- Fixture-data backfill for local/dev verification — NOT part of the
-- application's real data model and MUST be reconciled or removed before
-- production delivery (there is no production data yet). Do not build any
-- logic that assumes this script's specific values exist.
--
-- Sets requirement_slot_id ONLY for the four existing dev dossier_
-- documents rows (all under application_legacy_id = 'ap-001') whose
-- legacy `type` has a deterministic, already-confirmed mapping to a real
-- Requirement Slot code — per the Milestone 12 architecture review's
-- "Existing 6-Row Dev-Data Migration Analysis":
--
--   cedula_pasaporte   -> government_id
--   carta_trabajo      -> salary_letter
--   ficha_css          -> css_record
--   comprobante_pago   -> last_pay_stub
--
-- Deliberately does NOT touch recibo_servicios or confirmacion_descuento
-- — neither has a corresponding Requirement Slot today, and no mapping is
-- invented here. Both rows' requirement_slot_id stays null after this
-- script runs, exactly as before. Their removal is explicitly deferred to
-- Milestone 12E, once every consumer has moved off reading them the old
-- way — see the architecture review's sequencing correction for why
-- removing them now, even though they're dev fixtures, would visibly
-- change what the still-unmodified Dossier Documents tab currently
-- displays for ap-001 (6 rows -> 4), which 12A's "zero consumer impact"
-- guarantee must not do. This script asserts, defensively, that they
-- remain untouched (see the final check below) rather than silently
-- assuming it.
--
-- Resolution path (no Requirement Slot UUID is ever hardcoded):
--   'ap-001' -> applications.legacy_id = 'ap-001' -> applications.id
--            -> requirement_slots.application_id = applications.id
--            -> requirement_slots.code = <target code>
--            -> requirement_slots.id
-- This is the same real bridge data Milestone 11 established and
-- verified — this script only ever reads it, never assumes a specific id.
--
-- Defensive by construction: aborts the entire transaction (no partial
-- writes) if any of the following is true, rather than guessing:
--   - 'ap-001' does not resolve to exactly one applications row
--   - a target requirement_slots row does not resolve exactly once for
--     any of the four codes
--   - the corresponding dossier_documents row does not exist exactly once
--     for any of the four legacy types
--   - a dossier_documents row already has a requirement_slot_id set that
--     conflicts with the newly-resolved target (never silently
--     overwritten)
--   - recibo_servicios / confirmacion_descuento are found with a non-null
--     requirement_slot_id already (this script never sets one for them,
--     so that would mean something else did)
--
-- Idempotent: re-running this script after it has already succeeded finds
-- every target row already correctly mapped and performs no writes (logged
-- via RAISE NOTICE, not an error) — safe to re-run any number of times.
--
-- No Storage object is read, moved, uploaded, or deleted by this script.

begin;

do $$
declare
  v_application_id uuid;
  v_mapping record;
  v_slot_id uuid;
  v_slot_match_count int;
  v_doc_count int;
  v_doc_id uuid;
  v_current_slot_id uuid;
begin
  -- Resolve ap-001's real Application (Milestone 11 bridge).
  select id into v_application_id
  from public.applications
  where legacy_id = 'ap-001';

  if v_application_id is null then
    raise exception 'Backfill aborted: no applications row found with legacy_id = ''ap-001''. Has the Milestone 11 applications bridge (supabase/seed_applications_dev.sql) been applied?';
  end if;

  if (select count(*) from public.applications where legacy_id = 'ap-001') > 1 then
    raise exception 'Backfill aborted: legacy_id = ''ap-001'' resolves to more than one applications row. This should be impossible under applications_legacy_id_key, but refusing to proceed rather than guessing which is correct.';
  end if;

  -- The four deterministic legacy-type -> requirement-slot-code mappings.
  -- No fifth or sixth entry exists here on purpose — see this file's
  -- header comment for why recibo_servicios / confirmacion_descuento are
  -- deliberately excluded, not overlooked.
  for v_mapping in
    select * from (values
      ('cedula_pasaporte', 'government_id'),
      ('carta_trabajo', 'salary_letter'),
      ('ficha_css', 'css_record'),
      ('comprobante_pago', 'last_pay_stub')
    ) as m(legacy_type, slot_code)
  loop
    select id, count(*) over () into v_slot_id, v_slot_match_count
    from public.requirement_slots
    where application_id = v_application_id
      and code = v_mapping.slot_code;

    if v_slot_id is null then
      raise exception 'Backfill aborted: no requirement_slots row found for application_id = % with code = ''%''. Has the Milestone 10B/11 requirement slots bridge been fully applied for ap-001?', v_application_id, v_mapping.slot_code;
    end if;

    if v_slot_match_count > 1 then
      raise exception 'Backfill aborted: % requirement_slots rows matched application_id = % and code = ''%'' — expected exactly one, refusing to guess which is correct.', v_slot_match_count, v_application_id, v_mapping.slot_code;
    end if;

    select id, requirement_slot_id, count(*) over ()
      into v_doc_id, v_current_slot_id, v_doc_count
    from public.dossier_documents
    where application_legacy_id = 'ap-001'
      and type = v_mapping.legacy_type;

    if v_doc_count is null or v_doc_count = 0 then
      raise exception 'Backfill aborted: no dossier_documents row found for application_legacy_id = ''ap-001'' and type = ''%''. Has the Milestone 8 dossier_documents dev seed been applied?', v_mapping.legacy_type;
    end if;

    if v_doc_count > 1 then
      raise exception 'Backfill aborted: % dossier_documents rows found for application_legacy_id = ''ap-001'' and type = ''%'' — expected exactly one, refusing to guess which is correct.', v_doc_count, v_mapping.legacy_type;
    end if;

    if v_current_slot_id is not null and v_current_slot_id <> v_slot_id then
      raise exception 'Backfill aborted: dossier_documents row % (type = ''%'') already has requirement_slot_id = %, which conflicts with the newly-resolved target %. Not overwriting — resolve manually.', v_doc_id, v_mapping.legacy_type, v_current_slot_id, v_slot_id;
    end if;

    if v_current_slot_id = v_slot_id then
      raise notice 'Backfill: dossier_documents row % (type = %) already correctly mapped to requirement_slot_id = % — skipping.', v_doc_id, v_mapping.legacy_type, v_slot_id;
    else
      update public.dossier_documents
      set requirement_slot_id = v_slot_id
      where id = v_doc_id;

      raise notice 'Backfill: dossier_documents row % (type = %) mapped to requirement_slot_id = %.', v_doc_id, v_mapping.legacy_type, v_slot_id;
    end if;
  end loop;

  -- Defensive assertion, not an assumption: confirm the two deliberately
  -- unmapped legacy rows are still untouched.
  if exists (
    select 1 from public.dossier_documents
    where application_legacy_id = 'ap-001'
      and type in ('recibo_servicios', 'confirmacion_descuento')
      and requirement_slot_id is not null
  ) then
    raise exception 'Backfill aborted: recibo_servicios and/or confirmacion_descuento unexpectedly already have a requirement_slot_id set. This script never sets one for either — something else did. Investigate before proceeding; not safe to continue.';
  end if;
end $$;

commit;
