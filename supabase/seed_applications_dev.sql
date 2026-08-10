-- ============================================================================
-- DEVELOPMENT-ONLY seed data for the Application Engine (Milestone 11)
-- ============================================================================
--
-- Fixture data for local/dev verification — NOT part of the application's
-- real data model and MUST be deleted before production delivery. Do not
-- build any logic that assumes this data exists.
--
-- Purpose: this is steps 2 and 3 of the requirement_slots.
-- application_legacy_id -> application_id evolution (see
-- 20260809150100_add_application_id_to_requirement_slots.sql's header
-- comment for the full 3-step plan). The only existing requirement_slots
-- rows in dev reference application_legacy_id = 'ap-001' (from the
-- Milestone 10B seed) — this creates the one real Application row that
-- legacy id actually corresponds to, then maps every matching
-- requirement_slots row onto it by setting application_id.
--
-- Deliberately does NOT attempt to mirror all 14 rows of the existing
-- demo LoanApplication array (src/lib/demo-data/applications.ts) into
-- this table. Per the Milestone 11 architecture instructions: "Do NOT
-- silently invent production records" and "preserve enough dev data so
-- existing dossier/application views can continue to work." Since
-- Solicitudes and the Dossier view are NOT migrated to the real
-- applications table in this milestone (see the implementation report's
-- UI Scope section) — they still read src/lib/demo-data/applications.ts
-- untouched — there is nothing for a wider seed to preserve. Inventing 13
-- more real Application rows with no corresponding requirement_slots,
-- product mapping, or consuming UI would be exactly the kind of
-- unjustified, silently-invented data this instruction warns against.
-- Only the one row an existing real table (requirement_slots) actually
-- depends on is created.
--
-- Field mapping from demo ap-001 (src/lib/demo-data/applications.ts) to
-- the real applications table, and where the two deliberately diverge:
--   - legacy_id: 'ap-001' itself — the authoritative bridge key (see
--     20260809150200_add_legacy_id_to_applications.sql). This is what
--     makes this seed idempotent and safe to re-run: see "Bridge lookup
--     logic" below.
--   - client_legacy_id: 'cl-001', copied directly from demo clientId.
--   - product_id: resolved from product code 'personal_loan' — not a
--     free choice. The existing requirement_slots rows for 'ap-001' were
--     already snapshotted from Personal Loan's active requirement
--     templates in the Milestone 10B seed, so the real Application must
--     reference the same product or the slot-to-application relationship
--     would be internally inconsistent. Demo ap-001's loanType
--     ('descuento_directo') has no clean mapping to any real Product code
--     — LoanType and Product are different, unreconciled vocabularies
--     (see the Milestone 11 architecture review's note on this); the real
--     seed follows what the Requirement Slot data actually requires, not
--     the demo loanType.
--   - requested_amount: 3500.00, copied directly from demo
--     amountRequested.
--   - requested_term_months: 24 — a synthesized placeholder. The demo
--     LoanApplication type has no term field at all (it predates the
--     Application Engine's requested-terms design), so there is nothing
--     to copy; 24 is a plausible value chosen only to satisfy the NOT
--     NULL constraint for local development, not a real fact about
--     "ap-001".
--   - status: 'in_review' — the closest real-lifecycle equivalent to
--     demo ap-001's 'en_evaluacion' (see the architecture review's
--     Lifecycle section: en_evaluacion maps directly, pendiente_
--     documentos / documentacion_completa do not exist in the real
--     lifecycle at all, by design).
--   - created_by_profile_id / status_changed_by_profile_id /
--     assigned_advisor_profile_id: all resolved from profiles.legacy_id
--     = 'u-004' (Fernando Quintero), matching demo ap-001's advisorId.
--     Using the same profile for all three roles is a dev-seed
--     simplification, not a modeled business rule.
--   - application_number: left to the column default (the
--     applications_number_seq-backed generator) rather than forced to
--     match demo's "ODL-2026-000101" — this seed exists to prove the
--     real generation mechanism works, not to replicate a demo string.
--
-- Bridge lookup logic (corrected from an earlier version of this seed
-- that inferred "already ran" purely from requirement_slots' own
-- application_id being null/non-null — a bridge-integrity review found
-- that heuristic unsafe: under a partially-backfilled state, e.g. one
-- ap-001 slot already pointing at a real application_id while another
-- was still null, that logic would have inserted a SECOND Application
-- row and split ap-001's slots across two different real UUIDs, silently
-- and without error):
--   1. applications.legacy_id = 'ap-001' is now the single authoritative
--      answer to "does a real Application already exist for this legacy
--      application." If found, that id is reused — no new Application
--      row is ever created in that case.
--   2. If not found, exactly one Application is created, with
--      legacy_id = 'ap-001' set explicitly, and its id is used for the
--      backfill.
--   3. Either way, only requirement_slots rows still missing
--      application_id are updated — already-correct rows are untouched.
--   4. Defensive integrity check, run before either path: if the
--      existing 'ap-001' requirement_slots rows already carry more than
--      one distinct non-null application_id, or carry a single one that
--      does not match applications.legacy_id = 'ap-001' (in either
--      direction — slots pointing somewhere applications.legacy_id
--      disagrees with, or applications.legacy_id resolving to an id the
--      slots don't already agree with), the whole seed aborts loudly
--      with an explicit exception rather than attempting to silently
--      repair or split the data further.
--
-- Removal before production:
--   delete from public.applications where legacy_id = 'ap-001';
--   (requirement_slots.application_id for the affected rows becomes
--   dangling only if requirement_slots' own dev rows are removed first,
--   per that migration's own removal note — remove requirement_slots'
--   dev rows before this, not after.)

begin;

do $$
declare
  v_product_id uuid;
  v_advisor_profile_id uuid;
  v_application_id uuid;
  v_total_ap001_slots int;
  v_distinct_existing_application_ids int;
  v_existing_slot_application_id uuid;
begin
  select id into v_product_id
  from public.products
  where code = 'personal_loan';

  if v_product_id is null then
    raise exception 'Applications dev seed aborted: product with code ''personal_loan'' not found. Has the Milestone 9A products seed been applied?';
  end if;

  select id into v_advisor_profile_id
  from public.profiles
  where legacy_id = 'u-004';

  if v_advisor_profile_id is null then
    raise exception 'Applications dev seed aborted: profile with legacy_id ''u-004'' not found. Has supabase/seed_profiles.sql been applied?';
  end if;

  select count(*) into v_total_ap001_slots
  from public.requirement_slots
  where application_legacy_id = 'ap-001';

  if v_total_ap001_slots = 0 then
    raise exception 'Applications dev seed aborted: no requirement_slots rows found for application_legacy_id = ''ap-001''. Has the Milestone 10B requirement slots seed been applied?';
  end if;

  -- Defensive integrity check (must run before either bridge-lookup
  -- branch below): how many DISTINCT non-null application_id values do
  -- the existing 'ap-001' slots already carry? More than one means the
  -- slots are already split across two real Applications — abort rather
  -- than guess which is correct.
  select count(distinct application_id) into v_distinct_existing_application_ids
  from public.requirement_slots
  where application_legacy_id = 'ap-001' and application_id is not null;

  if v_distinct_existing_application_ids > 1 then
    raise exception 'Applications dev seed aborted: requirement_slots rows for application_legacy_id = ''ap-001'' already reference % different application_id values — this legacy application''s slots are already split across multiple real Applications. Resolve manually before re-running this seed; refusing to guess which one is correct.', v_distinct_existing_application_ids;
  end if;

  -- Authoritative bridge lookup: does a real Application already exist
  -- for legacy_id = 'ap-001'?
  select id into v_application_id
  from public.applications
  where legacy_id = 'ap-001';

  if v_application_id is not null then
    -- Found — reuse it, never insert a second Application for the same
    -- legacy id. Cross-check against any already-set slot application_id
    -- (guaranteed single-valued by the check above): the two bridges
    -- must agree, or something has diverged and this must not proceed.
    if v_distinct_existing_application_ids = 1 then
      select application_id into v_existing_slot_application_id
      from public.requirement_slots
      where application_legacy_id = 'ap-001' and application_id is not null
      limit 1;

      if v_existing_slot_application_id <> v_application_id then
        raise exception 'Applications dev seed aborted: requirement_slots rows for application_legacy_id = ''ap-001'' already reference application_id = %, which does not match applications.legacy_id = ''ap-001'' (application_id = %). The two bridges have diverged — resolve manually instead of silently repairing.', v_existing_slot_application_id, v_application_id;
      end if;
    end if;

    raise notice 'Applications dev seed: an Application with legacy_id = ''ap-001'' already exists (id = %) — reusing it, no new Application created.', v_application_id;
  else
    -- Not found. If slots already carry a single consistent
    -- application_id despite no applications row claiming legacy_id =
    -- 'ap-001', the bridges have diverged (e.g. legacy_id was cleared on
    -- an existing row) — abort rather than create a second, competing
    -- Application for data that may already have a real home.
    if v_distinct_existing_application_ids = 1 then
      raise exception 'Applications dev seed aborted: requirement_slots rows for application_legacy_id = ''ap-001'' already reference an existing application_id, but no applications row has legacy_id = ''ap-001''. The two bridges have diverged — resolve manually instead of creating a second Application.';
    end if;

    insert into public.applications (
      legacy_id, client_legacy_id, product_id, requested_amount, requested_term_months,
      created_by_profile_id, created_source,
      status, status_changed_at, status_changed_by_profile_id, status_changed_source,
      assigned_advisor_profile_id
    )
    values (
      'ap-001', 'cl-001', v_product_id, 3500.00, 24,
      v_advisor_profile_id, 'crm_manual',
      'in_review', now(), v_advisor_profile_id, 'crm_manual',
      v_advisor_profile_id
    )
    returning id into v_application_id;

    raise notice 'Applications dev seed: created new Application (id = %) with legacy_id = ''ap-001''.', v_application_id;
  end if;

  -- Backfill: every 'ap-001' slot still missing application_id gets set
  -- to the (found-or-created) application id. Already-correct rows
  -- (application_id already matching, per the integrity check above) are
  -- left untouched by the `application_id is null` guard.
  update public.requirement_slots
  set application_id = v_application_id
  where application_legacy_id = 'ap-001' and application_id is null;
end $$;

commit;
