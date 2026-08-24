-- ============================================================================
-- MILESTONE 26B-17 — THE LANGUAGE AN APPLICANT WAS SPOKEN TO IN
-- ============================================================================
--
-- ODL now answers every formal application with a confirmation email, and that
-- email has to arrive in the language the applicant actually used. Until now
-- the only signal for that was the `NEXT_LOCALE` cookie, which is a property of
-- a browser session rather than of the application: it is gone the moment the
-- tab closes, and it never existed at all for the one-shot channel, where the
-- ODL website POSTs on the applicant's behalf.
--
-- Deciding a person's language from a cookie is fine while they are standing
-- there. It is not fine three days later when a staff member wants to resend
-- the confirmation, or when a second message has to go out about the same file.
-- So the choice is recorded next to the application it belongs to.
--
-- ----------------------------------------------------------------------------
-- WHY 'es' AND NOT NULL AS THE DEFAULT
-- ----------------------------------------------------------------------------
-- ODL operates in Panama and Spanish is the language of the business. A NULL
-- would push a decision onto every future reader — and readers that forget it
-- would silently pick whatever their own runtime prefers, which is precisely
-- the class of bug 26B-15A removed from date formatting. A NOT NULL column with
-- a Spanish default means "we know the answer, and absent evidence it is es".
--
-- ----------------------------------------------------------------------------
-- THE CHECK IS THE VOCABULARY
-- ----------------------------------------------------------------------------
-- The application supports exactly two locales, and `messages/es.json` and
-- `messages/en.json` are the whole of it. A row holding 'pt' or 'ES ' would not
-- fail here — it would fail much later, at compose time, in front of a customer
-- waiting for an email. Constraining the column keeps that impossible.
--
-- Existing rows all predate the portal's language capture and were all handled
-- in Spanish, so backfilling them with the default is accurate, not a guess.
-- ============================================================================

alter table public.application_intakes
  add column if not exists locale text not null default 'es';

-- Named explicitly rather than left to an inline constraint so the intent is
-- greppable and so a later migration can alter it by name if ODL ever adds a
-- third language.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.application_intakes'::regclass
      and conname = 'application_intakes_locale_check'
  ) then
    alter table public.application_intakes
      add constraint application_intakes_locale_check
      check (locale in ('es', 'en'));
  end if;
end $$;

comment on column public.application_intakes.locale is
  'Language the applicant used, for outbound communication. Captured from the '
  'portal session or the one-shot payload; never inferred from the reader''s '
  'runtime. See milestone 26B-17.';

-- No grant statement. `service_role` holds table-level INSERT/SELECT/UPDATE on
-- this table, so a new column is covered by the grants that already exist;
-- re-granting here would only add noise and a second place to keep in step.
