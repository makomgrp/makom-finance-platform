-- ============================================================================
-- MILESTONE 26A-4 — DECLARATIONS, DRAFT/RESUME STATE, CONTINUATION TOKENS
-- ============================================================================
--
-- The last backend foundation before a public portal UI can be built safely.
-- Three concerns, deliberately kept separate:
--
--   1. DRAFT/PROGRESS  — additive columns on application_intakes.
--   2. CONTINUATION     — public_application_tokens, a bearer credential that
--                         lets one applicant return to one intake.
--   3. DECLARATIONS     — application_declarations, structured PEP /
--                         source-of-funds / credit-consent answers.
--
-- WHAT THIS MIGRATION DOES NOT DO: it does not build portal pages, does not
-- touch the 26A-1 numbering machinery, does not alter 26A-2 semantics, does not
-- alter 26A-3 document rules, and does not move an application into the
-- internal review workflow. Those are later milestones and are left alone.
--
-- ----------------------------------------------------------------------------
-- LEAD IS NOT APPLICATION, AND THIS MIGRATION KEEPS IT THAT WAY
-- ----------------------------------------------------------------------------
-- application_intakes is the LEAD/DRAFT layer and owns the draft lifecycle.
-- applications is the FORMAL loan application and only exists once a product
-- has been selected — which is also the only thing that mints an official ODL
-- number (26A-1). Nothing below issues a number, and nothing below creates an
-- application. Issuing a continuation token does not create an application.
-- Resuming a draft does not create an application. That separation is the whole
-- reason the token binds to the INTAKE and reaches the application only through
-- application_intakes.created_application_id — one authoritative link, not two.


-- ============================================================================
-- 1. DRAFT / PROGRESS STATE ON application_intakes
-- ============================================================================
--
-- WHY THESE LIVE ON THE INTAKE AND NOT ON applications: a customer has a draft
-- before they have an application. Progress state on `applications` could not
-- describe the part of the journey that happens before a product is chosen,
-- and duplicating it in both places would create two answers to "where is this
-- customer?". The intake owns it for the whole journey.
--
-- current_step IS NOT intake.status. They answer different questions and are
-- deliberately not merged:
--
--   status        — what the INTAKE ENGINE (15B) did with this lead:
--                   received / client_matched / needs_review / processed.
--                   It is about automated processing, and staff read it.
--   current_step  — where the CUSTOMER last was in the portal.
--
-- current_step IS A BOOKMARK, NOT THE SOURCE OF TRUTH. Resume routing is
-- DERIVED from actual completion state (see src/lib/services/portal-progress.ts)
-- precisely so that a customer whose earlier answer became invalid is sent back
-- to fix it rather than forward past it. Storing a step and trusting it blindly
-- is how progress bars start lying.
--
-- NO PERCENTAGE COLUMN. A stored "73%" is a cache that silently goes stale the
-- moment a requirement is added, a conditional becomes relevant, or a document
-- is rejected. Progress is computed from the requirement slots and declarations
-- that already exist.

alter table public.application_intakes
  add column current_step text not null default 'applicant_data',
  add column last_activity_at timestamptz not null default now(),
  add column submitted_at timestamptz;

alter table public.application_intakes
  add constraint application_intakes_current_step_check
    check (current_step in (
      'applicant_data',   -- Step 1a: who the applicant is
      'loan_selection',   -- Step 1b: product/amount/term -> Application created
      'financial_data',   -- Step 2  (26A-2)
      'documents',        -- Step 3  (26A-3 requirements + declarations)
      'review'            -- final read-back before submission
    )),
  add constraint application_intakes_submitted_at_check
    check (submitted_at is null or submitted_at >= received_at);

comment on column public.application_intakes.current_step is
  'Bookmark of where the customer last was in the portal. NOT authoritative for '
  'resume routing — resolveFirstPendingStep() derives that from real completion '
  'state. Distinct from status, which describes intake-engine processing.';

comment on column public.application_intakes.last_activity_at is
  'Last time the customer CHANGED something. Deliberately not touched by reads, '
  'so it means "progress happened", not "a link was opened".';

comment on column public.application_intakes.submitted_at is
  'Set when the applicant finally submits. NULL means still a draft. The actual '
  'submit transition (and any internal-workflow routing) is a later milestone; '
  'this column is the state it will write.';

-- Finding the drafts that have gone quiet — the future "you left an application
-- unfinished" reminder, and staff follow-up.
create index application_intakes_open_drafts_idx
  on public.application_intakes (last_activity_at desc)
  where submitted_at is null;


-- ============================================================================
-- 2. public_application_tokens — THE CONTINUATION CREDENTIAL
-- ============================================================================
--
-- A customer must be able to come back to their application days later without
-- a username, a password, or a Supabase Auth account. That means a bearer
-- credential delivered by link. Bearer credentials are dangerous, so every
-- property below exists to bound the damage:
--
--   * THE RAW TOKEN IS NEVER STORED. Only its SHA-256 digest lands here. A
--     database dump, a backup, or a leaked SELECT yields hashes, and a hash
--     cannot be presented as a token.
--
--   * WHY SHA-256 AND NOT BCRYPT/ARGON2. Those exist to make GUESSING a
--     low-entropy human-chosen password expensive. This token is 256 bits of
--     CSPRNG output — there is no dictionary, and no amount of hashing speed
--     brings 2^256 into reach. A deliberately slow KDF would buy nothing and
--     would tax every single portal page load. This is the same reasoning
--     behind how API tokens are stored generally, and it holds only because
--     the token is machine-generated with full entropy — which the issuing
--     service enforces (see continuation-tokens.ts).
--
--   * THE TOKEN CARRIES NO MEANING. It is opaque random bytes. It does not
--     encode the intake id, the application id, an email, a cédula, or the
--     official application number — so the URL it travels in leaks nothing
--     even when it ends up in a browser history, a chat preview, or a referrer
--     header.
--
--   * SCOPE IS ONE INTAKE. There is no "all my applications" token. Resolving
--     a token yields exactly one application_intake_id, so cross-applicant
--     access is not a policy that could be misconfigured — it is unrepresentable.
--
--   * NOT A CRM CREDENTIAL. A token grants no role, no capability, and no
--     branch scope. It is not usable against any internal surface, and it is
--     emphatically not a path to service_role: the browser never holds a
--     Supabase key, it holds this opaque string, and only server-side code
--     exchanges it.

create table public.public_application_tokens (
  id uuid primary key default gen_random_uuid(),

  -- CASCADE: a token for a deleted intake is meaningless. In practice intakes
  -- are not deleted (service_role holds no DELETE anywhere in this schema);
  -- this is correctness insurance, not an expected path.
  application_intake_id uuid not null
    references public.application_intakes(id) on delete cascade,

  -- SHA-256 of the raw token, lowercase hex. Never the token itself.
  token_hash text not null,

  -- Closed set, currently one value. Section 30 of the milestone anticipates a
  -- future READ-ONLY post-submission status token; that is a DIFFERENT purpose
  -- with different rights, and this column is where it will be distinguished
  -- rather than overloading the continue token with a second meaning.
  purpose text not null default 'continue',

  expires_at timestamptz not null,

  revoked_at timestamptz,
  revoked_reason text,

  -- Observability, not authorization. Nothing is decided from these.
  last_used_at timestamptz,
  use_count integer not null default 0,

  created_at timestamptz not null default now(),

  -- The lookup key. UNIQUE also means a hash collision cannot silently map two
  -- tokens onto one intake.
  constraint public_application_tokens_token_hash_key unique (token_hash),

  -- Guards against a caller passing a raw token where a digest belongs — the
  -- single most damaging mistake possible against this table. A 43-character
  -- base64url token cannot satisfy this pattern.
  constraint public_application_tokens_token_hash_format_check
    check (token_hash ~ '^[0-9a-f]{64}$'),

  constraint public_application_tokens_purpose_check
    check (purpose in ('continue')),

  constraint public_application_tokens_expires_at_check
    check (expires_at > created_at),

  constraint public_application_tokens_use_count_check
    check (use_count >= 0),

  -- Revocation is a fact plus its reason, or neither.
  constraint public_application_tokens_revoked_pair_check
    check ((revoked_at is null) = (revoked_reason is null)),

  constraint public_application_tokens_revoked_reason_check
    check (revoked_reason is null or revoked_reason in (
      'rotated',        -- superseded by a newly issued token
      'submitted',      -- application submitted; editing is over
      'staff_revoked'   -- ODL revoked it deliberately
    ))
);

-- ROTATION POLICY: AT MOST ONE LIVE TOKEN PER INTAKE PER PURPOSE.
--
-- When a replacement is issued the previous token is REVOKED rather than left
-- valid until its own expiry. Chosen because it is both the safer and the
-- simpler model:
--   * safer — the reason a customer asks for a new link is often that the old
--     one went somewhere it should not have (forwarded mail, shared screen).
--     A policy that leaves the old link working for another two weeks defeats
--     the request.
--   * simpler — "is this link the live one?" has exactly one answer, so support
--     staff and logs never have to reason about which of several links a
--     customer is holding.
-- The cost is that an older email's link stops working. That is the intended,
-- explainable behaviour: the newest link is the one that works.
--
-- Enforced here as a DATABASE INVARIANT, not merely a service convention, so a
-- future second caller cannot quietly create a parallel live credential.
create unique index public_application_tokens_one_active_idx
  on public.public_application_tokens (application_intake_id, purpose)
  where revoked_at is null;

create index public_application_tokens_intake_idx
  on public.public_application_tokens (application_intake_id);

comment on table public.public_application_tokens is
  'Opaque bearer credentials letting one applicant resume one intake. Stores a '
  'SHA-256 digest, never the raw token. Grants no CRM role, capability or '
  'branch scope.';


-- ============================================================================
-- 3. application_declarations — STRUCTURED CONSENT, NOT PAPERWORK
-- ============================================================================
--
-- DECLARATIONS ARE NOT DOCUMENTS. A PEP answer is a fact ODL must be able to
-- QUERY ("show me every PEP applicant"), not a PDF someone has to open and
-- read. Modelling these as requirement slots with file uploads would have made
-- them invisible to compliance and would have abused the 26A-3 document model.
-- They may LATER generate a signed PDF as evidence; the structured answer stays
-- the source of truth either way.
--
-- ONE TABLE, TYPED COLUMNS, NOT A JSONB BLOB. The business-critical facts —
-- is_pep, source_of_funds_category, consent_granted — are real columns with
-- real CHECK constraints, so they are indexable and cannot drift into whatever
-- shape a caller felt like sending. `payload` exists only for supplemental
-- detail that has no compliance meaning yet. Three separate tables were
-- considered and rejected: they share every structural concern (application
-- binding, versioning, revision, acceptance timestamp) and would have
-- triplicated all of it.
--
-- BOUND TO THE APPLICATION, NOT THE INTAKE. Declarations are made in Step 3,
-- after product selection, so an application always exists by then. Binding to
-- the application also means a declaration is attached to the thing that was
-- actually underwritten.
--
-- ----------------------------------------------------------------------------
-- REVISION MODEL: APPEND-ONLY. NOTHING IS EVER OVERWRITTEN.
-- ----------------------------------------------------------------------------
-- If a customer changes an answer before submitting, a NEW ROW is inserted with
-- revision + 1. The previous row stays exactly as accepted. "Current" is the
-- highest revision per (application, type) — deterministic, with no
-- last-write-wins ambiguity and no timestamp tie to break.
--
-- This is enforced by WITHHELD PRIVILEGE, the same mechanism that makes
-- crm_events append-only: service_role is granted SELECT and nothing else, so
-- there is no UPDATE or DELETE path to misuse. Every write goes through
-- record_application_declaration() below. Consent wording that changes next
-- year therefore cannot retroactively rewrite what someone agreed to this year
-- — which is the entire point of keeping `version` alongside the answer.

create table public.application_declarations (
  id uuid primary key default gen_random_uuid(),

  -- RESTRICT, not CASCADE. Every other application-owned table in this schema
  -- restricts, and consent records especially must not evaporate as a side
  -- effect of deleting something else.
  application_id uuid not null
    references public.applications(id) on delete restrict,

  declaration_type text not null,

  -- The wording/schema version the applicant actually saw, e.g. 'pep.v1'.
  -- Stored per row so changing the text later cannot rewrite history.
  version text not null,

  -- 1-based, monotonic per (application, declaration_type). Assigned by
  -- record_application_declaration() under a lock, never by the caller.
  revision integer not null,

  -- ---- PEP ----------------------------------------------------------------
  is_pep boolean,
  pep_details text,

  -- ---- SOURCE OF FUNDS -----------------------------------------------------
  source_of_funds_category text,
  source_of_funds_description text,

  -- ---- CREDIT CONSULTATION CONSENT ----------------------------------------
  -- FALSE IS A REAL ANSWER, not a missing one. A customer who declines has
  -- answered; Step 3 simply does not complete. Storing the refusal is also the
  -- only way ODL can prove it never ran a check without permission.
  consent_granted boolean,

  -- Supplemental, non-authoritative detail only. Nothing compliance depends on
  -- may live here — if it matters, it earns a column.
  payload jsonb not null default '{}'::jsonb,

  accepted_at timestamptz not null,

  -- WHO performed the acceptance. A declaration accepted by staff on a phone
  -- call is a materially different evidentiary object from one the applicant
  -- clicked themselves, and collapsing them would hide that.
  accepted_via text not null,

  created_at timestamptz not null default now(),

  constraint application_declarations_revision_key
    unique (application_id, declaration_type, revision),

  constraint application_declarations_type_check
    check (declaration_type in (
      'pep',
      'source_of_funds',
      'credit_consultation_consent'
    )),

  constraint application_declarations_revision_check
    check (revision >= 1),

  constraint application_declarations_version_format_check
    check (version ~ '^[a-z_]+\.v[0-9]+$'),

  constraint application_declarations_accepted_via_check
    check (accepted_via in ('portal', 'crm_manual')),

  -- SOURCE-OF-FUNDS CATEGORIES ARE A PLACEHOLDER, NOT CONFIRMED ODL POLICY.
  -- ODL has not supplied an AML category list, and inventing a long one would
  -- be pretending a compliance decision was made. This is a deliberately small
  -- generic set with an 'other' escape hatch (which REQUIRES a description
  -- below), so no applicant is forced into a wrong bucket and nothing is
  -- misrepresented as approved policy. Widening a CHECK later is a one-line
  -- forward migration; un-inventing a fake policy is not.
  constraint application_declarations_sof_category_check
    check (source_of_funds_category is null or source_of_funds_category in (
      'salary',
      'business_income',
      'savings',
      'sale_of_asset',
      'other'
    )),

  -- Each type populates ITS OWN columns and leaves the others NULL, so a PEP
  -- row can never carry a stray consent flag that some future query counts.
  -- The `else false` arm means a declaration_type added to the type CHECK
  -- without being given a shape here is REJECTED rather than silently accepted
  -- with no shape at all.
  constraint application_declarations_type_shape_check check (
    case declaration_type
      when 'pep' then
        is_pep is not null
        and source_of_funds_category is null
        and source_of_funds_description is null
        and consent_granted is null
      when 'source_of_funds' then
        source_of_funds_category is not null
        and is_pep is null
        and pep_details is null
        and consent_granted is null
      when 'credit_consultation_consent' then
        consent_granted is not null
        and is_pep is null
        and pep_details is null
        and source_of_funds_category is null
        and source_of_funds_description is null
      else false
    end
  ),

  -- "Yes, I am a PEP" with no explanation is not a usable compliance answer.
  constraint application_declarations_pep_details_check
    check (
      declaration_type <> 'pep'
      or is_pep is not true
      or (pep_details is not null and length(btrim(pep_details)) > 0)
    ),

  -- 'other' without a description is exactly the uncategorised free text this
  -- controlled set exists to avoid.
  constraint application_declarations_sof_other_check
    check (
      declaration_type <> 'source_of_funds'
      or source_of_funds_category <> 'other'
      or (source_of_funds_description is not null
          and length(btrim(source_of_funds_description)) > 0)
    )
);

create index application_declarations_application_idx
  on public.application_declarations (application_id, declaration_type, revision desc);

-- Compliance's actual question: who declared themselves a PEP?
create index application_declarations_pep_idx
  on public.application_declarations (application_id)
  where is_pep;

comment on table public.application_declarations is
  'Structured PEP / source-of-funds / credit-consent answers. Append-only: a '
  'revision inserts a new row and never rewrites an earlier acceptance. '
  'Declarations are structured facts, not document uploads.';


-- ============================================================================
-- 4. TOKEN OPERATIONS — SECURITY DEFINER, BECAUSE THEY MUST BE ATOMIC
-- ============================================================================

-- ----------------------------------------------------------------------------
-- ISSUE — revoke the previous live token and create the replacement, together.
-- ----------------------------------------------------------------------------
-- Two statements that MUST NOT be separable: doing them from the service layer
-- would leave a window with zero live tokens (customer's link dead, replacement
-- not yet created) or two live tokens if the second failed.
--
-- TAKES A HASH, NEVER A RAW TOKEN. The raw value is generated and digested in
-- the Node process and is never sent to PostgreSQL, so it cannot surface in
-- statement logs, in pg_stat_statements, or in an error message.
create or replace function public.issue_public_application_token(
  p_intake_id uuid,
  p_token_hash text,
  p_expires_at timestamptz,
  p_purpose text default 'continue'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token_id uuid;
begin
  if not exists (select 1 from public.application_intakes where id = p_intake_id) then
    raise exception 'Intake % not found', p_intake_id
      using errcode = 'no_data_found';
  end if;

  -- Lock the intake so two concurrent issues cannot both pass the partial
  -- unique index check and race each other into a constraint violation.
  perform 1 from public.application_intakes where id = p_intake_id for update;

  update public.public_application_tokens
     set revoked_at = now(),
         revoked_reason = 'rotated'
   where application_intake_id = p_intake_id
     and purpose = p_purpose
     and revoked_at is null;

  insert into public.public_application_tokens
    (application_intake_id, token_hash, purpose, expires_at)
  values
    (p_intake_id, p_token_hash, p_purpose, p_expires_at)
  returning id into v_token_id;

  return v_token_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- REDEEM — validate and record the use in ONE statement.
-- ----------------------------------------------------------------------------
-- Read-then-write from the service layer would be a race (two tabs, one
-- expiring token) and would double the round trips on every portal page load.
--
-- WHY IT RETURNS A REASON RATHER THAN JUST NULL: an attacker submitting guessed
-- tokens always gets 'not_found', which tells them nothing. Only a caller who
-- ALREADY HOLDS a real 256-bit token can ever see 'expired' or 'revoked' — and
-- for that caller the distinction is the difference between a dead end and
-- "request a new link". Withholding it would degrade a legitimate customer's
-- experience while protecting nothing, because possessing the token is already
-- the hard part.
create or replace function public.redeem_public_application_token(
  p_token_hash text
)
returns table (
  outcome text,
  intake_id uuid,
  application_id uuid
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.public_application_tokens%rowtype;
begin
  select * into v_row
    from public.public_application_tokens
   where token_hash = p_token_hash
   for update;

  if not found then
    return query select 'not_found'::text, null::uuid, null::uuid;
    return;
  end if;

  if v_row.revoked_at is not null then
    return query select 'revoked'::text, null::uuid, null::uuid;
    return;
  end if;

  if v_row.expires_at <= now() then
    return query select 'expired'::text, null::uuid, null::uuid;
    return;
  end if;

  update public.public_application_tokens
     set last_used_at = now(),
         use_count = use_count + 1
   where id = v_row.id;

  -- The application is reached THROUGH the intake, never stored on the token.
  -- One authoritative link means the token cannot drift onto a different
  -- application than the intake it belongs to. NULL here is normal and correct:
  -- a lead that has not selected a product yet has no application.
  return query
    select 'valid'::text, i.id, i.created_application_id
      from public.application_intakes i
     where i.id = v_row.application_intake_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- REVOKE — kill the live token for an intake.
-- ----------------------------------------------------------------------------
-- Returns how many rows it revoked so a caller can distinguish "revoked it"
-- from "there was nothing live" without a second query.
create or replace function public.revoke_public_application_tokens(
  p_intake_id uuid,
  p_reason text,
  p_purpose text default 'continue'
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_count integer;
begin
  update public.public_application_tokens
     set revoked_at = now(),
         revoked_reason = p_reason
   where application_intake_id = p_intake_id
     and purpose = p_purpose
     and revoked_at is null;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;


-- ============================================================================
-- 5. DECLARATION WRITE — THE ONLY INSERT PATH
-- ============================================================================
--
-- service_role holds SELECT on application_declarations and nothing else, so
-- this function is not a convenience wrapper — it is the sole way a declaration
-- can ever be written. That is what makes the append-only guarantee structural
-- rather than a rule someone has to remember.
--
-- REVISION IS ASSIGNED HERE, NOT BY THE CALLER. Locking the parent application
-- row serialises declaration writes for that application, so two browser tabs
-- accepting at once produce revisions 1 and 2 rather than colliding or
-- silently overwriting.
create or replace function public.record_application_declaration(
  p_application_id uuid,
  p_declaration_type text,
  p_version text,
  p_accepted_via text,
  p_is_pep boolean default null,
  p_pep_details text default null,
  p_source_of_funds_category text default null,
  p_source_of_funds_description text default null,
  p_consent_granted boolean default null,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_revision integer;
begin
  -- Existence check and serialisation point in one. An application that does
  -- not exist cannot receive a declaration.
  perform 1 from public.applications where id = p_application_id for update;
  if not found then
    raise exception 'Application % not found', p_application_id
      using errcode = 'no_data_found';
  end if;

  select coalesce(max(revision), 0) + 1
    into v_revision
    from public.application_declarations
   where application_id = p_application_id
     and declaration_type = p_declaration_type;

  insert into public.application_declarations (
    application_id, declaration_type, version, revision,
    is_pep, pep_details,
    source_of_funds_category, source_of_funds_description,
    consent_granted, payload, accepted_at, accepted_via
  ) values (
    p_application_id, p_declaration_type, p_version, v_revision,
    p_is_pep, p_pep_details,
    p_source_of_funds_category, p_source_of_funds_description,
    p_consent_granted, coalesce(p_payload, '{}'::jsonb), now(), p_accepted_via
  )
  returning id into v_id;

  return v_id;
end;
$$;


-- ============================================================================
-- 6. RLS AND GRANTS
-- ============================================================================
--
-- RLS ON WITH ZERO POLICIES — the schema-wide posture since 25A. anon and
-- authenticated get no policy, so PostgREST denies them everything; service_role
-- bypasses RLS and is reached only from server-side code.
--
-- THE EXPLICIT REVOKE IS NOT DECORATION. Supabase's default privileges grant
-- table rights to anon and authenticated on newly created tables. Without these
-- REVOKEs the new tables would carry grants that RLS happens to neutralise —
-- defence resting on one layer instead of two. A public token must never imply
-- direct anonymous database access, and this is where that is guaranteed.

alter table public.public_application_tokens enable row level security;
alter table public.application_declarations enable row level security;

revoke all on public.public_application_tokens from anon, authenticated;
revoke all on public.application_declarations from anon, authenticated;

-- SELECT ONLY, ON BOTH. Every mutation goes through the SECURITY DEFINER
-- functions above. For declarations this is what makes them append-only. For
-- tokens it means revocation, rotation and use-counting cannot be bypassed or
-- partially applied by a future caller writing ad-hoc SQL.
grant select on public.public_application_tokens to service_role;
grant select on public.application_declarations to service_role;

-- Functions default to EXECUTE for PUBLIC; these are SECURITY DEFINER, so
-- leaving that in place would hand anon the ability to mint and redeem tokens.
revoke all on function public.issue_public_application_token(uuid, text, timestamptz, text) from public;
revoke all on function public.redeem_public_application_token(text) from public;
revoke all on function public.revoke_public_application_tokens(uuid, text, text) from public;
revoke all on function public.record_application_declaration(uuid, text, text, text, boolean, text, text, text, boolean, jsonb) from public;

grant execute on function public.issue_public_application_token(uuid, text, timestamptz, text) to service_role;
grant execute on function public.redeem_public_application_token(text) to service_role;
grant execute on function public.revoke_public_application_tokens(uuid, text, text) to service_role;
grant execute on function public.record_application_declaration(uuid, text, text, text, boolean, text, text, text, boolean, jsonb) to service_role;
