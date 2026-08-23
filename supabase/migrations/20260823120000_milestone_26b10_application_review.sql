-- ============================================================================
-- MILESTONE 26B-10 — MANUAL REVIEW OF ONE LOAN APPLICATION
-- ============================================================================
--
-- A place for a human to work through an application and record what they
-- checked, what they found, and what they recommend. It decides nothing.
--
-- ----------------------------------------------------------------------------
-- WHY THIS IS NOT `application_analysis`
-- ----------------------------------------------------------------------------
-- That table already exists and is deliberately left alone. It models the
-- opposite thing: a MACHINE evaluating configured `loan_criteria` and emitting
-- a triage verdict (`ready_for_review`, `missing_information`, ...) with
-- `generated_by` / `generated_at`. It is also entirely dormant — zero criteria
-- configured, zero analyses, no Server Action and no UI.
--
-- Overloading it would collapse two different claims into one column: "a rule
-- engine computed this" and "a named person concluded this". Those must stay
-- distinguishable, which is the same reason 26B-9A kept auto_linked apart from
-- manual_linked. When the analysis engine is eventually switched on, its output
-- becomes an INPUT this reviewer reads — never a substitute for them.
--
-- ----------------------------------------------------------------------------
-- ONE REVIEW PER APPLICATION, NEVER PER CLIENT
-- ----------------------------------------------------------------------------
-- A returning customer holds several applications, each filed at a different
-- time against a different snapshot of their circumstances. Reviewing this
-- year's loan must not touch what somebody concluded about last year's, so the
-- review hangs off `application_id` with a UNIQUE constraint and never off
-- `client_id`.
--
-- ----------------------------------------------------------------------------
-- NO SCORE, NO WEIGHTS, NO AUTOMATIC ANYTHING
-- ----------------------------------------------------------------------------
-- There is no numeric column here, nothing is summed, and no status changes
-- itself. `recommendation` is written only by an authenticated person through a
-- capability-checked action, and it is NOT the application's status — the
-- decision remains a separate, separately-authorized act using the existing
-- application status machinery.
-- ============================================================================

create table if not exists public.application_reviews (
  id uuid primary key default gen_random_uuid(),

  -- UNIQUE: one review per application. A second row would mean two people
  -- holding different conclusions about the same file with no way to say which
  -- is current.
  application_id uuid not null unique
    references public.applications(id) on delete restrict,

  -- The review's OWN lifecycle, deliberately separate from the application's.
  -- Completing a review says the reviewer finished looking; it says nothing
  -- about whether ODL will lend.
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed')),

  reviewer_profile_id uuid references public.profiles(id) on delete restrict,
  started_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  completed_at            timestamptz,
  completed_by_profile_id uuid references public.profiles(id) on delete restrict,

  -- A HUMAN's recommendation. Never generated.
  recommendation text not null default 'pending'
    check (recommendation in (
      'pending', 'recommend_approval', 'recommend_rejection',
      'needs_more_information', 'escalate'
    )),
  recommendation_note       text,
  recommendation_at         timestamptz,
  recommendation_by_profile_id uuid references public.profiles(id) on delete restrict,

  created_at timestamptz not null default now(),

  -- Completion is attributable or it did not happen.
  constraint application_reviews_completion_pair_check check (
    (status = 'in_progress' and completed_at is null and completed_by_profile_id is null)
    or
    (status = 'completed' and completed_at is not null and completed_by_profile_id is not null)
  ),

  -- A recommendation other than 'pending' names who made it and when.
  constraint application_reviews_recommendation_pair_check check (
    recommendation = 'pending'
    or (recommendation_at is not null and recommendation_by_profile_id is not null)
  ),

  -- THE THREE THAT REQUIRE AN EXPLANATION. Recommending against a loan,
  -- asking for more information, or pushing a file up the chain are all
  -- statements someone downstream has to act on; an unexplained one is an
  -- instruction with no reason attached. Enforced here so no caller can skip it.
  constraint application_reviews_recommendation_note_check check (
    recommendation not in ('recommend_rejection', 'needs_more_information', 'escalate')
    or (recommendation_note is not null and length(btrim(recommendation_note)) > 0)
  )
);

create index if not exists application_reviews_status_idx
  on public.application_reviews (status);

-- ============================================================================
-- THE CHECKLIST
-- ============================================================================
--
-- Rows are keyed by a stable `item_code`, not by position or label, so the
-- catalogue in src/lib/config/application-review.ts can gain, reword or reorder
-- items without rewriting what a reviewer already concluded months ago.
--
-- FOUR STATES, BECAUSE A CHECKBOX LIES. A tick cannot distinguish "I looked and
-- it is fine" from "this does not apply to this product" from "I have not got
-- to it". Worse, it cannot express a PROBLEM at all — the reviewer would have
-- to leave it unticked, which reads as unfinished rather than as a finding.
--
-- AN ISSUE MUST BE EXPLAINED. `issue` without a note is a flag nobody can act
-- on, and it is exactly the state most likely to matter. The constraint is here
-- rather than only in the UI so it holds for every caller.
-- ============================================================================

create table if not exists public.application_review_items (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null
    references public.application_reviews(id) on delete cascade,

  section text not null
    check (section in ('identification', 'employment', 'income', 'documentation', 'compliance')),
  item_code text not null,

  state text not null default 'pending'
    check (state in ('pending', 'verified', 'issue', 'not_applicable')),
  note text,

  updated_by_profile_id uuid references public.profiles(id) on delete restrict,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),

  constraint application_review_items_unique_code unique (review_id, item_code),

  constraint application_review_items_issue_note_check check (
    state <> 'issue' or (note is not null and length(btrim(note)) > 0)
  )
);

create index if not exists application_review_items_review_idx
  on public.application_review_items (review_id);
-- Answers "what is unresolved?" without scanning every row.
create index if not exists application_review_items_open_idx
  on public.application_review_items (review_id, state)
  where state in ('pending', 'issue');

-- ============================================================================
-- OBSERVATIONS — APPEND ONLY
-- ============================================================================
--
-- What a reviewer noticed, in their own words, filed under a category.
--
-- NOT `dossier_notes`. That table is CLIENT-scoped — it has a `client_id` and
-- no application column — so putting application review findings in it would
-- attach this loan's concerns to the person permanently, and to every future
-- loan they ever apply for. The 26B-6C separation (client = current profile,
-- application = historical snapshot) is exactly what that would break.
--
-- There is no UPDATE path in the application layer and no delete grant: a
-- reviewer adds observations, and what they wrote earlier stays written.
-- ============================================================================

create table if not exists public.application_review_observations (
  id uuid primary key default gen_random_uuid(),
  review_id uuid not null
    references public.application_reviews(id) on delete cascade,

  category text not null
    check (category in ('general', 'identity', 'employment', 'income', 'documents', 'compliance')),
  body text not null check (length(btrim(body)) > 0),

  author_profile_id uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create index if not exists application_review_observations_review_idx
  on public.application_review_observations (review_id, created_at desc);

-- RLS on, zero policies — the project-wide posture. Every read and write goes
-- through server code holding the service role.
alter table public.application_reviews             enable row level security;
alter table public.application_review_items        enable row level security;
alter table public.application_review_observations enable row level security;

revoke all on public.application_reviews             from anon, authenticated;
revoke all on public.application_review_items        from anon, authenticated;
revoke all on public.application_review_observations from anon, authenticated;

-- SELECT, INSERT, UPDATE — and deliberately NOT DELETE, matching
-- application_follow_ups and the email tables. A review is operational history;
-- application code has no business destroying it, and withholding the privilege
-- is stronger than a convention. Observations additionally get no UPDATE path
-- in the service layer, so they are append-only in practice as well as intent.
grant select, insert, update on public.application_reviews             to service_role;
grant select, insert, update on public.application_review_items        to service_role;
grant select, insert         on public.application_review_observations to service_role;
