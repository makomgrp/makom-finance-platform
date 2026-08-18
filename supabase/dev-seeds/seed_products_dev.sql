-- ============================================================================
-- DEVELOPMENT-ONLY seed data for the Product Engine (Milestone 9A)
-- ============================================================================
--
-- Fixture data for local/dev verification of the Products admin surface
-- (list, create, edit, activate/deactivate, reorder) — NOT part of the
-- application's real data model and MUST be deleted before production
-- delivery. Do not build any logic that assumes this data exists.
--
-- Six example products, matching the Milestone 9 architecture review's own
-- example list. Five are seeded active (with status_changed_at/by set, as
-- if an administrator had already launched them); one (credit_line) is
-- seeded draft (status_changed_at/by left null), to demonstrate the
-- lifecycle's initial state in the admin UI.
--
-- status_changed_by_profile_id for the five active rows resolves the
-- existing demo "u-001" identifier (Gabriel) via profiles.legacy_id — same
-- one-time boundary lookup used by every prior dev seed in this schema.
--
-- Removal before production:
--   delete from public.products
--   where code in (
--     'personal_loan', 'commercial_loan', 'mortgage',
--     'vehicle_loan', 'payroll_loan', 'credit_line'
--   );
--
-- Wrapped in a single transaction with a preflight check, so a missing
-- prerequisite profile aborts the whole seed instead of leaving partial
-- data behind — same pattern as every prior dev seed in this schema.

begin;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.profiles where legacy_id = 'u-001';
  if v_count <> 1 then
    raise exception 'Products dev seed aborted: expected exactly 1 profile with legacy_id = ''u-001'' (Gabriel), found %', v_count;
  end if;
end $$;

insert into public.products (
  code, name, short_description, status, display_order,
  status_changed_at, status_changed_by_profile_id
)
select
  'personal_loan',
  '{"es": "Préstamo Personal", "en": "Personal Loan"}'::jsonb,
  '{"es": "Financiamiento de libre destino para personas naturales.", "en": "General-purpose financing for individual applicants."}'::jsonb,
  'active', 10,
  timestamptz '2026-08-09T12:00:00Z', gabriel.id
from public.profiles gabriel
where gabriel.legacy_id = 'u-001'
on conflict (code) do nothing;

insert into public.products (
  code, name, short_description, status, display_order,
  status_changed_at, status_changed_by_profile_id
)
select
  'commercial_loan',
  '{"es": "Préstamo Comercial", "en": "Commercial Loan"}'::jsonb,
  '{"es": "Financiamiento para pequeñas y medianas empresas.", "en": "Financing for small and medium-sized businesses."}'::jsonb,
  'active', 20,
  timestamptz '2026-08-09T12:00:00Z', gabriel.id
from public.profiles gabriel
where gabriel.legacy_id = 'u-001'
on conflict (code) do nothing;

insert into public.products (
  code, name, short_description, status, display_order,
  status_changed_at, status_changed_by_profile_id
)
select
  'mortgage',
  '{"es": "Hipoteca", "en": "Mortgage"}'::jsonb,
  '{"es": "Financiamiento para la compra de vivienda.", "en": "Financing for home purchases."}'::jsonb,
  'active', 30,
  timestamptz '2026-08-09T12:00:00Z', gabriel.id
from public.profiles gabriel
where gabriel.legacy_id = 'u-001'
on conflict (code) do nothing;

insert into public.products (
  code, name, short_description, status, display_order,
  status_changed_at, status_changed_by_profile_id
)
select
  'vehicle_loan',
  '{"es": "Préstamo Vehicular", "en": "Vehicle Loan"}'::jsonb,
  '{"es": "Financiamiento para la compra de vehículos nuevos o usados.", "en": "Financing for new or used vehicle purchases."}'::jsonb,
  'active', 40,
  timestamptz '2026-08-09T12:00:00Z', gabriel.id
from public.profiles gabriel
where gabriel.legacy_id = 'u-001'
on conflict (code) do nothing;

insert into public.products (
  code, name, short_description, status, display_order,
  status_changed_at, status_changed_by_profile_id
)
select
  'payroll_loan',
  '{"es": "Préstamo con Descuento Directo", "en": "Payroll Loan"}'::jsonb,
  '{"es": "Préstamo con descuento directo de planilla para empleados de empresas afiliadas.", "en": "Payroll-deduction loan for employees of affiliated companies."}'::jsonb,
  'active', 50,
  timestamptz '2026-08-09T12:00:00Z', gabriel.id
from public.profiles gabriel
where gabriel.legacy_id = 'u-001'
on conflict (code) do nothing;

-- credit_line: seeded in draft — still being configured, not yet launched.
-- status_changed_at / status_changed_by_profile_id stay null, matching a
-- product that has never transitioned since creation.
insert into public.products (
  code, name, short_description, status, display_order
)
values (
  'credit_line',
  '{"es": "Línea de Crédito", "en": "Credit Line"}'::jsonb,
  '{"es": "Línea de crédito rotativa para necesidades de liquidez.", "en": "Revolving credit line for liquidity needs."}'::jsonb,
  'draft', 60
)
on conflict (code) do nothing;

commit;
