-- ============================================================================
-- MILESTONE 26B-2A — A CLIENT ODL HAS NOT FINISHED MEETING YET
-- ============================================================================
--
-- WHY THIS CHANGE EXISTS
--
-- The approved public portal asks a new applicant for six things in Step 1:
-- name, email, phone, document type, document number, and the amount they
-- want. It deliberately does not ask for a birth date, a nationality, an
-- address, a job title or a salary — those belong later in the conversation,
-- and 26B-1A removed them from Step 1 on purpose.
--
-- But `clients` required all five. So the portal's own applicant could not
-- become a Client, could not therefore have an Application, and Step 2 — which
-- hangs off an Application — was unreachable for anyone who was not already in
-- ODL's books. 26B-2 found this and stopped rather than working around it.
--
-- There were only ever two workarounds and both were rejected: ask for the
-- fields early (which contradicts the approved experience) or write something
-- into them (which puts a birth date ODL never collected in front of an
-- underwriter). The columns were simply asserting more than the business knows
-- at that moment.
--
-- ----------------------------------------------------------------------------
-- NULL MEANS "NOT COLLECTED YET" — NOTHING ELSE
-- ----------------------------------------------------------------------------
-- No default, no sentinel, no '', no 'Unknown', no 'Panamá', no 1900-01-01.
-- A column that cannot say "I don't know" ends up lying, and a lie in a birth
-- date is indistinguishable from a fact once it is stored.
--
-- ----------------------------------------------------------------------------
-- FIVE COLUMNS, NOT THREE
-- ----------------------------------------------------------------------------
-- The milestone brief named birth_date, nationality and address. Inspection
-- found `position` and `monthly_salary` are NOT NULL on the same table and are
-- equally absent from Step 1, so relaxing only the named three would have left
-- the portal blocked on the next constraint and the objective unmet. They are
-- included here as the "genuinely necessary related adjustments" the brief
-- anticipated, and are called out in the milestone report rather than slipped in.
--
-- Note these two are still COLLECTED, just later: Step 2 asks employees for a
-- job title and a monthly salary. They are simply not known at the moment the
-- Client row has to exist.
--
-- ----------------------------------------------------------------------------
-- WHAT DOES NOT CHANGE
-- ----------------------------------------------------------------------------
--   * full_name, identification_type, identification_number, phone and email
--     stay NOT NULL. Step 1 collects every one of them, and they are what makes
--     a Client a person rather than a placeholder.
--   * The (identification_type, identification_number) uniqueness rule, the
--     status and source CHECKs, branch semantics and every audit column are
--     untouched.
--   * The CRM's own client form still requires all five at the action layer.
--     Staff filling in a client record are answering questions they have asked;
--     this migration changes what the DATABASE permits, not what that form asks.
--
-- EXISTING ROWS ARE UNTOUCHED. Dropping NOT NULL cannot alter stored values and
-- no UPDATE runs here. At the time of writing all 17 clients carry all five
-- values, and they keep them.

alter table public.clients
  alter column birth_date     drop not null,
  alter column nationality    drop not null,
  alter column address        drop not null,
  alter column position       drop not null,
  alter column monthly_salary drop not null;

-- Say in words that NULL is acceptable.
--
-- Not strictly required — PostgreSQL treats a CHECK evaluating to NULL as
-- satisfied, so `monthly_salary >= 0` already admitted NULL the moment the
-- column became nullable. Relying on that would leave the constraint's text
-- claiming something stricter than its behaviour, and the next reader would
-- need the three-valued-logic detail to understand why NULLs are in the table.
alter table public.clients
  drop constraint clients_monthly_salary_check;

alter table public.clients
  add constraint clients_monthly_salary_check
    check (monthly_salary is null or monthly_salary >= 0);

comment on column public.clients.birth_date is
  'NULL means NOT COLLECTED YET. The public portal does not ask for a birth '
  'date, so a portal-originated client carries NULL until ODL gathers it. '
  'Never substitute a placeholder date.';

comment on column public.clients.nationality is
  'NULL means NOT COLLECTED YET. Never default to a country.';

comment on column public.clients.address is
  'NULL means NOT COLLECTED YET. Never substitute a placeholder address.';

comment on column public.clients.position is
  'Job title. NULL means NOT COLLECTED YET — Step 2 asks employees for one, '
  'which is after the Client row must already exist.';

comment on column public.clients.monthly_salary is
  'NULL means NOT COLLECTED YET, which is different from zero. Step 2 asks for '
  'it; a client created from Step 1 alone has none. Never coerce NULL to 0 — an '
  'applicant earning nothing and an applicant we have not asked are not the '
  'same person to an underwriter.';
