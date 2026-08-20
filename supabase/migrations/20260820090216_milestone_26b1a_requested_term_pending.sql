-- ============================================================================
-- MILESTONE 26B-1A — A REQUESTED TERM THE CUSTOMER HAS NOT CHOSEN YET
-- ============================================================================
--
-- WHY THIS CHANGE EXISTS
--
-- `applications.requested_term_months` has been NOT NULL since the table was
-- created, which was correct while every application arrived from one long form
-- that asked for a term in the same breath as everything else.
--
-- The approved portal flow does not work that way. ODL did not ask customers to
-- pick a repayment term on the first screen, and pretending otherwise forced
-- 26B-1 to put "Plazo solicitado (meses)" in Step 1 purely to satisfy this
-- constraint — a question asked of the customer because the schema demanded an
-- answer, not because the business wanted one. That is exactly backwards.
--
-- The term is not being removed from the product. It is being recognised as
-- something that is NEGOTIATED LATER, with an advisor, once ODL knows the
-- applicant's circumstances. Until then the honest value is "not yet
-- determined", and the only faithful way to store that is NULL.
--
-- NO VALUE IS FABRICATED. The alternative was defaulting to 12, 24 or 36 months
-- so the column could stay NOT NULL. Every one of those would be a number ODL
-- never agreed to, sitting in a field an underwriter would reasonably read as
-- "what the customer asked for". A NULL cannot be mistaken for a request.
--
-- ----------------------------------------------------------------------------
-- WHAT THIS DOES NOT CHANGE
-- ----------------------------------------------------------------------------
--   * `requested_amount` stays NOT NULL. The customer DOES state an amount in
--     Step 1, and an application for an unknown sum would be meaningless.
--   * Staff-created applications still supply a term: the CRM's own creation
--     path (src/app/(app)/solicitudes/actions.ts) keeps its own required-field
--     validation, which is a UI contract and not something this column enforces.
--   * Application numbering, the N/D/V/E suffix, the sequence and every other
--     26A guarantee are untouched.
--
-- EXISTING ROWS ARE PRESERVED. Dropping NOT NULL cannot alter stored values,
-- and no UPDATE runs here. (At the time of writing the table holds zero rows,
-- but this migration would be equally safe against a populated table — which is
-- the property that matters, since migrations outlive the state they were
-- written against.)

alter table public.applications
  alter column requested_term_months drop not null;

-- The CHECK is rewritten to say NULL is acceptable IN WORDS.
--
-- Strictly this is not required: PostgreSQL treats a CHECK whose expression
-- evaluates to NULL as satisfied, so `requested_term_months > 0` would already
-- have admitted NULL the moment the column became nullable. Relying on that
-- would mean the constraint's text says one thing ("must be between 1 and 360")
-- while its behaviour permits another, and the next person to read it would
-- have to know that three-valued-logic detail to understand why NULLs are in
-- the table. Saying it explicitly costs one clause.
alter table public.applications
  drop constraint applications_requested_term_months_check;

alter table public.applications
  add constraint applications_requested_term_months_check
    check (
      requested_term_months is null
      or (requested_term_months > 0 and requested_term_months <= 360)
    );

comment on column public.applications.requested_term_months is
  'Repayment term in months. NULL means NOT YET DETERMINED — the public portal '
  'deliberately does not ask the customer to choose a term, so an application '
  'created from the portal carries NULL until ODL and the applicant agree one. '
  'NULL is a pending state, never a default, and no code may substitute a '
  'number for it. Staff-created applications supply a term at creation.';
