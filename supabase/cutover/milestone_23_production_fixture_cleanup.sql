-- ============================================================================
-- Milestone 23 — PRODUCTION FIXTURE CLEANUP  ***DRAFT — NOT APPLIED***
-- ============================================================================
--
--   ####################################################################
--   #  THIS SCRIPT PERMANENTLY DELETES DATA. IT HAS NOT BEEN RUN.      #
--   #  Read supabase/cutover/README.md before doing anything with it.  #
--   #  It lives OUTSIDE supabase/migrations/ so `db push` cannot       #
--   #  apply it by accident. Move it in, with a fresh timestamp,       #
--   #  only at cutover time and only after review.                     #
--   ####################################################################
--
-- PURPOSE. Remove every development fixture and milestone test record from the
-- business tables, so ODL receives an empty CRM rather than one populated with
-- 17 fabricated clients. Provenance for every predicate below was established
-- by the Milestone 22 pre-go-live audit.
--
-- ----------------------------------------------------------------------------
-- HOW A FIXTURE IS IDENTIFIED — AND WHY THAT IS SAFE
-- ----------------------------------------------------------------------------
-- clients:      legacy_id IS NOT NULL
--
--   createClient() NEVER writes legacy_id (see src/lib/services/clients.ts and
--   the clients table migration header). A legacy_id can therefore only have
--   come from the seed/bridge era. At audit time this matched 17 of 17 rows,
--   and independently every one of those rows also had created_by_profile_id
--   IS NULL — which a CRM-created client never has. Two independent signals,
--   same set.
--
-- applications: legacy_id IS NOT NULL  OR  the enumerated test application
--
--   The fixture application carries legacy_id 'ap-001'. The Milestone 17
--   runtime test application (ODL-2026-000018, amount 1234.56, term 17) has NO
--   legacy_id and cannot be caught by a predicate, so it is named explicitly
--   by application_number. Naming it is deliberate: a blanket "delete all
--   applications" would be indistinguishable from a mistake once ODL has real
--   ones.
--
-- everything else: reached only through those two sets, never independently.
--
-- ----------------------------------------------------------------------------
-- SAFETY POSTURE
-- ----------------------------------------------------------------------------
--   * ONE TRANSACTION. Any failure — including the guard — rolls the whole
--     thing back. There is no partially-cleaned state.
--   * GUARDED. Aborts if a real (non-legacy) client exists. If ODL has started
--     entering real work, this script refuses to run at all.
--   * IDEMPOTENT. Every delete is predicate-scoped, so a second run deletes
--     nothing and reports zeroes.
--   * REPORTS. Raises a NOTICE with before/after counts so the operator sees
--     exactly what happened.
--
-- ----------------------------------------------------------------------------
-- DELIBERATELY NOT DONE HERE  (see README.md for each)
-- ----------------------------------------------------------------------------
--   products / requirement_templates — fixture identity not provable in SQL
--   profiles                         — retained; FK targets for kept audit facts
--   auth.users                       — never managed from SQL
--   crm_events                       — append-only; never deleted
--   storage objects                  — SQL cannot remove them; out-of-band step
--   applications_number_seq          — business decision; commented out below
-- ============================================================================

begin;


-- ----------------------------------------------------------------------------
-- 0. GUARD — refuse to run against real business data
-- ----------------------------------------------------------------------------
do $$
declare
  v_real_clients int;
  v_real_apps int;
begin
  select count(*) into v_real_clients
  from public.clients
  where legacy_id is null;

  select count(*) into v_real_apps
  from public.applications
  where legacy_id is null
    and application_number <> 'ODL-2026-000018';

  if v_real_clients > 0 or v_real_apps > 0 then
    raise exception
      'ABORTED: this database contains % client(s) and % application(s) that are NOT development fixtures. Fixture cleanup must never run against real ODL records. Investigate before proceeding.',
      v_real_clients, v_real_apps
      using errcode = '22023';
  end if;

  raise notice 'Guard passed: 0 real clients, 0 real applications. Proceeding.';
  raise notice 'BEFORE — clients=%, applications=%, slots=%, documents=%, notes=%, alerts=%, conversations=%, messages=%, crm_events=%',
    (select count(*) from public.clients),
    (select count(*) from public.applications),
    (select count(*) from public.requirement_slots),
    (select count(*) from public.dossier_documents),
    (select count(*) from public.dossier_notes),
    (select count(*) from public.dossier_alerts),
    (select count(*) from public.conversations),
    (select count(*) from public.messages),
    (select count(*) from public.crm_events);
end $$;


-- ----------------------------------------------------------------------------
-- 1. The fixture entity sets, resolved once
-- ----------------------------------------------------------------------------
create temporary table _cutover_clients on commit drop as
  select id from public.clients where legacy_id is not null;

create temporary table _cutover_applications on commit drop as
  select id from public.applications
  where legacy_id is not null
     or application_number = 'ODL-2026-000018';


-- ----------------------------------------------------------------------------
-- 2. Chat — seeded conversations
-- ----------------------------------------------------------------------------
-- ALL chat data is fixture (supabase/dev-seeds/seed_chat_dev.sql); no real
-- message has ever been sent. Deleted explicitly in dependency order for a
-- visible, auditable sequence, even though conversations -> members/messages
-- and messages -> translations are already ON DELETE CASCADE.
--
-- NOTE: messages.sender_profile_id is ON DELETE RESTRICT against profiles.
-- Removing these messages is what later makes the demo personas deletable, if
-- deletion is ever chosen. Milestone 23 does not delete them.
delete from public.message_translations
where message_id in (select id from public.messages);

delete from public.messages;
delete from public.conversation_members;
delete from public.conversations;


-- ----------------------------------------------------------------------------
-- 3. Pipeline rows referencing fixture entities
-- ----------------------------------------------------------------------------
-- Currently zero rows in all three, but each holds an ON DELETE RESTRICT
-- reference to applications/clients. Omitting them would make this script fail
-- at cutover if any intake had arrived in the meantime.
delete from public.application_analysis
where application_id in (select id from _cutover_applications);

delete from public.automation_events
where application_id in (select id from _cutover_applications)
   or client_id in (select id from _cutover_clients);

delete from public.application_intakes
where created_application_id in (select id from _cutover_applications)
   or matched_client_id in (select id from _cutover_clients);


-- ----------------------------------------------------------------------------
-- 4. Evidence — before requirement slots (RESTRICT)
-- ----------------------------------------------------------------------------
-- dossier_documents.replaces_evidence_id is a SELF-referencing FK with ON
-- DELETE RESTRICT, so a replaced-evidence chain cannot be deleted in one
-- statement — the replacement must go before the row it replaced. Looping
-- deletes only currently-unreferenced rows until none remain.
--
-- Storage objects are NOT removed here. SQL cannot delete them; see README.md.
do $$
declare
  v_deleted int;
begin
  loop
    delete from public.dossier_documents d
    where d.requirement_slot_id in (
            select rs.id from public.requirement_slots rs
            where rs.application_id in (select id from _cutover_applications)
          )
      and not exists (
            select 1 from public.dossier_documents r
            where r.replaces_evidence_id = d.id
          );
    get diagnostics v_deleted = row_count;
    exit when v_deleted = 0;
  end loop;
end $$;

-- Any remaining evidence not reachable through a fixture application's slots
-- (e.g. rows whose slot was already removed during development).
delete from public.dossier_documents
where requirement_slot_id is null;


-- ----------------------------------------------------------------------------
-- 5. Requirement slots — before applications (RESTRICT)
-- ----------------------------------------------------------------------------
delete from public.requirement_slots
where application_id in (select id from _cutover_applications);


-- ----------------------------------------------------------------------------
-- 6. Dossier collaboration — before clients (RESTRICT)
-- ----------------------------------------------------------------------------
delete from public.dossier_notes
where client_id in (select id from _cutover_clients);

delete from public.dossier_alerts
where client_id in (select id from _cutover_clients);


-- ----------------------------------------------------------------------------
-- 7. Applications — before clients (RESTRICT)
-- ----------------------------------------------------------------------------
delete from public.applications
where id in (select id from _cutover_applications);


-- ----------------------------------------------------------------------------
-- 8. Clients
-- ----------------------------------------------------------------------------
-- crm_events.client_id / .application_id are ON DELETE SET NULL, so audit rows
-- are NOT deleted by this — they survive with those references cleared. Since
-- every pre-cutover event can only describe a fixture, this loses nothing real.
delete from public.clients
where id in (select id from _cutover_clients);


-- ----------------------------------------------------------------------------
-- 9. Application number sequence — CHOOSE ONE AT CUTOVER
-- ----------------------------------------------------------------------------
-- Safe to reset: the table is empty at this point, so no collision is
-- possible. Left commented out because it is a business decision, not a
-- technical one. See README.md.
--
--   Option A (recommended) — ODL's first real application is ODL-2026-000001:
-- alter sequence public.applications_number_seq restart with 1;
--
--   Option B — continue from the development numbering (next is …000019):
-- (do nothing; leave the sequence untouched)


-- ----------------------------------------------------------------------------
-- 10. Verification report
-- ----------------------------------------------------------------------------
do $$
begin
  raise notice 'AFTER — clients=%, applications=%, slots=%, documents=%, notes=%, alerts=%, conversations=%, messages=%, translations=%, intakes=%, automation=%, analysis=%',
    (select count(*) from public.clients),
    (select count(*) from public.applications),
    (select count(*) from public.requirement_slots),
    (select count(*) from public.dossier_documents),
    (select count(*) from public.dossier_notes),
    (select count(*) from public.dossier_alerts),
    (select count(*) from public.conversations),
    (select count(*) from public.messages),
    (select count(*) from public.message_translations),
    (select count(*) from public.application_intakes),
    (select count(*) from public.automation_events),
    (select count(*) from public.application_analysis);

  raise notice 'RETAINED (by design) — profiles=%, products=%, requirement_templates=%, crm_events=%',
    (select count(*) from public.profiles),
    (select count(*) from public.products),
    (select count(*) from public.requirement_templates),
    (select count(*) from public.crm_events);

  raise notice 'STILL TO DO OUT-OF-BAND: delete Storage objects under bucket dossier-documents (prefixes cl-001/ and applications/ea7cba21-…), configure real products/templates, and decide the sequence option above.';
end $$;

commit;
