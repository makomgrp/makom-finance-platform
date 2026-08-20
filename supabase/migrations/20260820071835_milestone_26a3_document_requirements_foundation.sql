-- ============================================================================
-- MILESTONE 26A-3 — STEP 3 DOCUMENT REQUIREMENTS FOUNDATION
-- ============================================================================
--
-- Extends the EXISTING requirement architecture. No second document system is
-- created: requirement_templates stay the per-product catalogue,
-- requirement_slots stay the per-application snapshot, dossier_documents stay
-- the 1:N evidence with replaces_evidence_id versioning. Everything below is
-- additive configuration on top of that, plus the approved requirement set for
-- the four official products.
--
-- WHAT THIS MILESTONE DOES NOT DO: no portal, no upload UI, no declaration
-- persistence, no resume tokens, no document generation, no workflow engine.
-- Stage and condition below are CLASSIFICATION, not execution.
-- ============================================================================


-- ============================================================================
-- 1. NEW CONFIGURATION ON TEMPLATES AND SLOTS
-- ============================================================================
--
-- Both tables get the same columns because requirement_slots is a SNAPSHOT:
-- what a product requires today must not silently rewrite what an application
-- was asked for last March. Every field the template carries, the slot must be
-- able to freeze.
--
-- WHY THESE ARE SEPARATE FROM requirement_kind. requirement_kind already says
-- WHAT SORT OF THING satisfies a requirement (a document, a signature, an
-- internal approval). It is deliberately not overloaded to also carry who
-- supplies it, when in the lifecycle it applies, whether the applicant may see
-- it, or how many files count as done — four independent questions that would
-- otherwise collide in one column and produce values like
-- "document_client_application_visible".
do $$
declare
  t text;
begin
  foreach t in array array['requirement_templates', 'requirement_slots'] loop
    execute format('alter table public.%I add column if not exists min_files integer', t);
    execute format('alter table public.%I add column if not exists allows_multiple_files boolean not null default false', t);
    execute format('alter table public.%I add column if not exists stage text not null default ''application''', t);
    execute format('alter table public.%I add column if not exists actor text not null default ''client''', t);
    execute format('alter table public.%I add column if not exists condition_key text', t);
    execute format('alter table public.%I add column if not exists applicant_visible boolean not null default false', t);
    execute format('alter table public.%I add column if not exists original_required_later boolean not null default false', t);
    execute format('alter table public.%I add column if not exists subject_type text not null default ''application''', t);

    -- min_files NULL means "file count is not how this completes" — an internal
    -- approval or a phone verification has no files to count. It is NOT zero:
    -- zero would read as "needs no files" and silently mark such a slot done.
    execute format($f$alter table public.%I add constraint %I
      check (min_files is null or min_files >= 1)$f$, t, t || '_min_files_check');

    execute format($f$alter table public.%I add constraint %I
      check (stage in ('application','compliance','approval','signing','disbursement','servicing'))$f$,
      t, t || '_stage_check');

    -- WHO produces the evidence. 'external_third_party' is the employer signing
    -- a payroll-deduction authorization: not the client, not ODL staff, and not
    -- machine-generated — a real fourth case that would otherwise be mislabelled.
    execute format($f$alter table public.%I add constraint %I
      check (actor in ('client','guarantor','internal','generated','external_third_party'))$f$,
      t, t || '_actor_check');

    -- A CLOSED VOCABULARY, NOT AN EXPRESSION LANGUAGE. The database records
    -- WHICH question decides whether a requirement applies; the service answers
    -- it. Storing executable text here would put business logic in a column no
    -- test can reach and no reviewer can read.
    execute format($f$alter table public.%I add constraint %I
      check (condition_key is null or condition_key in (
        'has_guarantor','collateral_is_vehicle','collateral_is_property',
        'business_has_tcc','loan_purpose_requires_proforma',
        'bank_requires_specific_authorization'))$f$,
      t, t || '_condition_key_check');

    execute format($f$alter table public.%I add constraint %I
      check (subject_type in ('application','guarantor','collateral'))$f$,
      t, t || '_subject_type_check');
  end loop;
end $$;

comment on column public.requirement_templates.min_files is
  'MILESTONE 26A-3. How many files satisfy this requirement. 2 for pay slips; '
  '1 for a single document; 1 for bank statements because ONE CONSOLIDATED PDF '
  'is a valid answer — never 6 or 12, which would force the applicant to split '
  'a statement they were given whole. NULL means file count is not how this '
  'completes (an internal approval, a phone verification).';
comment on column public.requirement_templates.allows_multiple_files is
  'MILESTONE 26A-3. Whether more files than min_files are accepted. Pay slips: '
  'two are required and extra months are welcome. An identity document: one.';
comment on column public.requirement_templates.stage is
  'MILESTONE 26A-3. Where in the loan lifecycle this requirement belongs. '
  'CLASSIFICATION ONLY — 26A-3 builds no workflow engine. It exists so the '
  'public Step 3 can ask for application-stage items and nothing else.';
comment on column public.requirement_templates.actor is
  'MILESTONE 26A-3. Who supplies the evidence: the applicant, a guarantor, ODL '
  'staff, the system (generated), or an external third party such as the '
  'employer who signs a payroll-deduction authorization.';
comment on column public.requirement_templates.condition_key is
  'MILESTONE 26A-3. NULL means always required. Otherwise names the question '
  'that decides whether it applies. A closed vocabulary, never an expression: '
  'the service resolves the condition, the database only records which one.';
comment on column public.requirement_templates.applicant_visible is
  'MILESTONE 26A-3. Whether the public portal may show this. DEFAULTS TO '
  'FALSE so a requirement added later is invisible until somebody deliberately '
  'publishes it — a compliance or signing document must never reach an '
  'applicant because someone forgot a flag.';
comment on column public.requirement_templates.original_required_later is
  'MILESTONE 26A-3. A signed upload is enough to proceed, but the physical '
  'original must be produced later (the payroll-deduction authorization). '
  'Records the obligation; tracking receipt of the paper is not built here.';
comment on column public.requirement_templates.subject_type is
  'MILESTONE 26A-3. What this requirement is ABOUT: the application itself, a '
  'guarantor, or a specific collateral item. On a slot, the matching FK in '
  'section 2 names WHICH one.';


-- ============================================================================
-- 2. SUBJECT BINDING ON SLOTS — WHICH GUARANTOR, WHICH VEHICLE
-- ============================================================================
--
-- Real foreign keys, not polymorphic text ids, so the database itself
-- guarantees a slot cannot point at a guarantor that does not exist or one
-- belonging to another application's applicant.
--
-- The FKs live on SLOTS, never on templates: a template is a generic
-- per-product rule ("a guarantor needs an identity document"); only the
-- per-application instance knows there are two guarantors and which one this
-- slot is for.
--
-- CASCADE matches 26A-2: delete a guarantor and their document requirements go
-- with them. A requirement for a person no longer on the application is not a
-- requirement, it is a permanently incomplete row that would sit in every
-- progress calculation forever.
alter table public.requirement_slots
  add column if not exists application_guarantor_id uuid
    references public.application_guarantors(id) on delete cascade;

alter table public.requirement_slots
  add column if not exists application_collateral_id uuid
    references public.application_collateral(id) on delete cascade;

alter table public.requirement_slots
  add constraint requirement_slots_subject_binding_check
  check (
    (subject_type = 'application'
      and application_guarantor_id is null and application_collateral_id is null)
    or
    (subject_type = 'guarantor'
      and application_guarantor_id is not null and application_collateral_id is null)
    or
    (subject_type = 'collateral'
      and application_collateral_id is not null and application_guarantor_id is null)
  );

create index if not exists requirement_slots_guarantor_idx
  on public.requirement_slots (application_guarantor_id)
  where application_guarantor_id is not null;

create index if not exists requirement_slots_collateral_idx
  on public.requirement_slots (application_collateral_id)
  where application_collateral_id is not null;


-- ============================================================================
-- 3. UNIQUENESS HAD TO CHANGE — AND WHY THAT IS SAFE HERE
-- ============================================================================
--
-- requirement_slots carried UNIQUE (application_id, requirement_template_id):
-- one slot per template per application. That is exactly right for
-- application-level requirements and exactly WRONG the moment a requirement is
-- about a subject — an application with two guarantors needs two "guarantor
-- identity document" slots from the one template, and the old constraint made
-- that impossible.
--
-- Replaced by three partial unique indexes that keep the original guarantee
-- where it applied and extend it where it did not:
--
--   unbound    one slot per template per application   (unchanged behaviour)
--   guarantor  one slot per template PER GUARANTOR
--   collateral one slot per template PER COLLATERAL ITEM
--
-- SAFE TO DO NOW: requirement_slots currently holds zero rows, so no existing
-- data is reinterpreted. The application-level guarantee is not weakened — it
-- is the same columns, scoped to the rows it was always about.
--
-- CONSEQUENCE FOR THE SNAPSHOT SERVICE, HANDLED IN THIS MILESTONE:
-- createRequirementSlotsForApplication used PostgREST's
-- onConflict=(application_id,requirement_template_id), which needs a matching
-- non-partial unique index. That index is gone, so the service is changed to
-- insert only the templates an application does not already have — preserving
-- the idempotent, safe-to-retry behaviour its doc comment promises.
alter table public.requirement_slots
  drop constraint if exists requirement_slots_application_id_requirement_template_id_key;

create unique index if not exists requirement_slots_unbound_template_key
  on public.requirement_slots (application_id, requirement_template_id)
  where application_guarantor_id is null and application_collateral_id is null;

create unique index if not exists requirement_slots_guarantor_template_key
  on public.requirement_slots (application_id, requirement_template_id, application_guarantor_id)
  where application_guarantor_id is not null;

create unique index if not exists requirement_slots_collateral_template_key
  on public.requirement_slots (application_id, requirement_template_id, application_collateral_id)
  where application_collateral_id is not null;


-- ============================================================================
-- 4. THE APPROVED REQUIREMENT SET FOR THE FOUR OFFICIAL PRODUCTS
-- ============================================================================
--
-- Seeded as ACTIVE templates so they snapshot into new applications. Codes are
-- stable internal identifiers, unique per product; display names are bilingual
-- JSONB exactly as the existing schema requires.
--
-- ONLY WHAT ODL APPROVED. No document is invented: there is no loan agreement,
-- promissory note, UNSC check or disbursement proof here, because nothing in
-- this project establishes their names or contents. Section 6 records that gap
-- rather than filling it with plausible-sounding legal paperwork.
--
-- IDENTITY IS ALREADY IN HAND. applicant_id is seeded for every product because
-- the dossier must contain it, but it arrives with the initial website intake —
-- Step 3 shows it as "Documento recibido / Ver / Reemplazar" and never asks for
-- it a second time.
insert into public.requirement_templates
  (product_id, code, name, description, requirement_kind, required, display_order, status,
   min_files, allows_multiple_files, stage, actor, condition_key, applicant_visible,
   original_required_later, subject_type)
select p.id, v.code, v.name::jsonb, v.description::jsonb, v.requirement_kind, v.required,
       v.display_order, 'active', v.min_files, v.allows_multiple_files, v.stage, v.actor,
       v.condition_key, v.applicant_visible, v.original_required_later, v.subject_type
from public.products p
join (values
  -- ===================== N — PAYROLL DEDUCTION =====================
  ('payroll_deduction','applicant_id',
    '{"es":"Identificación","en":"Identification"}',
    '{"es":"Cédula o pasaporte del solicitante. Ya recibido en la solicitud inicial.","en":"Applicant ID or passport. Already received with the initial application."}',
    'document', true, 10, 1, false, 'application', 'client', null, true, false, 'application'),
  ('payroll_deduction','pay_slips',
    '{"es":"Comprobantes de pago","en":"Pay slips"}',
    '{"es":"Dos comprobantes de pago recientes. Puedes adjuntar más si lo deseas.","en":"Two recent pay slips. You may attach more if you wish."}',
    'document', true, 20, 2, true, 'application', 'client', null, true, false, 'application'),
  ('payroll_deduction','proof_of_address',
    '{"es":"Comprobante de domicilio","en":"Proof of address"}',
    '{"es":"Recibo de servicios u otro comprobante de domicilio.","en":"Utility bill or other proof of address."}',
    'document', true, 30, 1, false, 'application', 'client', null, true, false, 'application'),
  ('payroll_deduction','payroll_deduction_authorization',
    '{"es":"Autorización de descuento por nómina","en":"Payroll deduction authorization"}',
    '{"es":"Documento que tu empresa debe completar y firmar. Súbelo firmado; el original físico se solicitará más adelante.","en":"Document your employer must complete and sign. Upload it signed; the physical original will be requested later."}',
    'document', true, 40, 1, false, 'application', 'external_third_party', null, true, true, 'application'),
  ('payroll_deduction','guarantor_id',
    '{"es":"Identificación del garante","en":"Guarantor identification"}',
    '{"es":"Cédula o pasaporte del garante.","en":"Guarantor ID or passport."}',
    'document', true, 50, 1, false, 'application', 'guarantor', 'has_guarantor', true, false, 'guarantor'),
  ('payroll_deduction','guarantor_pay_slips',
    '{"es":"Comprobantes de pago del garante","en":"Guarantor pay slips"}',
    '{"es":"Dos comprobantes de pago recientes del garante.","en":"Two recent pay slips for the guarantor."}',
    'document', true, 60, 2, true, 'application', 'guarantor', 'has_guarantor', true, false, 'guarantor'),
  ('payroll_deduction','guarantor_proof_of_address',
    '{"es":"Comprobante de domicilio del garante","en":"Guarantor proof of address"}',
    '{"es":"Comprobante de domicilio del garante.","en":"Proof of address for the guarantor."}',
    'document', true, 70, 1, false, 'application', 'guarantor', 'has_guarantor', true, false, 'guarantor'),

  -- ===================== D — DIRECT DEBIT =====================
  ('bank_direct_debit','applicant_id',
    '{"es":"Identificación","en":"Identification"}',
    '{"es":"Cédula o pasaporte del solicitante. Ya recibido en la solicitud inicial.","en":"Applicant ID or passport. Already received with the initial application."}',
    'document', true, 10, 1, false, 'application', 'client', null, true, false, 'application'),
  ('bank_direct_debit','pay_slips',
    '{"es":"Comprobantes de pago","en":"Pay slips"}',
    '{"es":"Dos comprobantes de pago recientes. Puedes adjuntar más si lo deseas.","en":"Two recent pay slips. You may attach more if you wish."}',
    'document', true, 20, 2, true, 'application', 'client', null, true, false, 'application'),
  ('bank_direct_debit','bank_statements',
    '{"es":"Estados de cuenta (últimos 6 meses)","en":"Bank statements (last 6 months)"}',
    '{"es":"Puedes subir un solo PDF consolidado o varios archivos.","en":"You may upload a single consolidated PDF or several files."}',
    'document', true, 30, 1, true, 'application', 'client', null, true, false, 'application'),
  ('bank_direct_debit','proof_of_address',
    '{"es":"Comprobante de domicilio","en":"Proof of address"}',
    '{"es":"Recibo de servicios u otro comprobante de domicilio.","en":"Utility bill or other proof of address."}',
    'document', true, 40, 1, false, 'application', 'client', null, true, false, 'application'),
  ('bank_direct_debit','direct_debit_authorization',
    '{"es":"Autorización de débito directo / orden permanente","en":"Direct debit / standing order authorization"}',
    '{"es":"Autorización para el débito directo en tu cuenta bancaria.","en":"Authorization for direct debit from your bank account."}',
    'document', true, 50, 1, false, 'application', 'client', null, true, false, 'application'),
  ('bank_direct_debit','guarantor_id',
    '{"es":"Identificación del garante","en":"Guarantor identification"}',
    '{"es":"Cédula o pasaporte del garante.","en":"Guarantor ID or passport."}',
    'document', true, 60, 1, false, 'application', 'guarantor', 'has_guarantor', true, false, 'guarantor'),
  ('bank_direct_debit','guarantor_pay_slips',
    '{"es":"Comprobantes de pago del garante","en":"Guarantor pay slips"}',
    '{"es":"Dos comprobantes de pago recientes del garante.","en":"Two recent pay slips for the guarantor."}',
    'document', true, 70, 2, true, 'application', 'guarantor', 'has_guarantor', true, false, 'guarantor'),
  ('bank_direct_debit','guarantor_proof_of_address',
    '{"es":"Comprobante de domicilio del garante","en":"Guarantor proof of address"}',
    '{"es":"Comprobante de domicilio del garante.","en":"Proof of address for the guarantor."}',
    'document', true, 80, 1, false, 'application', 'guarantor', 'has_guarantor', true, false, 'guarantor'),

  -- ===================== V — VEHICLE TITLE SECURED =====================
  ('vehicle_title_secured','applicant_id',
    '{"es":"Identificación","en":"Identification"}',
    '{"es":"Cédula o pasaporte del solicitante. Ya recibido en la solicitud inicial.","en":"Applicant ID or passport. Already received with the initial application."}',
    'document', true, 10, 1, false, 'application', 'client', null, true, false, 'application'),
  ('vehicle_title_secured','proof_of_income',
    '{"es":"Comprobantes de ingresos","en":"Proof of income"}',
    '{"es":"Dos comprobantes de ingresos. Puedes adjuntar más si lo deseas.","en":"Two proofs of income. You may attach more if you wish."}',
    'document', true, 20, 2, true, 'application', 'client', null, true, false, 'application'),
  ('vehicle_title_secured','proof_of_address',
    '{"es":"Comprobante de domicilio","en":"Proof of address"}',
    '{"es":"Recibo de servicios u otro comprobante de domicilio.","en":"Utility bill or other proof of address."}',
    'document', true, 30, 1, false, 'application', 'client', null, true, false, 'application'),
  ('vehicle_title_secured','vehicle_title',
    '{"es":"Título del vehículo","en":"Vehicle title"}',
    '{"es":"Título de propiedad del vehículo.","en":"Vehicle title document."}',
    'document', true, 40, 1, false, 'application', 'client', 'collateral_is_vehicle', true, false, 'collateral'),
  ('vehicle_title_secured','vehicle_registration',
    '{"es":"Matrícula del vehículo","en":"Vehicle registration"}',
    '{"es":"Registro o matrícula vigente del vehículo.","en":"Current vehicle registration."}',
    'document', true, 50, 1, false, 'application', 'client', 'collateral_is_vehicle', true, false, 'collateral'),
  ('vehicle_title_secured','vehicle_inspection',
    '{"es":"Revisado / inspección vehicular","en":"Vehicle inspection"}',
    '{"es":"Certificado de inspección vehicular vigente.","en":"Current vehicle fitness / inspection certificate."}',
    'document', true, 60, 1, false, 'application', 'client', 'collateral_is_vehicle', true, false, 'collateral'),
  ('vehicle_title_secured','vehicle_insurance',
    '{"es":"Seguro del vehículo","en":"Vehicle insurance"}',
    '{"es":"Póliza de seguro vigente del vehículo.","en":"Current vehicle insurance policy."}',
    'document', true, 70, 1, false, 'application', 'client', 'collateral_is_vehicle', true, false, 'collateral'),
  ('vehicle_title_secured','guarantor_id',
    '{"es":"Identificación del garante","en":"Guarantor identification"}',
    '{"es":"Cédula o pasaporte del garante.","en":"Guarantor ID or passport."}',
    'document', true, 80, 1, false, 'application', 'guarantor', 'has_guarantor', true, false, 'guarantor'),
  ('vehicle_title_secured','guarantor_proof_of_income',
    '{"es":"Comprobantes de ingresos del garante","en":"Guarantor proof of income"}',
    '{"es":"Dos comprobantes de ingresos del garante.","en":"Two proofs of income for the guarantor."}',
    'document', true, 90, 2, true, 'application', 'guarantor', 'has_guarantor', true, false, 'guarantor'),
  ('vehicle_title_secured','guarantor_proof_of_address',
    '{"es":"Comprobante de domicilio del garante","en":"Guarantor proof of address"}',
    '{"es":"Comprobante de domicilio del garante.","en":"Proof of address for the guarantor."}',
    'document', true, 100, 1, false, 'application', 'guarantor', 'has_guarantor', true, false, 'guarantor'),

  -- ===================== E — BUSINESS LOAN =====================
  ('business_loan','applicant_id',
    '{"es":"Identificación","en":"Identification"}',
    '{"es":"Cédula o pasaporte del solicitante. Ya recibido en la solicitud inicial.","en":"Applicant ID or passport. Already received with the initial application."}',
    'document', true, 10, 1, false, 'application', 'client', null, true, false, 'application'),
  ('business_loan','business_registration',
    '{"es":"Registro de la empresa","en":"Business registration"}',
    '{"es":"Documento de registro mercantil de la empresa.","en":"Company commercial registration document."}',
    'document', true, 20, 1, false, 'application', 'client', null, true, false, 'application'),
  ('business_loan','good_standing',
    '{"es":"Certificado de Good Standing","en":"Good Standing certificate"}',
    '{"es":"Certificado vigente de Good Standing de la empresa.","en":"Current company Good Standing certificate."}',
    'document', true, 30, 1, false, 'application', 'client', null, true, false, 'application'),
  ('business_loan','tcc',
    '{"es":"Certificado TCC","en":"TCC certificate"}',
    '{"es":"Certificado TCC, si aplica a tu empresa.","en":"TCC certificate, if applicable to your business."}',
    'document', true, 40, 1, false, 'application', 'client', 'business_has_tcc', true, false, 'application'),
  ('business_loan','bank_statements',
    '{"es":"Estados de cuenta (últimos 12 meses)","en":"Bank statements (last 12 months)"}',
    '{"es":"Puedes subir un solo PDF consolidado o varios archivos.","en":"You may upload a single consolidated PDF or several files."}',
    'document', true, 50, 1, true, 'application', 'client', null, true, false, 'application'),
  ('business_loan','cash_flow',
    '{"es":"Flujo de caja (últimos 12 meses)","en":"Cash flow (last 12 months)"}',
    '{"es":"Flujo de caja de los últimos 12 meses.","en":"Cash flow for the last 12 months."}',
    'document', true, 60, 1, true, 'application', 'client', null, true, false, 'application'),
  -- required = FALSE, deliberately. ODL has not confirmed whether audited
  -- statements are mandatory for every business applicant. Optional cannot
  -- falsely block a submission; mandatory could. Flagged for confirmation.
  ('business_loan','financial_statements',
    '{"es":"Estados financieros (últimos 2 años)","en":"Financial statements (last 2 years)"}',
    '{"es":"Estados financieros de los últimos dos años, si están disponibles.","en":"Financial statements for the last two years, if available."}',
    'document', false, 70, 1, true, 'application', 'client', null, true, false, 'application'),
  ('business_loan','proformas',
    '{"es":"Proformas o cotizaciones","en":"Proformas or quotations"}',
    '{"es":"Proformas o cotizaciones relacionadas con el destino del préstamo.","en":"Proformas or quotations related to the loan purpose."}',
    'document', true, 80, 1, true, 'application', 'client', 'loan_purpose_requires_proforma', true, false, 'application'),
  ('business_loan','vehicle_title',
    '{"es":"Título del vehículo en garantía","en":"Collateral vehicle title"}',
    '{"es":"Título de propiedad del vehículo ofrecido en garantía.","en":"Title of the vehicle offered as collateral."}',
    'document', true, 90, 1, false, 'application', 'client', 'collateral_is_vehicle', true, false, 'collateral'),
  ('business_loan','vehicle_registration',
    '{"es":"Matrícula del vehículo en garantía","en":"Collateral vehicle registration"}',
    '{"es":"Registro o matrícula vigente del vehículo en garantía.","en":"Current registration of the collateral vehicle."}',
    'document', true, 100, 1, false, 'application', 'client', 'collateral_is_vehicle', true, false, 'collateral'),
  ('business_loan','vehicle_inspection',
    '{"es":"Revisado del vehículo en garantía","en":"Collateral vehicle inspection"}',
    '{"es":"Certificado de inspección del vehículo en garantía.","en":"Inspection certificate for the collateral vehicle."}',
    'document', true, 110, 1, false, 'application', 'client', 'collateral_is_vehicle', true, false, 'collateral'),
  ('business_loan','vehicle_insurance',
    '{"es":"Seguro del vehículo en garantía","en":"Collateral vehicle insurance"}',
    '{"es":"Póliza vigente del vehículo en garantía.","en":"Current policy for the collateral vehicle."}',
    'document', true, 120, 1, false, 'application', 'client', 'collateral_is_vehicle', true, false, 'collateral')
) as v(product_code, code, name, description, requirement_kind, required, display_order,
       min_files, allows_multiple_files, stage, actor, condition_key, applicant_visible,
       original_required_later, subject_type)
  on p.code = v.product_code
on conflict (product_id, code) do nothing;


-- ============================================================================
-- 5. NOTE ON PROPERTY COLLATERAL — A DELIBERATE GAP
-- ============================================================================
-- Product E may be secured by a property, and 26A-2 can persist that. NO
-- property document requirements are seeded here: nothing in this project
-- establishes what ODL asks for (title? public-registry certificate? tax
-- clearance? appraisal?), and inventing a list would put fabricated legal
-- paperwork in front of real applicants. Recorded as an open business question.
--
-- The condition key 'collateral_is_property' exists so the set can be added
-- later as pure configuration, with no schema change.


-- ============================================================================
-- 6. NOTE ON LATER-STAGE AND GENERATED DOCUMENTS — ALSO DELIBERATE
-- ============================================================================
-- The stage vocabulary supports compliance / approval / signing / disbursement,
-- and `actor` supports 'internal' and 'generated'. NONE are seeded.
--
-- The only later-stage document names available in this project are a retired
-- six-value legacy list (cedula_pasaporte, carta_trabajo, ficha_css,
-- comprobante_pago, recibo_servicios, confirmacion_descuento) — all
-- application-stage client documents already covered above. Nothing here
-- establishes the name, content or legal form of a loan agreement, promissory
-- note, UNSC check, solvency certificate or disbursement proof.
--
-- So they are not invented. The model can hold them the day ODL provides the
-- real list; until then their absence is honest and their presence would not be.


-- ============================================================================
-- 7. NOTE ON DECLARATIONS — OUT OF SCOPE BY DESIGN
-- ============================================================================
-- PEP, source of funds and credit consent are structured ANSWERS, not file
-- uploads. Modelling them as document requirements would force an applicant to
-- upload a PDF to answer a yes/no question, and would put compliance data in a
-- storage bucket instead of a queryable column. They get their own milestone;
-- nothing is stubbed here.


-- ============================================================================
-- 8. NOTE ON BANK-SPECIFIC AUTHORIZATION TEMPLATES
-- ============================================================================
-- The condition key 'bank_requires_specific_authorization' exists because
-- certain banks may require their own direct-debit form. No bank-specific
-- template is seeded: no such template, form or bank list exists anywhere in
-- this project's data or code, and naming banks from memory would be
-- fabrication. Configuration-only once ODL supplies the forms.
