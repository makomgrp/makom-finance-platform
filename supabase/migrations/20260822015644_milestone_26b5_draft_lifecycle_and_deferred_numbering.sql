-- ============================================================================
-- MILESTONE 26B-5 — THE OFFICIAL NUMBER IS ISSUED ON SUBMISSION, NOT BEFORE
-- ============================================================================
--
-- An ODL application number is a promise to the customer and a permanent
-- operational reference. Until 26B-5 it was minted the moment the portal
-- promoted a lead — at STEP 1 — so every abandoned journey burned a number and
-- appeared in Solicitudes as though ODL had formally received an application.
-- Manual QA proved it: an applicant who stopped at Step 3, uploaded nothing and
-- never pressed "Enviar solicitud" already owned ODL-21AGO26-0002-N.
--
-- The aggregate itself was never the problem. Steps 2 and 3 legitimately need
-- somewhere to persist employment, collateral, requirement slots and evidence,
-- and all of that is already application-scoped. So the application row stays
-- exactly where it is and gains an explicit PRE-SUBMISSION state instead. No
-- parallel draft tables, no duplicated data model.
--
-- ----------------------------------------------------------------------------
-- THE INVARIANT
-- ----------------------------------------------------------------------------
--   status = 'draft'  <=>  application_number IS NULL
--
-- Written as a CHECK constraint rather than a convention, because "did this
-- application really get a number?" is the one question the whole lifecycle
-- turns on. A draft cannot acquire a number without leaving draft, and an
-- application cannot leave draft without acquiring one — in the same statement.
--
-- No placeholder identifiers. Nothing named TEMP-, DRAFT- or ODL-DRAFT ever
-- exists: a draft is identified internally by its UUID, which it already had.


-- ----------------------------------------------------------------------------
-- 1. A NUMBER IS NOW OPTIONAL — WHILE, AND ONLY WHILE, THE ROW IS A DRAFT
-- ----------------------------------------------------------------------------
alter table public.applications
  alter column application_number drop not null;


-- ----------------------------------------------------------------------------
-- 2. THE DRAFT STATE
-- ----------------------------------------------------------------------------
-- 'new' already means something specific and operational: ODL has the
-- application and nobody has triaged it yet. Reusing it for half-finished
-- portal journeys is exactly the conflation this milestone removes, so the
-- pre-submission state gets its own name.
alter table public.applications
  drop constraint if exists applications_status_check;

alter table public.applications
  add constraint applications_status_check
  check (status = any (array[
    'draft'::text,      -- portal journey in progress; not yet submitted to ODL
    'new'::text,        -- formally received, awaiting triage
    'in_review'::text,
    'approved'::text,
    'not_eligible'::text,
    'cancelled'::text
  ]));


-- ----------------------------------------------------------------------------
-- 3. THE "UNTOUCHED SINCE CREATION" PAIR CHECK NOW HAS TWO RESTING STATES
-- ----------------------------------------------------------------------------
-- The old rule was (status = 'new') = (status_changed_at IS NULL): a row is
-- 'new' precisely while nobody has moved it. 'draft' is the same kind of
-- resting state — created, never transitioned — so both must satisfy it, or a
-- draft would be unable to exist without a fabricated transition timestamp.
alter table public.applications
  drop constraint if exists applications_status_new_pair_check;

alter table public.applications
  add constraint applications_status_initial_pair_check
  check ((status = any (array['draft'::text, 'new'::text])) = (status_changed_at is null));


-- ----------------------------------------------------------------------------
-- 4. CORRECT THE EXISTING ROWS — FROM LIFECYCLE FACTS, NOT FROM NAMES
-- ----------------------------------------------------------------------------
-- Runs BEFORE the invariant is imposed, so the data is already consistent when
-- the constraint arrives.
--
-- The deciding fact is application_intakes.submitted_at. It is set by, and only
-- by, the 26B-4 submission service, in the same guarded UPDATE that makes
-- submission idempotent — so "this intake was never submitted" is recorded
-- evidence, not an inference. No applicant name, email or id appears anywhere
-- in this statement; a rule that hardcoded a person would be untestable and
-- would silently stop working on the next unfinished journey.
--
-- Deliberately narrow:
--   * joined to an intake  — a CRM-created application has none and is never
--                            a portal draft, whatever its status;
--   * submitted_at IS NULL — the journey never reached final submit;
--   * status = 'new'       — untouched since creation. An application a human
--                            has already moved on (in_review, approved,
--                            not_eligible, cancelled) is operational history
--                            and must not be rewound into a draft.
--
-- The released numbers are NOT reissued to these rows later; the sequence is
-- corrected separately and only when the database proves it is safe.
update public.applications a
   set application_number = null,
       status = 'draft'
  from public.application_intakes i
 where i.created_application_id = a.id
   and i.submitted_at is null
   and a.status = 'new'
   and a.application_number is not null;


-- ----------------------------------------------------------------------------
-- 5. THE INVARIANT ITSELF
-- ----------------------------------------------------------------------------
alter table public.applications
  drop constraint if exists applications_draft_number_pair_check;

alter table public.applications
  add constraint applications_draft_number_pair_check
  check ((application_number is null) = (status = 'draft'::text));

comment on column public.applications.application_number is
  'MILESTONE 26B-5. The official ODL reference, allocated exactly once, at '
  'formal submission. NULL while the row is a draft — enforced both ways by '
  'applications_draft_number_pair_check. Never a placeholder.';


-- ----------------------------------------------------------------------------
-- 6. THE INSERT TRIGGER NO LONGER NUMBERS DRAFTS
-- ----------------------------------------------------------------------------
-- Staff creating an application in the CRM are formally originating it, so that
-- path still gets its number at INSERT and is completely unchanged. A draft
-- asks for no number and is given none.
--
-- Still only fills a NULL, so a controlled data migration may supply an
-- explicit number without fighting the trigger.
create or replace function public.set_application_number()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $function$
begin
  if new.status is distinct from 'draft' and new.application_number is null then
    new.application_number := public.generate_application_number(new.product_id);
  end if;
  return new;
end;
$function$;

comment on function public.set_application_number() is
  'MILESTONE 26B-5. Allocates an official number on INSERT for formally '
  'originated applications only. A draft (status = ''draft'') is left unnumbered '
  'until submit_application() promotes it.';


-- ----------------------------------------------------------------------------
-- 7. FORMAL SUBMISSION — ONE STATEMENT, ONE NUMBER, ONE TRANSITION
-- ----------------------------------------------------------------------------
-- Everything that makes submission "formal" happens here, together, or not at
-- all. Allocating the number in application code and then updating the status
-- separately would leave a window in which a crash produced a numbered row that
-- nobody had submitted — precisely the class of defect this milestone exists to
-- remove.
--
-- CONCURRENCY. `for update` takes a row lock before anything is read. Of two
-- simultaneous submits, the second blocks until the first commits, then sees a
-- non-null number and returns it unchanged. The sequence is touched exactly
-- once, so a double submit cannot burn a number — and neither can a retry.
--
-- IDEMPOTENT BY THE SAME TEST that defines the invariant: a row that already
-- has a number is already submitted, so there is nothing left to do.
create or replace function public.submit_application(
  p_application_id uuid,
  p_source text
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_number  text;
  v_status  text;
  v_product uuid;
begin
  if p_source is null or p_source not in ('crm_manual','website_form','whatsapp','email','ai') then
    raise exception 'submit_application: invalid source %', p_source
      using errcode = '22023';
  end if;

  select application_number, status, product_id
    into v_number, v_status, v_product
    from public.applications
   where id = p_application_id
     for update;

  if not found then
    raise exception 'submit_application: application % does not exist', p_application_id
      using errcode = '23503';
  end if;

  -- Already carries a number: already submitted. Report the number it owns
  -- rather than issuing a second one.
  if v_number is not null then
    return v_number;
  end if;

  v_number := public.generate_application_number(v_product);

  update public.applications
     set application_number     = v_number,
         status                 = 'in_review',
         status_changed_at      = now(),
         status_changed_source  = p_source
   where id = p_application_id;

  return v_number;
end;
$function$;

comment on function public.submit_application(uuid, text) is
  'MILESTONE 26B-5. The formal submission boundary: locks the draft, allocates '
  'the official number exactly once, and transitions draft -> in_review in the '
  'same statement. Idempotent and concurrency-safe — a row that already has a '
  'number is returned unchanged, so retries and simultaneous submits never '
  'consume a second number.';

-- Same posture as generate_application_number (26A-1A): reachable from trusted
-- server code only. anon and authenticated must never be able to mint a number.
revoke all on function public.submit_application(uuid, text) from public;
revoke all on function public.submit_application(uuid, text) from anon;
revoke all on function public.submit_application(uuid, text) from authenticated;
grant execute on function public.submit_application(uuid, text) to service_role;
