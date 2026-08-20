-- ============================================================================
-- MILESTONE 26A-1 — OFFICIAL ODL LOAN CATALOG + APPLICATION NUMBER FOUNDATION
-- ============================================================================
--
-- Three things, in this order, because each depends on the one before it:
--
--   1. Retire the demo catalog. Six products seeded together on 2026-08-09 for
--      development, plus the three test applications and the requirement/
--      document rows hanging off them. None of it is ODL business data.
--   2. Establish the four OFFICIAL products, each carrying a permanent
--      single-letter application code (N/D/V/E).
--   3. Replace the application-number generator so every new formal
--      Application receives ODL-DDMMMYY-NNNN-X from one global sequence
--      starting at 1.
--
-- WHAT THIS MIGRATION DOES NOT DO. It creates no requirement template, no
-- loan criterion, no application, no client, no user, no branch. It does not
-- touch Storage, Auth, capabilities, branch semantics, chat, or the document
-- signed-URL chain. The four new products are catalog entries only — they
-- carry no requirements yet, which is 26A-2's work.
-- ============================================================================


-- ============================================================================
-- 1. RETIRING THE DEMO CATALOG
-- ============================================================================
--
-- Every foreign key into products and applications is ON DELETE RESTRICT (the
-- one exception, crm_events.application_id, is SET NULL and crm_events is
-- empty). Nothing cascades, so the order below is not a style choice — it is
-- the only order Postgres will accept:
--
--   dossier_documents -> requirement_slots -> applications
--                                          -> requirement_templates
--                                          -> products
--
-- SCOPED BY AN EXPLICIT CODE LIST, not by "delete everything". If this ever
-- runs against a database that already holds real ODL data, it can only reach
-- the six named demo products and what hangs off them. A blanket DELETE would
-- have been shorter and unrecoverable.
--
-- WHAT IS DELIBERATELY NOT DELETED:
--   * the 17 clients — they are the CRM's existing fixture dataset and are not
--     owned by these applications. Deleting them to simplify cleanup would
--     destroy notes, alerts and the dossier surface that 25B/25C were built
--     and verified against.
--   * dossier_notes / dossier_alerts — they belong to clients, not to
--     applications, and are untouched by this.
--   * storage.objects — the four evidence rows removed below each reference a
--     real object in the private dossier-documents bucket. Storage is
--     explicitly out of scope for this milestone, so those four objects are
--     LEFT IN PLACE and become unreferenced. That is disclosed rather than
--     silently cleaned: deleting storage is irreversible, and an orphaned
--     private object costs nothing.
--   * profiles, auth users, branches, capabilities, chat — never in scope.
do $$
declare
  v_demo_codes text[] := array[
    'personal_loan', 'commercial_loan', 'mortgage',
    'vehicle_loan', 'payroll_loan', 'credit_line'
  ];
  v_docs int; v_slots int; v_apps int; v_templates int; v_products int;
begin
  -- 1a. Evidence attached to slots of demo applications.
  delete from public.dossier_documents dd
  where dd.requirement_slot_id in (
    select rs.id
    from public.requirement_slots rs
    join public.applications a on a.id = rs.application_id
    join public.products p on p.id = a.product_id
    where p.code = any(v_demo_codes)
  );
  get diagnostics v_docs = row_count;

  -- 1b. Requirement slots of demo applications.
  delete from public.requirement_slots rs
  where rs.application_id in (
    select a.id from public.applications a
    join public.products p on p.id = a.product_id
    where p.code = any(v_demo_codes)
  );
  get diagnostics v_slots = row_count;

  -- 1c. The demo applications themselves. Their identifiers used the old
  -- ODL-YYYY-NNNNNN model; removing them is what makes the new format the
  -- only format present, with no conversion and no rewritten history.
  delete from public.applications a
  where a.product_id in (select id from public.products where code = any(v_demo_codes));
  get diagnostics v_apps = row_count;

  -- 1d. Requirement templates belonging to demo products. requirement_slots
  -- also references templates (RESTRICT), which is why slots go first.
  delete from public.requirement_templates rt
  where rt.product_id in (select id from public.products where code = any(v_demo_codes));
  get diagnostics v_templates = row_count;

  -- 1e. The demo products.
  delete from public.products p where p.code = any(v_demo_codes);
  get diagnostics v_products = row_count;

  raise notice '26A-1 demo cleanup: % documents, % slots, % applications, % templates, % products',
    v_docs, v_slots, v_apps, v_templates, v_products;
end $$;


-- ============================================================================
-- 2. products.application_code — THE PERMANENT PRODUCT SUFFIX
-- ============================================================================
--
-- The last character of an application number identifies the product, and an
-- application number is permanent. So the letter cannot come from anything a
-- person can edit casually:
--
--   NOT from name/short_description — translated, freely edited, and there are
--     two of them (ES/EN) with no reason to agree on a first letter.
--   NOT derived from products.code — that is a descriptive slug an
--     administrator holding `product:manage` may rename. Deriving the suffix
--     from it would mean a rename silently orphans every identifier already
--     issued.
--
-- So it is its own column: explicit, single-purpose, and validated in the
-- database rather than by whoever writes the INSERT.
--
-- NULLABLE ON PURPOSE. A product without a code simply cannot issue official
-- applications — the generator raises rather than inventing a letter. That
-- keeps a future draft product legal in the catalog while making it impossible
-- for it to produce a malformed identifier.
--
-- UNIQUE ONLY AMONG PRODUCTS THAT HAVE ONE. A partial unique index lets any
-- number of products carry NULL while guaranteeing no two share a letter —
-- which is what stops two products from both claiming 'N' and making the
-- suffix ambiguous forever.
alter table public.products
  add column if not exists application_code text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'products_application_code_format_check'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_application_code_format_check
      check (application_code is null or application_code ~ '^[A-Z]$');
  end if;
end $$;

create unique index if not exists products_application_code_unique
  on public.products (application_code)
  where application_code is not null;

comment on column public.products.application_code is
  'MILESTONE 26A-1. The permanent single uppercase letter this product '
  'contributes as the suffix of every application number it issues '
  '(N=Nomina, D=Debito Directo, V=Vehiculo, E=Empresarial). SYSTEM-CRITICAL '
  'CONFIGURATION: it is part of identifiers that are already printed on '
  'contracts and must never be repointed after applications exist. '
  'Deliberately NOT derived from code or name, both of which are editable. '
  'NULL means the product cannot issue official applications yet — '
  'generate_application_number() raises rather than guessing.';


-- ============================================================================
-- 3. THE FOUR OFFICIAL ODL PRODUCTS
-- ============================================================================
--
-- Created as NEW rows, not by renaming demo rows. The demo catalog was seeded
-- for development and two of its entries only resembled these (payroll_loan
-- was named "Descuento Directo", which reads almost identically to the
-- separate Debito Directo product; vehicle_loan financed the PURCHASE of a
-- vehicle, which is a different product from lending against a title already
-- owned). Renaming them would have carried that confusion, and their ids,
-- forward into ODL's real catalog.
--
-- status = 'active' so they are immediately part of the operational catalog.
-- NOTE, AND THIS IS EXPECTED: they carry no requirement templates yet, so
-- getApplicationCreatableProducts() — which requires at least one active
-- template — will not offer them for CRM origination until 26A-2 defines
-- requirements. The catalog is established here; what each product REQUIRES is
-- the next milestone.
insert into public.products (code, name, short_description, status, display_order, application_code)
values
  (
    'payroll_deduction',
    '{"es":"Préstamos con Descuento por Nómina","en":"Payroll Deduction Loan"}'::jsonb,
    '{"es":"Préstamo con descuento aplicado directamente sobre la planilla del empleado.","en":"Loan repaid through direct deduction from the employee payroll."}'::jsonb,
    'active', 10, 'N'
  ),
  (
    'bank_direct_debit',
    '{"es":"Débito Directo Bancario / Orden Permanente","en":"Bank Direct Debit / Standing Order Loan"}'::jsonb,
    '{"es":"Préstamo con pago mediante débito directo u orden permanente en cuenta bancaria.","en":"Loan repaid by bank direct debit or standing order."}'::jsonb,
    'active', 20, 'D'
  ),
  (
    'vehicle_title_secured',
    '{"es":"Préstamo con Garantía del Título del Vehículo","en":"Vehicle Title Secured Loan"}'::jsonb,
    '{"es":"Préstamo garantizado con el título de un vehículo propiedad del solicitante.","en":"Loan secured by the title of a vehicle owned by the applicant."}'::jsonb,
    'active', 30, 'V'
  ),
  (
    'business_loan',
    '{"es":"Préstamo Empresarial","en":"Business Loan"}'::jsonb,
    '{"es":"Financiamiento para empresas y actividades comerciales.","en":"Financing for businesses and commercial activities."}'::jsonb,
    'active', 40, 'E'
  )
on conflict (code) do nothing;


-- ============================================================================
-- 4. THE OFFICIAL APPLICATION NUMBER
-- ============================================================================
--
--   ODL-DDMMMYY-NNNN-X        e.g.  ODL-20AGO26-0001-N
--
-- ----------------------------------------------------------------------------
-- 4a. A NEW SEQUENCE, NOT THE OLD ONE
-- ----------------------------------------------------------------------------
-- applications_number_seq reached 25 through development inserts and
-- rolled-back verification transactions (sequences deliberately do not roll
-- back, which is exactly what makes them safe under concurrency). Restarting a
-- sequence that a live DEFAULT still points at is the kind of change that is
-- correct only until somebody inserts during the window. A separate sequence
-- has no such window: it starts at 1, it has never been consumed, and the old
-- one simply stops being read.
--
-- The old sequence is intentionally LEFT IN PLACE. It is owned by
-- applications.application_number, so it disappears if that column ever does;
-- dropping it now would be churn with a failure mode and no benefit.
create sequence if not exists public.applications_official_number_seq
  as bigint start with 1 increment by 1 no cycle;

comment on sequence public.applications_official_number_seq is
  'MILESTONE 26A-1. The ONE global counter behind every official ODL '
  'application number. Global across all products, never reset daily, never '
  'reset per product, never reset yearly. Separate from the retired '
  'applications_number_seq, which had already been consumed to 25 by '
  'development and could not credibly restart at 1.';

-- service_role is the only writer of applications (RLS is on with no policies
-- and every write goes through the server), so it needs USAGE to call
-- nextval() — the same grant applications_number_seq received in migration
-- 20260809150400.
grant usage, select on sequence public.applications_official_number_seq to service_role;


-- ----------------------------------------------------------------------------
-- 4b. SPANISH MONTHS, EXPLICITLY
-- ----------------------------------------------------------------------------
-- to_char(now(), 'MON') would return AUG, not AGO, and what it returns depends
-- on the database's lc_time — a server setting that is not part of this
-- schema, can differ between environments, and would silently change every
-- identifier if it were ever adjusted. An identifier printed on a customer's
-- contract cannot depend on a locale setting. So the mapping is a lookup, and
-- the twelve tokens are canonical regardless of the user's UI language.
create or replace function public.odl_spanish_month_abbrev(p_month integer)
returns text
language sql
immutable
set search_path = public, pg_temp
as $function$
  select case p_month
    when  1 then 'ENE' when  2 then 'FEB' when  3 then 'MAR'
    when  4 then 'ABR' when  5 then 'MAY' when  6 then 'JUN'
    when  7 then 'JUL' when  8 then 'AGO' when  9 then 'SEP'
    when 10 then 'OCT' when 11 then 'NOV' when 12 then 'DIC'
  end;
$function$;


-- ----------------------------------------------------------------------------
-- 4c. THE GENERATOR
-- ----------------------------------------------------------------------------
-- SECURITY INVOKER, deliberately. Nothing here needs elevated privilege: the
-- caller is already inserting into applications and only needs to read one
-- products row and call nextval(). Making it DEFINER would hand it authority
-- it has no use for, which is the opposite of how every other function in this
-- schema was reasoned about. search_path is still pinned.
--
-- PANAMA TIME, NOT UTC. now() is a timestamptz and to_char would render it in
-- the session's TimeZone, which is UTC by default. An application filed at
-- 8pm in Panama City is 1am UTC the following day — it would carry tomorrow's
-- date on the customer's paperwork. The business day is the Panama day.
--
-- PADDING THAT DOES NOT TRUNCATE. lpad(text, 4, '0') truncates from the RIGHT
-- when the input is already longer than 4, so lpad('10000', 4, '0') yields
-- '1000' — silently colliding the ten-thousandth application with the
-- thousandth. The conditional below pads below 10000 and passes the value
-- through untouched above it, which is why the format check accepts four OR
-- MORE digits.
create or replace function public.generate_application_number(p_product_id uuid)
returns text
language plpgsql
volatile
set search_path = public, pg_temp
as $function$
declare
  v_application_code text;
  v_local timestamp;
  v_seq bigint;
begin
  select application_code into v_application_code
  from public.products
  where id = p_product_id;

  if not found then
    raise exception 'generate_application_number: product % does not exist', p_product_id
      using errcode = '23503';
  end if;

  -- Fails LOUDLY rather than inventing a letter or emitting a malformed
  -- identifier. A product with no application_code must not be able to
  -- originate an application at all.
  if v_application_code is null then
    raise exception
      'generate_application_number: product % has no application_code and cannot issue official applications',
      p_product_id
      using errcode = '22023';
  end if;

  v_local := now() at time zone 'America/Panama';
  v_seq := nextval('public.applications_official_number_seq');

  return 'ODL-'
    || to_char(v_local, 'DD')
    || public.odl_spanish_month_abbrev(extract(month from v_local)::integer)
    || to_char(v_local, 'YY')
    || '-'
    || case when v_seq < 10000 then lpad(v_seq::text, 4, '0') else v_seq::text end
    || '-'
    || v_application_code;
end;
$function$;

comment on function public.generate_application_number(uuid) is
  'MILESTONE 26A-1. Builds ODL-DDMMMYY-NNNN-X for one formal Application. '
  'Consumes applications_official_number_seq atomically via nextval() — never '
  'count(*), never client-side. Spanish month tokens are an explicit lookup, '
  'not lc_time. Dates are Panama business dates, not UTC. Raises if the '
  'product carries no application_code.';


-- ----------------------------------------------------------------------------
-- 4d. THE TRIGGER, AND WHY A COLUMN DEFAULT COULD NOT DO THIS
-- ----------------------------------------------------------------------------
-- The suffix comes from the product, so the generator needs product_id — a
-- value on the very row being inserted. A column DEFAULT cannot reference
-- another column of its own row, which is precisely why the old DEFAULT could
-- only ever produce a product-agnostic identifier.
--
-- A BEFORE INSERT trigger can: it sees the completed NEW row. The old DEFAULT
-- is dropped in the same migration because a DEFAULT is applied BEFORE row
-- triggers fire — leaving it would have meant every insert first burned a
-- value off the retired sequence and handed the trigger a pre-filled column.
--
-- Only fills a NULL. An explicit application_number still validates against
-- the format check, so a future controlled data migration can supply one
-- without fighting this trigger.
create or replace function public.set_application_number()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if new.application_number is null then
    new.application_number := public.generate_application_number(new.product_id);
  end if;
  return new;
end;
$function$;

alter table public.applications alter column application_number drop default;

drop trigger if exists applications_set_application_number on public.applications;
create trigger applications_set_application_number
  before insert on public.applications
  for each row
  execute function public.set_application_number();


-- ----------------------------------------------------------------------------
-- 4e. FORMAT CHECK
-- ----------------------------------------------------------------------------
-- Replaces the old ^ODL-[0-9]{4}-[0-9]{6}$, which the new format cannot
-- satisfy. Safe to swap outright because section 1 removed every row that used
-- the old shape — no existing identifier is invalidated and none is rewritten.
--
-- [0-9]{4,} — four OR MORE digits, so the ten-thousandth application is
-- 10000 and not a truncated collision.
--
-- [A-Z] rather than [NDVE] — this constraint's job is to reject a MALFORMED
-- identifier. WHICH letters are legal is a property of the product catalog,
-- enforced by products_application_code_* and by the generator reading it.
-- Encoding today's four products here would mean a schema migration the day
-- ODL adds a fifth.
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'applications_application_number_format_check'
      and conrelid = 'public.applications'::regclass
  ) then
    alter table public.applications
      drop constraint applications_application_number_format_check;
  end if;

  alter table public.applications
    add constraint applications_application_number_format_check
    check (application_number ~ '^ODL-[0-9]{2}[A-Z]{3}[0-9]{2}-[0-9]{4,}-[A-Z]$');
end $$;

comment on column public.applications.application_number is
  'MILESTONE 26A-1. Permanent official identifier, ODL-DDMMMYY-NNNN-X, '
  'assigned by the applications_set_application_number trigger when a FORMAL '
  'Application row is created. A Lead in application_intakes never receives '
  'one — an application number exists only once a product has been chosen and '
  'a real Application exists. UNIQUE via applications_application_number_key.';
