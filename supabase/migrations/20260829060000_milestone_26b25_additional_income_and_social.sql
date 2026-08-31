-- ============================================================================
-- MILESTONE 26B-25 — TWO THINGS ODL WAS ASKING FOR ON PAPER AND NOWHERE ELSE
-- ============================================================================
--
-- ODL wants every applicant asked whether they have income beyond their main
-- one, and which social network they actually use. Both are being collected in
-- conversation today and landing nowhere structured, which means nobody can
-- filter, total or follow up on them.
--
-- ----------------------------------------------------------------------------
-- WHY THEY GO IN DIFFERENT PLACES
-- ----------------------------------------------------------------------------
-- ADDITIONAL INCOME belongs to the APPLICATION. What somebody earns on the side
-- is part of the financial picture ODL evaluates for this loan, at this moment,
-- and it can legitimately differ between two applications by the same person a
-- year apart. It joins `application_financial_profiles`, which already holds
-- exactly that kind of fact and until now held only monthly expenses.
--
-- THE SOCIAL NETWORK belongs to the PERSON. Somebody with three loans has one
-- Instagram. Storing it per application would keep the same fact in three rows
-- free to disagree, and the first disagreement would be unresolvable. It joins
-- `clients`, beside phone and address — which also means staff loading historic
-- customers by hand can record it, not just applicants arriving through the
-- portal.
--
-- ----------------------------------------------------------------------------
-- EVERY COLUMN IS NULLABLE, AND THAT IS THE POINT
-- ----------------------------------------------------------------------------
-- ODL is already live: there are clients, applications in progress and people
-- part-way through the public form right now. None of them was asked these
-- questions. NULL means "not asked", it is not a gap to be back-filled, and
-- nothing anywhere may treat its absence as an incomplete application.
--
-- ----------------------------------------------------------------------------
-- THE PAIRING RULES ARE CHECKS, NOT CONVENTIONS
-- ----------------------------------------------------------------------------
-- "No additional income" and "additional income of an unknown amount" are
-- different answers, and only one of them is a real one. The CHECK makes the
-- second unstorable rather than leaving it to every writer to remember: say no,
-- and the amount and source must be absent; say yes, and an amount is required.
-- The same shape guards the social network's "other" free-text.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. ADDITIONAL INCOME — on the application's financial profile
-- ----------------------------------------------------------------------------

alter table public.application_financial_profiles
  add column has_additional_income boolean,
  add column additional_monthly_income numeric(12,2),
  add column additional_income_source text;

-- Same money shape as every other amount in this schema, and the same
-- "nullable amount of money" CHECK: absent, or a real positive figure. Zero is
-- not an additional income, it is the absence of one, and that is what `false`
-- is for.
alter table public.application_financial_profiles
  add constraint application_financial_profiles_additional_income_amount_check
  check (additional_monthly_income is null or additional_monthly_income > 0);

-- The three columns answer one question together, so they are constrained
-- together. Unanswered leaves all three null; "no" leaves the details null;
-- "yes" requires the amount. The source stays optional even on yes — an
-- applicant who says "yes, B/. 300" and does not elaborate has still told us
-- something true, and refusing to store it would lose the figure to protect a
-- sentence.
alter table public.application_financial_profiles
  add constraint application_financial_profiles_additional_income_pair_check
  check (
    (has_additional_income is null
      and additional_monthly_income is null
      and additional_income_source is null)
    or (has_additional_income = false
      and additional_monthly_income is null
      and additional_income_source is null)
    or (has_additional_income = true
      and additional_monthly_income is not null)
  );

comment on column public.application_financial_profiles.has_additional_income is
  'MILESTONE 26B-25. Did the applicant report income beyond their main income? '
  'NULL means the question was never put to them — true of every application '
  'created before this milestone, and never to be read as "no".';

comment on column public.application_financial_profiles.additional_monthly_income is
  'MILESTONE 26B-25. Approximate monthly figure, in the same numeric(12,2) shape '
  'as every other amount here. Present exactly when has_additional_income is true.';

comment on column public.application_financial_profiles.additional_income_source is
  'MILESTONE 26B-25. The applicant''s own short description of where it comes '
  'from — rent, own business, commissions, and so on. Free text on purpose: the '
  'examples shown in the form are prompts, not a closed vocabulary, and forcing '
  'a category would lose the answer that does not fit one.';

-- ----------------------------------------------------------------------------
-- 2. PRIMARY SOCIAL NETWORK — on the person
-- ----------------------------------------------------------------------------

alter table public.clients
  add column primary_social_network text,
  add column primary_social_network_other text;

-- Stable internal values, never the visible label: the CRM runs in Spanish and
-- English, and a row storing "Otros" could not be rendered in the other one.
alter table public.clients
  add constraint clients_primary_social_network_check
  check (
    primary_social_network is null
    or primary_social_network in ('instagram','facebook','tiktok','linkedin','x','other')
  );

-- The free-text half exists only for `other`, and is required there — "other"
-- with no explanation is a shrug, not an answer. Anything else must leave it
-- empty, so switching away from `other` cannot strand the previous text.
alter table public.clients
  add constraint clients_primary_social_network_other_pair_check
  check (
    (primary_social_network = 'other' and primary_social_network_other is not null
      and length(btrim(primary_social_network_other)) > 0)
    or (primary_social_network is distinct from 'other' and primary_social_network_other is null)
  );

comment on column public.clients.primary_social_network is
  'MILESTONE 26B-25. Which network this person actually uses. Stored as a stable '
  'internal value (instagram, facebook, tiktok, linkedin, x, other) and rendered '
  'through the message catalogue, so the row reads correctly in both languages. '
  'NULL means never asked — true of every client created before this milestone.';

comment on column public.clients.primary_social_network_other is
  'MILESTONE 26B-25. What they named when they chose "other". Required for that '
  'value and forbidden for every other, so the pair can never disagree.';
