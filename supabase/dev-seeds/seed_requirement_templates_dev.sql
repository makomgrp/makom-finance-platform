-- ============================================================================
-- DEVELOPMENT-ONLY seed data for the Requirement Engine (Milestone 10A)
-- ============================================================================
--
-- Fixture data for local/dev verification of the Requirement Templates
-- admin surface (list, create, edit, activate/deactivate, reorder) — NOT
-- part of the application's real data model and MUST be deleted before
-- production delivery. Do not build any logic that assumes this data
-- exists.
--
-- A small, realistic set against two of the products seeded in Milestone
-- 9A: Personal Loan (5 requirements, mixing document and non-document
-- kinds) and Commercial Loan (3 requirements). Deliberately does not seed
-- every product — proves the model works without needing exhaustive
-- coverage.
--
-- Each row's status_changed_by_profile_id (for the four active rows)
-- resolves the existing demo "u-001" identifier (Gabriel) via
-- profiles.legacy_id — same one-time boundary lookup used by every prior
-- dev seed in this schema. product_id is resolved per-row from
-- public.products by code, since this seed depends on the Milestone 9A
-- products seed having already been applied.
--
-- phone_verification is seeded in draft (status_changed_at/by left null)
-- and optional (required = false) — a newer, still-being-piloted
-- requirement, demonstrating both the lifecycle's initial state and the
-- required/optional toggle in the same seed.
--
-- Removal before production:
--   delete from public.requirement_templates
--   where code in (
--     'government_id', 'salary_letter', 'css_record', 'last_pay_stub',
--     'phone_verification', 'business_license', 'financial_statements',
--     'legal_representative_id'
--   );
--
-- Wrapped in a single transaction with a preflight check, so a missing
-- prerequisite profile or product aborts the whole seed instead of leaving
-- partial data behind — same pattern as every prior dev seed in this
-- schema.

begin;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.profiles where legacy_id = 'u-001';
  if v_count <> 1 then
    raise exception 'Requirement templates dev seed aborted: expected exactly 1 profile with legacy_id = ''u-001'' (Gabriel), found %', v_count;
  end if;

  select count(*) into v_count from public.products where code = 'personal_loan';
  if v_count <> 1 then
    raise exception 'Requirement templates dev seed aborted: expected exactly 1 product with code = ''personal_loan'', found %. Has the Milestone 9A products seed been applied?', v_count;
  end if;

  select count(*) into v_count from public.products where code = 'commercial_loan';
  if v_count <> 1 then
    raise exception 'Requirement templates dev seed aborted: expected exactly 1 product with code = ''commercial_loan'', found %. Has the Milestone 9A products seed been applied?', v_count;
  end if;
end $$;

-- ============================================================================
-- Personal Loan
-- ============================================================================

-- 1. government_id — document, required, active
insert into public.requirement_templates (
  product_id, code, name, description, requirement_kind, required, display_order,
  status, status_changed_at, status_changed_by_profile_id
)
select
  p.id,
  'government_id',
  '{"es": "Cédula o Pasaporte", "en": "Government ID"}'::jsonb,
  '{"es": "Documento de identificación vigente del solicitante.", "en": "The applicant''s current government-issued identification."}'::jsonb,
  'document', true, 10,
  'active', timestamptz '2026-08-09T14:00:00Z', gabriel.id
from public.products p, public.profiles gabriel
where p.code = 'personal_loan' and gabriel.legacy_id = 'u-001'
on conflict (product_id, code) do nothing;

-- 2. salary_letter — document, required, active
insert into public.requirement_templates (
  product_id, code, name, description, requirement_kind, required, display_order,
  status, status_changed_at, status_changed_by_profile_id
)
select
  p.id,
  'salary_letter',
  '{"es": "Carta de Trabajo", "en": "Salary Letter"}'::jsonb,
  '{"es": "Emitida por la empresa, con detalle de deducciones.", "en": "Issued by the employer, detailing deductions."}'::jsonb,
  'document', true, 20,
  'active', timestamptz '2026-08-09T14:00:00Z', gabriel.id
from public.products p, public.profiles gabriel
where p.code = 'personal_loan' and gabriel.legacy_id = 'u-001'
on conflict (product_id, code) do nothing;

-- 3. css_record — document, required, active
insert into public.requirement_templates (
  product_id, code, name, description, requirement_kind, required, display_order,
  status, status_changed_at, status_changed_by_profile_id
)
select
  p.id,
  'css_record',
  '{"es": "Ficha de la Caja de Seguro Social (CSS)", "en": "CSS Record"}'::jsonb,
  '{"es": "Comprobante de afiliación y cotizaciones.", "en": "Proof of affiliation and contributions."}'::jsonb,
  'document', true, 30,
  'active', timestamptz '2026-08-09T14:00:00Z', gabriel.id
from public.products p, public.profiles gabriel
where p.code = 'personal_loan' and gabriel.legacy_id = 'u-001'
on conflict (product_id, code) do nothing;

-- 4. last_pay_stub — document, required, active
insert into public.requirement_templates (
  product_id, code, name, description, requirement_kind, required, display_order,
  status, status_changed_at, status_changed_by_profile_id
)
select
  p.id,
  'last_pay_stub',
  '{"es": "Último Comprobante de Pago", "en": "Last Pay Stub"}'::jsonb,
  '{"es": "Talón o volante de pago más reciente.", "en": "Most recent pay stub or slip."}'::jsonb,
  'document', true, 40,
  'active', timestamptz '2026-08-09T14:00:00Z', gabriel.id
from public.products p, public.profiles gabriel
where p.code = 'personal_loan' and gabriel.legacy_id = 'u-001'
on conflict (product_id, code) do nothing;

-- 5. phone_verification — non-document kind, optional, draft (still being
-- piloted — status_changed_at/by stay null, matching a template that has
-- never transitioned since creation).
insert into public.requirement_templates (
  product_id, code, name, description, requirement_kind, required, display_order, status
)
select
  p.id,
  'phone_verification',
  '{"es": "Verificación Telefónica", "en": "Phone Verification"}'::jsonb,
  '{"es": "Llamada de confirmación de datos con el solicitante.", "en": "Confirmation call with the applicant."}'::jsonb,
  'phone_verification', false, 50, 'draft'
from public.products p
where p.code = 'personal_loan'
on conflict (product_id, code) do nothing;

-- ============================================================================
-- Commercial Loan
-- ============================================================================

-- 6. business_license — document, required, active
insert into public.requirement_templates (
  product_id, code, name, description, requirement_kind, required, display_order,
  status, status_changed_at, status_changed_by_profile_id
)
select
  p.id,
  'business_license',
  '{"es": "Aviso de Operación", "en": "Business License"}'::jsonb,
  '{"es": "Registro vigente que autoriza la operación del negocio.", "en": "Current registration authorizing the business to operate."}'::jsonb,
  'document', true, 10,
  'active', timestamptz '2026-08-09T14:00:00Z', gabriel.id
from public.products p, public.profiles gabriel
where p.code = 'commercial_loan' and gabriel.legacy_id = 'u-001'
on conflict (product_id, code) do nothing;

-- 7. financial_statements — document, required, active
insert into public.requirement_templates (
  product_id, code, name, description, requirement_kind, required, display_order,
  status, status_changed_at, status_changed_by_profile_id
)
select
  p.id,
  'financial_statements',
  '{"es": "Estados Financieros", "en": "Financial Statements"}'::jsonb,
  '{"es": "Estados financieros auditados o certificados del negocio.", "en": "Audited or certified financial statements for the business."}'::jsonb,
  'document', true, 20,
  'active', timestamptz '2026-08-09T14:00:00Z', gabriel.id
from public.products p, public.profiles gabriel
where p.code = 'commercial_loan' and gabriel.legacy_id = 'u-001'
on conflict (product_id, code) do nothing;

-- 8. legal_representative_id — document, required, active
insert into public.requirement_templates (
  product_id, code, name, description, requirement_kind, required, display_order,
  status, status_changed_at, status_changed_by_profile_id
)
select
  p.id,
  'legal_representative_id',
  '{"es": "Cédula del Representante Legal", "en": "Legal Representative ID"}'::jsonb,
  '{"es": "Documento de identificación vigente del representante legal.", "en": "Current government-issued identification for the legal representative."}'::jsonb,
  'document', true, 30,
  'active', timestamptz '2026-08-09T14:00:00Z', gabriel.id
from public.products p, public.profiles gabriel
where p.code = 'commercial_loan' and gabriel.legacy_id = 'u-001'
on conflict (product_id, code) do nothing;

commit;
