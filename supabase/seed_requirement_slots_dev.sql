-- ============================================================================
-- DEVELOPMENT-ONLY seed data for the Requirement Slot Engine (Milestone 10B)
-- ============================================================================
--
-- Fixture data for local/dev verification of the snapshot mechanism — NOT
-- part of the application's real data model and MUST be deleted before
-- production delivery. Do not build any logic that assumes this data
-- exists.
--
-- Snapshots slots for the existing demo application "ap-001" (client
-- "cl-001", the same client/application pairing used throughout every
-- prior milestone's dev seed) from Personal Loan's currently ACTIVE
-- requirement templates only — mirroring exactly what the real
-- createRequirementSlotsForApplication service function would produce.
--
-- Deliberately written as an INSERT ... SELECT against the live
-- requirement_templates rows (filtered to product code = 'personal_loan'
-- and status = 'active'), rather than hardcoded values, so this seed
-- naturally demonstrates and stays honest to the actual snapshot rule:
-- only active templates produce slots. Personal Loan currently has 5
-- templates but only 4 are active (phone_verification is seeded draft in
-- the Milestone 10A seed) — so this produces exactly 4 slots, not 5,
-- which is itself a live demonstration of the rule working correctly.
--
-- All 4 resulting slots start at status = 'pending' (the column default)
-- with status_changed_at / status_changed_by_profile_id / status_changed_
-- source all null, matching a freshly-snapshotted slot that has never
-- transitioned — no seed row here simulates any execution-state activity;
-- that is the future Execution UI's job, not this seed's.
--
-- Removal before production:
--   delete from public.requirement_slots
--   where application_legacy_id = 'ap-001';
--
-- Wrapped in a single transaction with a preflight check, so a missing
-- prerequisite product or active template aborts the whole seed instead
-- of leaving partial data behind — same pattern as every prior dev seed
-- in this schema.

begin;

do $$
declare
  v_count int;
begin
  select count(*) into v_count
  from public.requirement_templates rt
  join public.products p on p.id = rt.product_id
  where p.code = 'personal_loan' and rt.status = 'active';

  if v_count = 0 then
    raise exception 'Requirement slots dev seed aborted: expected at least 1 active requirement template for product ''personal_loan'', found 0. Have the Milestone 9A products seed and Milestone 10A requirement templates seed been applied?';
  end if;
end $$;

insert into public.requirement_slots (
  application_legacy_id, requirement_template_id, code, name, description,
  requirement_kind, required, display_order
)
select
  'ap-001',
  rt.id,
  rt.code,
  rt.name,
  rt.description,
  rt.requirement_kind,
  rt.required,
  rt.display_order
from public.requirement_templates rt
join public.products p on p.id = rt.product_id
where p.code = 'personal_loan' and rt.status = 'active'
on conflict (application_legacy_id, requirement_template_id) do nothing;

commit;
