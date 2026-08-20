-- ============================================================================
-- MILESTONE 26A-2 — APPLICATION DATA FOUNDATION (STEP 2)
-- ============================================================================
--
-- Six new tables holding everything the approved Step 2 of the public portal
-- captures, for all four official products. No portal, no documents, no
-- declarations, no public access — those are later milestones. This is the
-- place their data will land.
--
-- ----------------------------------------------------------------------------
-- WHY NONE OF THIS GOES ON `clients`
-- ----------------------------------------------------------------------------
-- A client is a PERSON. An application is a set of CIRCUMSTANCES DECLARED AT A
-- MOMENT IN TIME. Someone earning 2,500 today who applies again in two years
-- earning 3,500 must not retroactively rewrite what the first application was
-- assessed on — the analysis, the approval and the file all rest on the figure
-- declared then. So salary, employer, expenses, debts, banking, collateral and
-- business data attach to the APPLICATION, and `clients` keeps only durable
-- identity. This is the single most important line in this migration.
--
-- ----------------------------------------------------------------------------
-- CONVENTIONS FOLLOWED (verified against the live schema, not assumed)
-- ----------------------------------------------------------------------------
--   money        numeric(12,2) — the only monetary type this schema uses.
--                Never float/double: 0.1 + 0.2 is not 0.3 and a lender cannot
--                have that in a balance.
--   controlled   CHECK constraints on text. This schema has ZERO PostgreSQL
--     values     enum types and expresses every vocabulary this way
--                (application status, client status, roles, capabilities...).
--   timestamps   created_at timestamptz default now(). This schema has ZERO
--                updated_at columns anywhere — mutation history lives in
--                crm_events, which 26A-2 does not touch.
--   RLS          enabled, no policies. Identical to the other 22 tables:
--                everything reaches these rows through server-side services
--                holding the service role. See section 8.
--
-- ----------------------------------------------------------------------------
-- ON DELETE CASCADE, DELIBERATELY — AND IT IS THE ONLY CASCADE THAT FITS
-- ----------------------------------------------------------------------------
-- Everywhere else this schema uses RESTRICT, because those rows are SHARED
-- (a product referenced by applications, a branch referenced by clients). These
-- six tables are different: each row is OWNED BY EXACTLY ONE APPLICATION and is
-- meaningless without it. An orphaned "monthly expenses of nothing" is not data
-- worth protecting. RESTRICT here would only mean that any future application
-- deletion has to hand-unwind six tables in dependency order — exactly the
-- manual choreography 26A-1's cleanup had to perform for requirement_slots.
--
-- Note this changes nothing today: the product has no application-delete path
-- at all, and none is added here.
-- ============================================================================


-- ============================================================================
-- 1. EMPLOYMENT / INCOME  —  products N, D, V
-- ============================================================================
--
-- ONE TABLE FOR EMPLOYEE AND SELF-EMPLOYED, not two. They answer the same
-- question — "where does this person's money come from?" — and differ only in
-- which fields describe the source. Two tables would fork every future income
-- query and every analysis input for no gain.
--
-- The CHECK below is what keeps that honest: an 'employee' row must name an
-- employer and a job title; a 'self_employed' row must name an activity. A row
-- cannot claim to be one and be shaped like the other.
--
-- payroll_deduction_available is nullable because only product N asks it. Which
-- products ask which questions is workflow, and workflow lives in the service
-- layer — see section 9 on the split.
create table if not exists public.application_employment (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  employment_status text not null,
  employer_name text,
  job_title text,
  contract_type text,
  self_employed_activity text,
  start_date date,
  monthly_income numeric(12, 2),
  payroll_deduction_available text,
  created_at timestamptz not null default now(),
  unique (application_id),
  constraint application_employment_status_check
    check (employment_status in ('employee', 'self_employed')),
  constraint application_employment_contract_type_check
    check (contract_type is null or contract_type in ('permanent', 'temporary', 'contractor', 'other')),
  constraint application_employment_payroll_deduction_check
    check (payroll_deduction_available is null
           or payroll_deduction_available in ('yes', 'no', 'unsure')),
  constraint application_employment_monthly_income_check
    check (monthly_income is null or monthly_income >= 0),
  constraint application_employment_shape_check
    check (
      (employment_status = 'employee'
        and employer_name is not null and job_title is not null)
      or
      (employment_status = 'self_employed'
        and self_employed_activity is not null)
    )
);

comment on table public.application_employment is
  'MILESTONE 26A-2. How the applicant earns, AS DECLARED FOR THIS APPLICATION '
  '(products N/D/V). At most one per application. Covers both employees and '
  'the self-employed — V accepts either — with a shape CHECK so a row cannot '
  'claim one status while carrying the other''s fields. Never mirrored onto '
  'clients: a later application must be free to declare different figures '
  'without rewriting this one.';
comment on column public.application_employment.payroll_deduction_available is
  'Product N only: does the employer permit direct payroll deduction? '
  'yes/no/unsure — "unsure" is a real answer from an applicant who has not '
  'asked their employer yet, not a missing value.';
comment on column public.application_employment.start_date is
  'Employment start date for an employee, activity start date for the '
  'self-employed. A real date, never a free-text string.';


-- ============================================================================
-- 2. DECLARED PERSONAL FINANCES  —  products N, D, V
-- ============================================================================
--
-- Monthly household expenses. Its own table rather than a column on
-- applications or on employment, for two reasons:
--
--   * applications is identity and lifecycle — number, status, product, client,
--     advisor, branch. Slipping one Step 2 financial field in there while every
--     other Step 2 field lives in a child table is the inconsistency that makes
--     a schema hard to reason about a year later.
--   * expenses are not employment. A household spends the same whether the
--     earner is salaried or self-employed.
--
-- One meaningful column today. It is the correct home for it, and the natural
-- home for the personal-financial fields Step 2 will grow.
--
-- Product E deliberately has no row here: a business application declares
-- BUSINESS revenue and expenses, which live on the business profile (section 7)
-- and are a different fact from an owner's household spending.
create table if not exists public.application_financial_profiles (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  monthly_expenses numeric(12, 2),
  created_at timestamptz not null default now(),
  unique (application_id),
  constraint application_financial_profiles_monthly_expenses_check
    check (monthly_expenses is null or monthly_expenses >= 0)
);

comment on table public.application_financial_profiles is
  'MILESTONE 26A-2. The applicant''s declared personal financial position for '
  'THIS application — today just approximate monthly household expenses '
  '(products N/D/V). Deliberately separate from employment (a household spends '
  'the same however the earner is paid) and from applications (which stays '
  'identity and lifecycle). Product E declares business revenue/expenses '
  'instead, on application_business_profiles.';


-- ============================================================================
-- 3. BANKING  —  product D  —  CONTAINS THE MOST SENSITIVE FIELD IN THE SCHEMA
-- ============================================================================
--
-- THE ACCOUNT NUMBER PROBLEM, AND WHAT IS AND IS NOT SOLVED HERE.
--
-- account_number_last4 is a GENERATED column: the database derives it, so it
-- cannot drift from the number it masks and no application code has to
-- remember to compute it. Every list-level read selects last4 and never
-- account_number; the full value is reachable only through a deliberate
-- single-record path. That boundary is enforced in the service layer
-- (src/lib/services/application-step2.ts), which selects explicit column lists
-- — this schema has never used SELECT *.
--
-- WHAT THIS IS NOT: encryption at rest. account_number is stored in plaintext
-- in the column. Doing otherwise properly needs key management this project
-- does not have — pgsodium/Vault provisioning, key rotation, and a decision
-- about who may decrypt — and inventing an ad-hoc cipher (a hardcoded key in a
-- migration, say) would be worse than plaintext because it would LOOK
-- protected. It is called out in the milestone report as an open decision
-- rather than quietly approximated here.
--
-- Multiple accounts are allowed structurally with at most one primary, using
-- the exact partial-unique-index idiom profile_branch_memberships already uses
-- for primary branch. The portal will ask for one; the schema does not have to
-- be rewritten the day it asks for two.
create table if not exists public.application_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  bank_name text not null,
  account_type text not null,
  account_number text not null,
  account_number_last4 text generated always as (right(account_number, 4)) stored,
  receives_salary boolean,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  constraint application_bank_accounts_account_type_check
    check (account_type in ('savings', 'checking', 'other')),
  constraint application_bank_accounts_account_number_check
    check (length(btrim(account_number)) between 4 and 34)
);

create unique index if not exists application_bank_accounts_one_primary
  on public.application_bank_accounts (application_id)
  where is_primary;

comment on table public.application_bank_accounts is
  'MILESTONE 26A-2. Bank account nominated for direct debit / standing order '
  '(product D). At most one primary per application, enforced by a partial '
  'unique index. SENSITIVE — see account_number.';
comment on column public.application_bank_accounts.account_number is
  'SENSITIVE. Never selected by list-level reads and never logged. Reachable '
  'only through the deliberate single-record path in the Step 2 service. '
  'Stored in PLAINTEXT: encryption at rest would require key-management '
  'infrastructure this project does not yet have, and an ad-hoc cipher would '
  'be worse than none because it would look protected. Recorded as an open '
  'decision in the 26A-2 report.';
comment on column public.application_bank_accounts.account_number_last4 is
  'Database-derived mask, e.g. rendered as ****1234. GENERATED so it can never '
  'drift from account_number and no caller has to remember to compute it. This '
  'is what list views select; they never touch the full number.';


-- ============================================================================
-- 4. FINANCIAL OBLIGATIONS  —  products N, D, V, E  —  zero-to-many
-- ============================================================================
--
-- A real table rather than a JSON array on the application, because the whole
-- point of collecting these is that analysis must SUM them: total monthly
-- obligations against declared income is the core affordability figure. Summing
-- across a jsonb array is possible and miserable; summing rows is one query and
-- is indexed.
--
-- obligation_owner distinguishes the applicant's own debts (N/D/V) from the
-- company's existing financing (E). Two words of discriminator instead of two
-- near-identical tables, and it keeps "total monthly obligations for this
-- application" answerable in one place with a WHERE.
create table if not exists public.application_obligations (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  obligation_owner text not null default 'applicant',
  lender_name text not null,
  outstanding_balance numeric(12, 2),
  monthly_payment numeric(12, 2),
  created_at timestamptz not null default now(),
  constraint application_obligations_owner_check
    check (obligation_owner in ('applicant', 'business')),
  constraint application_obligations_balance_check
    check (outstanding_balance is null or outstanding_balance >= 0),
  constraint application_obligations_payment_check
    check (monthly_payment is null or monthly_payment >= 0)
);

create index if not exists application_obligations_application_idx
  on public.application_obligations (application_id);

comment on table public.application_obligations is
  'MILESTONE 26A-2. Existing debts declared for this application — zero, one '
  'or many. A table, not a jsonb array, because analysis has to SUM monthly '
  'payments against declared income and that is the affordability calculation. '
  'obligation_owner separates the applicant''s own debts (N/D/V) from the '
  'company''s financing (E) without forking the table.';


-- ============================================================================
-- 5. GUARANTORS  —  products N, D, V  —  zero-to-many
-- ============================================================================
--
-- A GUARANTOR IS NOT A CLIENT, and is deliberately not written into `clients`.
-- A client is someone ODL lends to, carrying a unique national identification,
-- a status lifecycle, a restriction flag, dossier notes, alerts and a branch.
-- A guarantor at Step 2 is three fields somebody typed about another person who
-- has not been contacted, has not consented, and may never be verified.
-- Manufacturing a client row for them would put an unverified stranger into the
-- client directory, into search, into the duplicate-identification checks, and
-- into branch-scoped lists.
--
-- If a guarantor ever needs to become a client, that is a deliberate future
-- promotion with its own consent and verification — not a side effect of
-- someone filling in a form.
--
-- ZERO-TO-MANY, though the first portal screen asks for one. The database not
-- restricting to one is free; discovering later that it does is a migration
-- against live data.
--
-- STEP 3 READINESS: documents will attach by adding a nullable
-- application_guarantor_id to the evidence/requirement side and pointing it at
-- this id. That is additive. Nothing here has to be redesigned for it.
create table if not exists public.application_guarantors (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  full_name text not null,
  email text,
  phone text,
  created_at timestamptz not null default now()
);

create index if not exists application_guarantors_application_idx
  on public.application_guarantors (application_id);

comment on table public.application_guarantors is
  'MILESTONE 26A-2. A person offered as guarantor for this application — name, '
  'e-mail, phone as declared at Step 2. DELIBERATELY NOT A CLIENT: they have '
  'not consented, are not verified, and must not enter the client directory, '
  'identification-uniqueness checks or branch-scoped lists. Zero-to-many even '
  'though the first portal screen asks for one. Step 3 will attach documents '
  'by referencing this id — additively, with no redesign.';


-- ============================================================================
-- 6. COLLATERAL  —  products V, E  —  zero-to-many
-- ============================================================================
--
-- ONE TABLE, TWO SHAPES, guarded by a CHECK — the same approach as employment
-- above, for the same reason: a vehicle and a property are both "the security
-- behind this loan", and every future question (does this application have
-- collateral? what documents does its collateral need?) wants one place to look.
--
-- FOR PRODUCT V THIS IS A TITLE ALREADY OWNED, not a purchase being financed.
-- owned_by_applicant and lien_status exist precisely because the vehicle
-- already exists in the world and may already be encumbered — questions that
-- are meaningless when financing a purchase. The retired demo `vehicle_loan`
-- product conflated the two; this does not.
--
-- vehicle_year is bounded 1900..2200 rather than against the current year: a
-- CHECK expression must be IMMUTABLE, so extract(year from now()) is not even
-- legal here — and a hardcoded "<= 2026" would silently start rejecting valid
-- model years in a few months. A wide, permanently-true bound catches typos
-- (year 19 or 20260) without ever expiring.
create table if not exists public.application_collateral (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  collateral_type text not null,
  vehicle_make text,
  vehicle_model text,
  vehicle_year integer,
  vehicle_plate text,
  owned_by_applicant boolean,
  lien_status text,
  lien_balance numeric(12, 2),
  property_type text,
  property_location text,
  created_at timestamptz not null default now(),
  constraint application_collateral_type_check
    check (collateral_type in ('vehicle', 'property')),
  constraint application_collateral_lien_status_check
    check (lien_status is null or lien_status in ('yes', 'no', 'unsure')),
  constraint application_collateral_lien_balance_check
    check (lien_balance is null or lien_balance >= 0),
  constraint application_collateral_vehicle_year_check
    check (vehicle_year is null or vehicle_year between 1900 and 2200),
  constraint application_collateral_shape_check
    check (
      (collateral_type = 'vehicle'
        and vehicle_make is not null and vehicle_model is not null
        and vehicle_year is not null and vehicle_plate is not null
        and property_type is null and property_location is null)
      or
      (collateral_type = 'property'
        and property_type is not null and property_location is not null
        and vehicle_make is null and vehicle_model is null
        and vehicle_year is null and vehicle_plate is null)
    )
);

create index if not exists application_collateral_application_idx
  on public.application_collateral (application_id);

comment on table public.application_collateral is
  'MILESTONE 26A-2. Security pledged for this application — a vehicle (product '
  'V, and optionally E) or a property (E). One table with a shape CHECK so a '
  'row cannot carry both sets of fields. For product V this is a title the '
  'applicant ALREADY OWNS and may already have encumbered, which is why '
  'owned_by_applicant and lien_status exist — not a purchase being financed. '
  'Zero-to-many. Step 3 will attach documents by referencing this id.';


-- ============================================================================
-- 7. BUSINESS PROFILE  —  product E
-- ============================================================================
--
-- The company as declared for this application. Revenue and expenses live here
-- rather than on application_financial_profiles because they are facts about a
-- BUSINESS, not about the applicant's household — and an owner's personal
-- spending is a different number that a lender must not accidentally add to the
-- company's.
--
-- registration_number is Panama's RUC. Treated as ordinary business-identity
-- data: it is printed on invoices and public registry filings, so it is not
-- masked the way a bank account is — but it is still not something to scatter
-- through logs.
create table if not exists public.application_business_profiles (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete cascade,
  legal_name text not null,
  trade_name text,
  economic_activity text,
  operations_start_date date,
  registration_number text,
  average_monthly_revenue numeric(12, 2),
  average_monthly_expenses numeric(12, 2),
  loan_purpose text,
  purpose_description text,
  applicant_relationship text,
  created_at timestamptz not null default now(),
  unique (application_id),
  constraint application_business_profiles_purpose_check
    check (loan_purpose is null
           or loan_purpose in ('working_capital', 'inventory', 'equipment', 'expansion', 'other')),
  constraint application_business_profiles_relationship_check
    check (applicant_relationship is null
           or applicant_relationship in ('owner', 'partner', 'director', 'authorized_representative', 'other')),
  constraint application_business_profiles_revenue_check
    check (average_monthly_revenue is null or average_monthly_revenue >= 0),
  constraint application_business_profiles_expenses_check
    check (average_monthly_expenses is null or average_monthly_expenses >= 0)
);

comment on table public.application_business_profiles is
  'MILESTONE 26A-2. The company behind a business application (product E), as '
  'declared for THIS application: identity, RUC, average monthly revenue and '
  'expenses, loan purpose, and the applicant''s relationship to the company. '
  'At most one per application. Business revenue/expenses live here rather '
  'than with personal finances — they are a different number and must never be '
  'summed together by accident.';
comment on column public.application_business_profiles.registration_number is
  'Panama RUC / registry number. Business-identity data that appears on public '
  'filings, so not masked like a bank account — but still not for logs.';


-- ============================================================================
-- 8. RLS — SAME POSTURE AS EVERY OTHER TABLE IN THIS SCHEMA
-- ============================================================================
--
-- Row Level Security ON, and NO POLICIES. That combination denies every role
-- except service_role (which bypasses RLS by design), which is exactly how the
-- other 22 tables here work — the only policies in this database are three
-- `*_select_own` reads on profile-related tables.
--
-- The practical effect: these rows are reachable ONLY through the server-side
-- services holding the service key. `anon` and `authenticated` get nothing, so
-- adding these tables opens no new path to application data and cannot become
-- an authorization bypass around the branch and capability rules that already
-- protect applications.
--
-- The public portal will NOT be given anonymous RLS access to these tables. Its
-- access model is a secure continuation session, designed in a later milestone.
alter table public.application_employment enable row level security;
alter table public.application_financial_profiles enable row level security;
alter table public.application_bank_accounts enable row level security;
alter table public.application_obligations enable row level security;
alter table public.application_guarantors enable row level security;
alter table public.application_collateral enable row level security;
alter table public.application_business_profiles enable row level security;


-- ============================================================================
-- 9. WHERE VALIDATION LIVES — AND WHY IT IS NOT ALL IN HERE
-- ============================================================================
--
-- THE DATABASE OWNS what is true of a row in isolation, forever:
--   * foreign keys and ownership (every row belongs to exactly one application)
--   * types and dates (start_date is a date, not "next March")
--   * money is non-negative — a debt of -500 is not a debt
--   * controlled vocabularies (employment_status, lien_status, loan_purpose...)
--   * shape (an 'employee' row names an employer; a 'vehicle' row has a plate)
--   * at most one employment / financial / business profile per application
--   * at most one primary bank account per application
--
-- THE SERVICE LAYER OWNS which questions each product asks:
--   * product D expects banking; product N expects payroll_deduction_available
--   * product V accepts employee OR self-employed; E expects a business profile
--
-- That split is deliberate. Encoding "product D must have a bank account" as a
-- database trigger sounds tidy and is a trap: Step 2 is filled in progressively,
-- so the row is legitimately incomplete for most of its life, and a trigger
-- enforcing completeness would reject every intermediate save. Worse, product
-- rules change with the business — and a rule that lives in a trigger maze is a
-- rule nobody can find. Integrity is permanent and belongs in the database;
-- workflow is negotiable and belongs where it can be read and tested.
--
-- No product-completeness validator is built in this milestone: there is no
-- portal to validate for yet, and writing one now would be guessing at a UI
-- that does not exist.
