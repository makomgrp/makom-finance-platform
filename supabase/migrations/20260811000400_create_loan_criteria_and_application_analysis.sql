-- ============================================================================
-- Loan Criteria & Preliminary Recommendation Engine (Milestone 15E)
-- ============================================================================
--
-- Purpose: lets staff configure Product-specific loan criteria and lets a
-- deterministic, rules-based engine (TypeScript, built in a later
-- milestone — this migration is schema only) evaluate an Application
-- against them, producing a PRELIMINARY, INTERNAL recommendation.
--
-- ============================================================================
-- CRITICAL BOUNDARY — read before touching any of this
-- ============================================================================
-- This is NOT a final lending decision. It never approves or rejects a
-- loan, never determines final creditworthiness, and never substitutes
-- for human underwriting. Human review remains authoritative — see
-- application_analysis.reviewed_at/reviewed_by_profile_id/review_outcome
-- below, which record a human's separate judgment on top of the
-- machine's output, never the other way around. `recommendation` values
-- are deliberately never named "approved" or "rejected" (see
-- application_analysis_recommendation_check).
--
-- Three tables:
--   1. loan_criteria                        — Product-specific configuration
--   2. application_analysis                 — one immutable snapshot per
--                                              analysis run (the header)
--   3. application_analysis_criterion_results — one immutable row per
--                                              criterion evaluated in that run
--
-- Two functions:
--   1. create_application_analysis_snapshot — the ONLY way a row is ever
--      written to (2) or (3). A pure, atomic persistence boundary — it
--      contains ZERO lending-rule evaluation and ZERO recommendation
--      logic; every decision has already been made by TypeScript before
--      this is called. It exists solely because Supabase-JS's REST calls
--      each open their own implicit transaction — inserting a header row
--      and its child result rows as two separate calls could leave a
--      header with partial or no children if something failed mid-way.
--      This function makes that impossible: both inserts happen inside
--      one PL/pgSQL function body, which Postgres always executes as a
--      single atomic transaction — either the whole snapshot commits, or
--      none of it does. SECURITY DEFINER, because service_role
--      deliberately holds NO INSERT grant on (2) or (3) either (see
--      below) — this function must be the structurally ONLY path that
--      can ever write a machine-generated snapshot, not merely the
--      conventionally-used one. A direct INSERT grant alongside this
--      function would let ordinary service_role code insert a header
--      with zero/wrong children, or bypass the cross-Product guard
--      entirely — exactly what this function exists to prevent.
--   2. review_application_analysis — the ONLY way the four human-review
--      columns on (2) are ever set. SECURITY DEFINER, because
--      service_role deliberately holds no UPDATE grant on
--      application_analysis at all (see below) — the machine-generated
--      snapshot fields must be impossible to mutate through any normal
--      write path, not merely undocumented to touch.
--
-- ZERO CRITERIA CONFIGURED FOR A PRODUCT IS A DELIBERATE, VALID, COMPLETE
-- STATE — not an error, not a partial write. create_application_analysis_
-- snapshot happily persists a header with recommendation =
-- 'missing_configuration' and zero child rows; the two-insert function
-- body makes this exactly as atomic and complete as a run with 20 child
-- rows. This migration inserts NO criteria for any real ODL Product —
-- none of ODL's actual lending policy (minimum salary, age bounds,
-- amount/term bounds beyond the pre-existing generic database bounds,
-- employer rules, disqualifiers) is known yet, and none is invented
-- here. Every live Product will show missing_configuration immediately
-- after this migration, by design, until real values are supplied.
--
-- CRITERION-RESULT SNAPSHOTTING: application_analysis_criterion_results
-- copies the complete rule definition that produced each outcome
-- (criterion_type, field_source, field_source_detail, severity,
-- expected_value — not just the code/name) at evaluation time, not a
-- reference to the live loan_criteria row. This is deliberate: a later
-- edit to a criterion (or even deleting — impossible here, nothing in
-- this schema is ever hard-deleted, but disabling one) must never change
-- what a past analysis is understood to have evaluated. This is the same
-- "snapshot at execution time, not a reference to mutable config"
-- principle requirement_slots already applies to requirement_templates —
-- reused here rather than inventing a separate criteria-versioning
-- mechanism (effective_from/effective_to, a version integer). The
-- complete per-result snapshot makes that unnecessary for Phase 1: a
-- historical analysis is fully self-explanatory without ever consulting
-- the live loan_criteria table again.

-- ============================================================================
-- 1. loan_criteria
-- ============================================================================
--
-- Product-specific configuration, staff-editable — the same lifecycle
-- posture as products/requirement_templates (draft/active/inactive,
-- status_changed_at/by, never hard-deleted, only disabled).

create table if not exists public.loan_criteria (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  code text not null,
  name jsonb not null,
  description jsonb,
  criterion_type text not null,
  field_source text not null,
  field_source_detail text,
  expected_value jsonb not null,
  severity text not null,
  status text not null default 'draft',
  display_order integer not null default 10,
  status_changed_at timestamptz,
  status_changed_by_profile_id uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (product_id, code)
);

comment on table public.loan_criteria is
  'Product-specific configurable loan criteria (Milestone 15E). Staff-'
  'editable, never hard-deleted (see status). Historical explainability '
  'comes from application_analysis_criterion_results snapshotting the '
  'full rule definition at evaluation time, NOT from versioning this '
  'table — see this migration''s header comment. Zero rows are seeded by '
  'this migration; no ODL lending policy is known yet.';
comment on column public.loan_criteria.code is
  'Stable, staff-assigned identifier, unique within a Product — see '
  'unique(product_id, code) below. Mirrors products.code''s own '
  '"practically immutable by convention" posture.';
comment on column public.loan_criteria.criterion_type is
  'Closed vocabulary — see loan_criteria_criterion_type_check below. '
  'What KIND of comparison this criterion performs. Deliberately does '
  'not also carry a separate "operator" column: each type implies '
  'exactly one comparison (numeric_minimum implies >=, numeric_maximum '
  'implies <=, etc.), so a second field would be redundant.';
comment on column public.loan_criteria.field_source is
  'Closed vocabulary naming WHAT Application/Client/Requirement-Slot '
  'fact this criterion evaluates — see loan_criteria_field_source_check '
  'below. Never a raw expression: no eval, no stored SQL/JS, exactly '
  'per the Milestone 15E brief''s explicit instruction.';
comment on column public.loan_criteria.field_source_detail is
  'Required and non-empty ONLY when field_source = ''requirement_slot_'
  'status'' — the target RequirementTemplate.code within this '
  'criterion''s own Product (e.g. ''government_id''). NULL for every '
  'other field_source. See loan_criteria_field_source_detail_pair_check.';
comment on column public.loan_criteria.expected_value is
  'The configured threshold/value, shaped per criterion_type — see '
  'loan_criteria_expected_value_shape_check below. jsonb, not text: the '
  'vocabulary spans numbers, booleans, and string arrays, and a '
  'database-enforced shape guarantee is only practical with a typed '
  'JSON value, not a hand-parsed string.';
comment on column public.loan_criteria.severity is
  'hard (failure -> does_not_meet_basic_criteria), soft (failure -> '
  'manual_review_required), or informational (evaluated and reported, '
  'never affects the recommendation). See loan_criteria_severity_check.';
comment on column public.loan_criteria.status is
  'draft / active / inactive — identical vocabulary and lifecycle to '
  'products.status and requirement_templates.status. Only ''active'' '
  'criteria are evaluated by a future analysis run.';
comment on column public.loan_criteria.status_changed_at is
  'Mirrors products.status_changed_at exactly: null until the first '
  'status transition, set on every one thereafter. See '
  'loan_criteria_status_changed_pair_check below.';
comment on column public.loan_criteria.status_changed_by_profile_id is
  'Mirrors products.status_changed_by_profile_id exactly — the profile '
  'that performed the most recent transition, same lifecycle as '
  'status_changed_at. ON DELETE RESTRICT: a profile can never be hard-'
  'deleted while it is referenced as having changed a criterion''s status.';

-- criterion_type: the smallest useful generic vocabulary covering every
-- example named in the Milestone 15E brief. Age/salary/amount/term
-- boundaries are all just numeric_minimum/numeric_maximum against
-- different field_source values, not separate types.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'loan_criteria_criterion_type_check'
      and conrelid = 'public.loan_criteria'::regclass
  ) then
    alter table public.loan_criteria
      add constraint loan_criteria_criterion_type_check
      check (criterion_type in (
        'numeric_minimum',
        'numeric_maximum',
        'boolean_equals',
        'allowed_value_set',
        'required_field_present',
        'requirement_slot_status'
      ));
  end if;
end $$;

-- field_source: every Application/Client fact currently safe to evaluate
-- against, plus the one Requirement-Slot-status hook. client_restricted
-- maps to clients.restricted (a real, already-existing compliance
-- boolean) — added specifically to give boolean_equals a real field to
-- pair with; no employer/Company-derived field exists here, since the
-- Companies Engine is explicitly out of scope for this milestone.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'loan_criteria_field_source_check'
      and conrelid = 'public.loan_criteria'::regclass
  ) then
    alter table public.loan_criteria
      add constraint loan_criteria_field_source_check
      check (field_source in (
        'application_requested_amount',
        'application_requested_term_months',
        'client_monthly_salary',
        'client_age',
        'client_nationality',
        'client_identification_type',
        'client_restricted',
        'requirement_slot_status'
      ));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'loan_criteria_severity_check'
      and conrelid = 'public.loan_criteria'::regclass
  ) then
    alter table public.loan_criteria
      add constraint loan_criteria_severity_check
      check (severity in ('hard', 'soft', 'informational'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'loan_criteria_status_check'
      and conrelid = 'public.loan_criteria'::regclass
  ) then
    alter table public.loan_criteria
      add constraint loan_criteria_status_check
      check (status in ('draft', 'active', 'inactive'));
  end if;
end $$;

-- Same LOCALES('es','en') completeness discipline already applied to
-- products.name/short_description and requirement_templates.name/
-- description — name is required so both keys are mandatory;
-- description is nullable so the check only fires when it's present.
--
-- STRENGTHENED beyond the literal products/requirement_templates/
-- requirement_slots pattern (`name ? 'es' and name ? 'en'`, verified by
-- reading all three tables' real migrations — none of them additionally
-- check jsonb_typeof or the values' own type). The bare `?` operator
-- checks "top-level key OR ARRAY ELEMENT" — it does not prove the value
-- is a JSON object at all: a malformed array like '["es","en"]' would
-- satisfy `name ? 'es' and name ? 'en'` even though every consumer
-- expects a LocalizedText object, not an array. This migration closes
-- that gap: jsonb_typeof(name) = 'object' first rules out arrays/
-- scalars structurally, then the two `?` key-existence checks, then
-- jsonb_typeof(name -> 'es'/'en') = 'string' additionally rules out a
-- key present with a non-string value (e.g. {"es": 5}). No CASE
-- wrapping is needed here (unlike expected_value's shape check above):
-- ->, ?, and jsonb_typeof are all NULL/type-permissive operators that
-- never raise on the "wrong" input shape — they return NULL/false
-- instead — so a flat AND chain carries no error risk regardless of
-- evaluation order. Deliberately NOT extended to reject empty/
-- whitespace-only strings: the real products/requirement_templates/
-- requirement_slots convention does not do that either (confirmed by
-- grep — no jsonb_typeof or string-length check exists anywhere in
-- those three tables' locale constraints), so this preserves repository
-- consistency rather than inventing a stricter rule unique to this
-- migration. This same weaker-than-ideal pattern is a pre-existing,
-- schema-wide characteristic, not something introduced or perpetuated
-- newly here — see the accompanying flagged follow-up item.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'loan_criteria_name_locales_check'
      and conrelid = 'public.loan_criteria'::regclass
  ) then
    alter table public.loan_criteria
      add constraint loan_criteria_name_locales_check
      check (
        jsonb_typeof(name) = 'object'
        and name ? 'es'
        and name ? 'en'
        and jsonb_typeof(name -> 'es') = 'string'
        and jsonb_typeof(name -> 'en') = 'string'
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'loan_criteria_description_locales_check'
      and conrelid = 'public.loan_criteria'::regclass
  ) then
    alter table public.loan_criteria
      add constraint loan_criteria_description_locales_check
      check (
        description is null
        or (
          jsonb_typeof(description) = 'object'
          and description ? 'es'
          and description ? 'en'
          and jsonb_typeof(description -> 'es') = 'string'
          and jsonb_typeof(description -> 'en') = 'string'
        )
      );
  end if;
end $$;

-- field_source_detail must be non-null AND non-empty exactly when
-- field_source = 'requirement_slot_status', null for every other
-- field_source. length(trim(...)) > 0 rejects an empty/whitespace-only
-- string masquerading as "provided" — an empty string is not a
-- meaningful Requirement Slot code.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'loan_criteria_field_source_detail_pair_check'
      and conrelid = 'public.loan_criteria'::regclass
  ) then
    alter table public.loan_criteria
      add constraint loan_criteria_field_source_detail_pair_check
      check (
        (field_source = 'requirement_slot_status'
          and field_source_detail is not null
          and length(trim(field_source_detail)) > 0)
        or
        (field_source != 'requirement_slot_status' and field_source_detail is null)
      );
  end if;
end $$;

-- Valid (field_source, criterion_type) combinations only — see the
-- Milestone 15E Architecture V3 compatibility matrix. Rejects every
-- nonsensical pairing (e.g. client_age + boolean_equals,
-- requirement_slot_status + numeric_minimum) at the database level.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'loan_criteria_field_source_criterion_type_check'
      and conrelid = 'public.loan_criteria'::regclass
  ) then
    alter table public.loan_criteria
      add constraint loan_criteria_field_source_criterion_type_check
      check (
        (field_source in ('application_requested_amount', 'application_requested_term_months', 'client_monthly_salary')
          and criterion_type in ('numeric_minimum', 'numeric_maximum', 'required_field_present'))
        or (field_source = 'client_age' and criterion_type in ('numeric_minimum', 'numeric_maximum'))
        or (field_source in ('client_nationality', 'client_identification_type')
          and criterion_type in ('allowed_value_set', 'required_field_present'))
        or (field_source = 'client_restricted' and criterion_type = 'boolean_equals')
        or (field_source = 'requirement_slot_status' and criterion_type = 'requirement_slot_status')
      );
  end if;
end $$;

-- expected_value shape per criterion_type — see this migration's header
-- comment for why jsonb over text. requirement_slot_status's array
-- elements are restricted to the REAL, current RequirementSlotStatus
-- vocabulary (src/types/requirement-slot.ts) — re-read directly before
-- writing this, not approximated: pending, submitted, under_review,
-- satisfied, rejected, waived, missing. Widening this list later (if
-- that TypeScript vocabulary ever grows) is a single DROP CONSTRAINT +
-- ADD CONSTRAINT, this schema's established convention.
--
-- Array-element validation (allowed_value_set / requirement_slot_status)
-- uses jsonb_path_exists() with an SQL/JSON Path filter, NOT a
-- jsonb_array_elements()-based subquery: PostgreSQL CHECK constraints
-- cannot contain subqueries at all (a hard parser-level restriction, not
-- a style preference) — `not exists (select ... from
-- jsonb_array_elements(...) ...)` inside a CHECK would fail at migration
-- execution time. jsonb_path_exists(value, path) is a single, ordinary
-- (non-subquery) function call, exactly like jsonb_typeof/jsonb_array_
-- length already used throughout this migration, so it is legal here.
-- The path `$[*] ? (@.type() != "string")` matches any array element
-- whose JSON type isn't "string"; wrapping it in `not jsonb_path_exists`
-- means "no such element exists," i.e. every element is a string —
-- identical semantics to the subquery it replaces. The requirement_slot_
-- status variant additionally ORs in a value-membership test inside the
-- same filter predicate, so one function call still expresses both "not
-- a string" and "a string outside the 7-value vocabulary" as a single
-- disqualifying condition.
--
-- STRUCTURED AS A CASE, NOT A FLAT AND/OR CHAIN: PostgreSQL explicitly
-- documents that operand evaluation order for AND/OR is undefined and
-- must never be relied on to protect a later operand from an unsafe
-- earlier one — "no reliance should be placed on such evaluation order
-- avoiding an error condition" (Expression Evaluation Rules). That
-- matters here because jsonb_array_length() genuinely RAISES ("cannot
-- get array length of a non-array") when given a non-array jsonb value,
-- unlike jsonb_typeof/->/? which are permissive and never throw. A flat
-- `jsonb_typeof(expected_value) = 'array' and jsonb_array_length(...) >
-- 0` chain therefore has no structural guarantee the array_length call
-- is skipped for a non-array criterion_type = 'allowed_value_set' row —
-- only CASE WHEN branches are documented to evaluate strictly in order,
-- each guaranteed unreached unless its own condition (and every prior
-- WHEN's negation) holds. The outer CASE on criterion_type also means
-- jsonb_array_length/jsonb_path_exists are structurally unreachable for
-- every non-array criterion_type (numeric/boolean/required-field-
-- present rows never touch this branch at all), not merely guarded by a
-- same-expression AND.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'loan_criteria_expected_value_shape_check'
      and conrelid = 'public.loan_criteria'::regclass
  ) then
    alter table public.loan_criteria
      add constraint loan_criteria_expected_value_shape_check
      check (
        case criterion_type
          when 'numeric_minimum' then jsonb_typeof(expected_value) = 'number'
          when 'numeric_maximum' then jsonb_typeof(expected_value) = 'number'
          when 'boolean_equals' then jsonb_typeof(expected_value) = 'boolean'
          when 'required_field_present' then expected_value = 'true'::jsonb
          when 'allowed_value_set' then
            case
              when jsonb_typeof(expected_value) is distinct from 'array' then false
              when jsonb_array_length(expected_value) = 0 then false
              else not jsonb_path_exists(expected_value, '$[*] ? (@.type() != "string")')
            end
          when 'requirement_slot_status' then
            case
              when jsonb_typeof(expected_value) is distinct from 'array' then false
              when jsonb_array_length(expected_value) = 0 then false
              else not jsonb_path_exists(
                expected_value,
                '$[*] ? (@.type() != "string" || (@ != "pending" && @ != "submitted" && @ != "under_review" && @ != "satisfied" && @ != "rejected" && @ != "waived" && @ != "missing"))'
              )
            end
          else false
        end
      );
  end if;
end $$;

-- Mirrors products_status_changed_pair_check exactly.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'loan_criteria_status_changed_pair_check'
      and conrelid = 'public.loan_criteria'::regclass
  ) then
    alter table public.loan_criteria
      add constraint loan_criteria_status_changed_pair_check
      check ((status_changed_at is null) = (status_changed_by_profile_id is null));
  end if;
end $$;

-- The real query shape a future config service/analysis run needs:
-- "every active criterion for this Product." unique(product_id, code)
-- above already indexes that pair.
create index if not exists loan_criteria_product_id_status_idx
  on public.loan_criteria (product_id, status);

alter table public.loan_criteria enable row level security;

-- Select + insert + update — no delete. Same "never hard-delete, only
-- disable" posture as products/requirement_templates.
grant select, insert, update on public.loan_criteria to service_role;

-- ============================================================================
-- 2. application_analysis
-- ============================================================================
--
-- One row per analysis run — the immutable machine-generated header,
-- plus four nullable columns a human reviewer may append to exactly
-- once. See this migration's header comment and the grants section below
-- for how immutability of the machine fields is enforced structurally,
-- not just by convention.

create table if not exists public.application_analysis (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id) on delete restrict,
  recommendation text not null,
  generated_at timestamptz not null default now(),
  generated_by text not null,
  reviewed_at timestamptz,
  reviewed_by_profile_id uuid references public.profiles(id) on delete restrict,
  review_outcome text,
  review_notes text
);

comment on table public.application_analysis is
  'One immutable snapshot per Application-analysis run (Milestone 15E). '
  'PRELIMINARY, INTERNAL — never a final lending decision; see this '
  'migration''s header comment. recommendation/generated_at/generated_by '
  'are written exactly once, only by create_application_analysis_'
  'snapshot() (a SECURITY DEFINER function — see below), and are never '
  'updated again — service_role holds neither an INSERT nor an UPDATE '
  'grant on this table at all, so both the initial write path and its '
  'immutability afterward are enforced by the database, not merely by '
  'service-layer discipline. reviewed_at/reviewed_by_profile_id/'
  'review_outcome/review_notes are written exactly once, later, only by '
  'review_application_analysis() (also SECURITY DEFINER — see below) — '
  'a human''s separate judgment recorded alongside the machine''s '
  'output, never replacing it.';
comment on column public.application_analysis.recommendation is
  'Closed vocabulary — see application_analysis_recommendation_check '
  'below. Deliberately never "approved"/"rejected": this system does '
  'not make a final lending decision.';
comment on column public.application_analysis.generated_by is
  '''system'' for every automated analysis run today — mirrors '
  'automation_events.actor''s exact free-text convention rather than a '
  'profiles.id foreign key, for the same reason: no automated process '
  'is a real CRM profile.';
comment on column public.application_analysis.reviewed_at is
  'Null until a human reviews this analysis; set exactly once by '
  'review_application_analysis(). Mirrors dossier_documents.reviewed_at''s '
  '"immutable audit fact, not a status" posture.';
comment on column public.application_analysis.review_outcome is
  'confirmed (staff agrees with the machine recommendation) or '
  'overridden (staff disagrees — see review_notes for why). Null until '
  'reviewed. See application_analysis_review_outcome_check below. This '
  'is NOT a workflow/approval mechanism — it records a human''s '
  'judgment as a fact, once, nothing more.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_analysis_recommendation_check'
      and conrelid = 'public.application_analysis'::regclass
  ) then
    alter table public.application_analysis
      add constraint application_analysis_recommendation_check
      check (recommendation in (
        'ready_for_review',
        'missing_information',
        'does_not_meet_basic_criteria',
        'manual_review_required',
        'missing_configuration'
      ));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_analysis_review_outcome_check'
      and conrelid = 'public.application_analysis'::regclass
  ) then
    alter table public.application_analysis
      add constraint application_analysis_review_outcome_check
      check (review_outcome is null or review_outcome in ('confirmed', 'overridden'));
  end if;
end $$;

-- reviewed_at, reviewed_by_profile_id, and review_outcome are always all
-- three null (not yet reviewed) or all three set (a review genuinely
-- happened) — a single three-way bundle, tighter than three independent
-- pairings, so a partially-reviewed state can never exist.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_analysis_review_pair_check'
      and conrelid = 'public.application_analysis'::regclass
  ) then
    alter table public.application_analysis
      add constraint application_analysis_review_pair_check
      check (
        (reviewed_at is null and reviewed_by_profile_id is null and review_outcome is null)
        or
        (reviewed_at is not null and reviewed_by_profile_id is not null and review_outcome is not null)
      );
  end if;
end $$;

-- review_notes may only be present once a review has actually happened
-- — notes with no reviewed_at would be a structurally inconsistent
-- state (text describing a review that, per the columns above, never
-- occurred). A review WITH no notes (reviewed_at set, review_notes
-- null) remains entirely valid — a reviewer isn't required to write
-- anything.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_analysis_review_notes_check'
      and conrelid = 'public.application_analysis'::regclass
  ) then
    alter table public.application_analysis
      add constraint application_analysis_review_notes_check
      check (reviewed_at is not null or review_notes is null);
  end if;
end $$;

-- The two real query shapes: "the latest analysis for this Application"
-- and "the full analysis history for this Application."
create index if not exists application_analysis_application_id_generated_at_idx
  on public.application_analysis (application_id, generated_at desc);

alter table public.application_analysis enable row level security;

-- Select ONLY — deliberately NO insert grant and NO update grant.
-- Machine-generated snapshot fields must be impossible to write OR
-- mutate through any normal write path, not merely undocumented to
-- touch. The one legitimate write path (initial snapshot creation) is
-- performed exclusively through create_application_analysis_snapshot(),
-- and the one legitimate mutation (human review) exclusively through
-- review_application_analysis() — both SECURITY DEFINER functions that
-- run with their owner's elevated privileges specifically because
-- service_role itself cannot INSERT or UPDATE this table directly. See
-- both functions below.
grant select on public.application_analysis to service_role;

-- ============================================================================
-- 3. application_analysis_criterion_results
-- ============================================================================
--
-- One immutable row per criterion evaluated in one analysis run,
-- snapshotting the COMPLETE rule definition used (not just its code/
-- name) — see this migration's header comment for why.

create table if not exists public.application_analysis_criterion_results (
  id uuid primary key default gen_random_uuid(),
  application_analysis_id uuid not null references public.application_analysis(id) on delete restrict,
  loan_criteria_id uuid not null references public.loan_criteria(id) on delete restrict,
  criterion_code text not null,
  criterion_name jsonb not null,
  criterion_description jsonb,
  criterion_type text not null,
  field_source text not null,
  field_source_detail text,
  severity text not null,
  outcome text not null,
  actual_value jsonb,
  expected_value jsonb not null,
  reason_code text,
  display_order integer not null,
  unique (application_analysis_id, loan_criteria_id)
);

comment on table public.application_analysis_criterion_results is
  'One immutable per-criterion result row per application_analysis run '
  '(Milestone 15E). Snapshots the complete rule definition that was '
  'evaluated (criterion_type/field_source/field_source_detail/severity/'
  'expected_value), not merely a reference to the live loan_criteria '
  'row — a later edit to that row must never change what a past '
  'analysis is understood to have evaluated. See this migration''s '
  'header comment.';
comment on column public.application_analysis_criterion_results.loan_criteria_id is
  'Traceability/lineage FK only, like requirement_slots.'
  'requirement_template_id — the snapshotted columns on this row, not '
  'a live join to loan_criteria, are authoritative for what this result '
  'means. ON DELETE RESTRICT: loan_criteria rows are never hard-deleted '
  '(only disabled), so this never faces a dangling reference in '
  'practice.';
comment on column public.application_analysis_criterion_results.actual_value is
  'The observed value at evaluation time, shaped per criterion_type — '
  'see application_analysis_criterion_results_actual_value_shape_check '
  'below. Deliberately NOT the same shape as expected_value for every '
  'type (e.g. allowed_value_set''s expected_value is an array of '
  'acceptable values; its actual_value is the single string that was '
  'actually observed) — see this migration''s comment on that check. '
  'NULL exactly when outcome = ''unknown'' — see '
  'application_analysis_criterion_results_actual_value_presence_check.';
comment on column public.application_analysis_criterion_results.reason_code is
  'Closed, machine-readable vocabulary explaining a fail/unknown '
  'outcome — null for pass. See application_analysis_criterion_'
  'results_reason_code_check and _reason_code_compat_check below for '
  'the exact, closed per-criterion_type mapping.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_analysis_criterion_results_outcome_check'
      and conrelid = 'public.application_analysis_criterion_results'::regclass
  ) then
    alter table public.application_analysis_criterion_results
      add constraint application_analysis_criterion_results_outcome_check
      check (outcome in ('pass', 'fail', 'unknown'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_analysis_criterion_results_severity_check'
      and conrelid = 'public.application_analysis_criterion_results'::regclass
  ) then
    alter table public.application_analysis_criterion_results
      add constraint application_analysis_criterion_results_severity_check
      check (severity in ('hard', 'soft', 'informational'));
  end if;
end $$;

-- Same closed vocabulary as loan_criteria_criterion_type_check — the
-- snapshot must only ever contain a value the config table itself could
-- have produced.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_analysis_criterion_results_criterion_type_check'
      and conrelid = 'public.application_analysis_criterion_results'::regclass
  ) then
    alter table public.application_analysis_criterion_results
      add constraint application_analysis_criterion_results_criterion_type_check
      check (criterion_type in (
        'numeric_minimum',
        'numeric_maximum',
        'boolean_equals',
        'allowed_value_set',
        'required_field_present',
        'requirement_slot_status'
      ));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_analysis_criterion_results_field_source_check'
      and conrelid = 'public.application_analysis_criterion_results'::regclass
  ) then
    alter table public.application_analysis_criterion_results
      add constraint application_analysis_criterion_results_field_source_check
      check (field_source in (
        'application_requested_amount',
        'application_requested_term_months',
        'client_monthly_salary',
        'client_age',
        'client_nationality',
        'client_identification_type',
        'client_restricted',
        'requirement_slot_status'
      ));
  end if;
end $$;

-- Same object/string-shape strengthening as loan_criteria_name_locales_
-- check above (this column is a snapshot copy of loan_criteria.name at
-- evaluation time) — see that constraint's comment for the full
-- rationale: the bare `?` operator alone cannot distinguish an object
-- from an array, so jsonb_typeof(...) = 'object' plus per-key string-
-- type checks are added; no CASE wrapping needed since none of the
-- operators used here can raise on the "wrong" input shape.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_analysis_criterion_results_name_locales_check'
      and conrelid = 'public.application_analysis_criterion_results'::regclass
  ) then
    alter table public.application_analysis_criterion_results
      add constraint application_analysis_criterion_results_name_locales_check
      check (
        jsonb_typeof(criterion_name) = 'object'
        and criterion_name ? 'es'
        and criterion_name ? 'en'
        and jsonb_typeof(criterion_name -> 'es') = 'string'
        and jsonb_typeof(criterion_name -> 'en') = 'string'
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_analysis_criterion_results_description_locales_check'
      and conrelid = 'public.application_analysis_criterion_results'::regclass
  ) then
    alter table public.application_analysis_criterion_results
      add constraint application_analysis_criterion_results_description_locales_check
      check (
        criterion_description is null
        or (
          jsonb_typeof(criterion_description) = 'object'
          and criterion_description ? 'es'
          and criterion_description ? 'en'
          and jsonb_typeof(criterion_description -> 'es') = 'string'
          and jsonb_typeof(criterion_description -> 'en') = 'string'
        )
      );
  end if;
end $$;

-- Mirrors loan_criteria_field_source_detail_pair_check exactly.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_analysis_criterion_results_field_source_detail_pair_check'
      and conrelid = 'public.application_analysis_criterion_results'::regclass
  ) then
    alter table public.application_analysis_criterion_results
      add constraint application_analysis_criterion_results_field_source_detail_pair_check
      check (
        (field_source = 'requirement_slot_status'
          and field_source_detail is not null
          and length(trim(field_source_detail)) > 0)
        or
        (field_source != 'requirement_slot_status' and field_source_detail is null)
      );
  end if;
end $$;

-- Mirrors loan_criteria_field_source_criterion_type_check exactly — a
-- snapshot must structurally preserve the same (field_source,
-- criterion_type) compatibility guarantee the source config enforces,
-- so a corrupted/buggy snapshot could never combine a pairing that
-- could never have existed in loan_criteria (e.g. client_age +
-- boolean_equals).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_analysis_criterion_results_field_source_criterion_type_check'
      and conrelid = 'public.application_analysis_criterion_results'::regclass
  ) then
    alter table public.application_analysis_criterion_results
      add constraint application_analysis_criterion_results_field_source_criterion_type_check
      check (
        (field_source in ('application_requested_amount', 'application_requested_term_months', 'client_monthly_salary')
          and criterion_type in ('numeric_minimum', 'numeric_maximum', 'required_field_present'))
        or (field_source = 'client_age' and criterion_type in ('numeric_minimum', 'numeric_maximum'))
        or (field_source in ('client_nationality', 'client_identification_type')
          and criterion_type in ('allowed_value_set', 'required_field_present'))
        or (field_source = 'client_restricted' and criterion_type = 'boolean_equals')
        or (field_source = 'requirement_slot_status' and criterion_type = 'requirement_slot_status')
      );
  end if;
end $$;

-- expected_value shape — identical rules to loan_criteria_expected_
-- value_shape_check, since this column is a direct snapshot copy of
-- that one at evaluation time. Uses jsonb_path_exists(), not a
-- jsonb_array_elements()-based subquery, for the same reason documented
-- on loan_criteria_expected_value_shape_check above: PostgreSQL CHECK
-- constraints cannot contain subqueries at all. Structured as the same
-- CASE (not a flat AND/OR chain) as loan_criteria_expected_value_
-- shape_check, for the same reason: PostgreSQL does not guarantee
-- AND/OR operand evaluation order, and jsonb_array_length() genuinely
-- raises on a non-array input, so only CASE WHEN's documented
-- sequential evaluation can structurally guarantee it's unreached for a
-- non-array value.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_analysis_criterion_results_expected_value_shape_check'
      and conrelid = 'public.application_analysis_criterion_results'::regclass
  ) then
    alter table public.application_analysis_criterion_results
      add constraint application_analysis_criterion_results_expected_value_shape_check
      check (
        case criterion_type
          when 'numeric_minimum' then jsonb_typeof(expected_value) = 'number'
          when 'numeric_maximum' then jsonb_typeof(expected_value) = 'number'
          when 'boolean_equals' then jsonb_typeof(expected_value) = 'boolean'
          when 'required_field_present' then expected_value = 'true'::jsonb
          when 'allowed_value_set' then
            case
              when jsonb_typeof(expected_value) is distinct from 'array' then false
              when jsonb_array_length(expected_value) = 0 then false
              else not jsonb_path_exists(expected_value, '$[*] ? (@.type() != "string")')
            end
          when 'requirement_slot_status' then
            case
              when jsonb_typeof(expected_value) is distinct from 'array' then false
              when jsonb_array_length(expected_value) = 0 then false
              else not jsonb_path_exists(
                expected_value,
                '$[*] ? (@.type() != "string" || (@ != "pending" && @ != "submitted" && @ != "under_review" && @ != "satisfied" && @ != "rejected" && @ != "waived" && @ != "missing"))'
              )
            end
          else false
        end
      );
  end if;
end $$;

-- actual_value shape — DELIBERATELY DIFFERENT from expected_value's for
-- the two array-typed criterion_types: expected_value there is the
-- configured SET of acceptable values, while actual_value is the single
-- observed value, so it is a plain string, never an array. For
-- required_field_present, actual_value is a presence boolean (was the
-- field populated?), not the field's own raw value — see this
-- migration's comment on the actual_value column for why: a raw-scalar
-- representation would vary in JSON type by field_source even for the
-- same criterion_type, which a single jsonb_typeof check keyed only on
-- criterion_type could not cleanly express.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_analysis_criterion_results_actual_value_shape_check'
      and conrelid = 'public.application_analysis_criterion_results'::regclass
  ) then
    alter table public.application_analysis_criterion_results
      add constraint application_analysis_criterion_results_actual_value_shape_check
      check (
        actual_value is null
        or (criterion_type in ('numeric_minimum', 'numeric_maximum') and jsonb_typeof(actual_value) = 'number')
        or (criterion_type in ('boolean_equals', 'required_field_present') and jsonb_typeof(actual_value) = 'boolean')
        or (criterion_type = 'allowed_value_set' and jsonb_typeof(actual_value) = 'string')
        or (
          criterion_type = 'requirement_slot_status'
          and jsonb_typeof(actual_value) = 'string'
          and (actual_value #>> '{}') in
            ('pending', 'submitted', 'under_review', 'satisfied', 'rejected', 'waived', 'missing')
        )
      );
  end if;
end $$;

-- outcome = 'unknown' iff actual_value is null. Strengthened beyond the
-- brief's literal minimum ask ("unknown -> actual_value must be null")
-- to a full biconditional after auditing every field_source this
-- migration defines: application_requested_amount/term_months,
-- client_monthly_salary/age/nationality/identification_type/restricted
-- are all NOT NULL columns, and requirement_slot_status's only unknown
-- path (the slot doesn't exist on this Application) is the one place
-- actual_value is genuinely unreadable — so for every reachable Phase-1
-- case, pass/fail always has a real observed value and unknown never
-- does. Enforcing the full biconditional catches a future bug (a
-- pass/fail result accidentally written with a null actual_value)
-- rather than only ever checking the direction explicitly requested.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_analysis_criterion_results_actual_value_presence_check'
      and conrelid = 'public.application_analysis_criterion_results'::regclass
  ) then
    alter table public.application_analysis_criterion_results
      add constraint application_analysis_criterion_results_actual_value_presence_check
      check (
        (outcome = 'unknown' and actual_value is null)
        or (outcome != 'unknown' and actual_value is not null)
      );
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_analysis_criterion_results_reason_code_check'
      and conrelid = 'public.application_analysis_criterion_results'::regclass
  ) then
    alter table public.application_analysis_criterion_results
      add constraint application_analysis_criterion_results_reason_code_check
      check (reason_code is null or reason_code in (
        'below_minimum',
        'above_maximum',
        'value_not_in_allowed_set',
        'boolean_mismatch',
        'field_missing',
        'requirement_slot_not_satisfied',
        'requirement_slot_unknown'
      ));
  end if;
end $$;

-- outcome = 'pass' iff reason_code is null; fail/unknown always require
-- one.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_analysis_criterion_results_reason_pair_check'
      and conrelid = 'public.application_analysis_criterion_results'::regclass
  ) then
    alter table public.application_analysis_criterion_results
      add constraint application_analysis_criterion_results_reason_pair_check
      check ((outcome = 'pass') = (reason_code is null));
  end if;
end $$;

-- reason_code must be the ONE (or, for requirement_slot_status, one of
-- the two) value(s) that criterion_type could actually have produced —
-- e.g. a numeric_minimum failure can only ever be reason_code =
-- 'below_minimum', never 'boolean_mismatch'. Prevents a nonsensical
-- criterion_type/reason_code combination from ever being stored.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_analysis_criterion_results_reason_code_compat_check'
      and conrelid = 'public.application_analysis_criterion_results'::regclass
  ) then
    alter table public.application_analysis_criterion_results
      add constraint application_analysis_criterion_results_reason_code_compat_check
      check (
        reason_code is null
        or (criterion_type = 'numeric_minimum' and reason_code = 'below_minimum')
        or (criterion_type = 'numeric_maximum' and reason_code = 'above_maximum')
        or (criterion_type = 'boolean_equals' and reason_code = 'boolean_mismatch')
        or (criterion_type = 'allowed_value_set' and reason_code = 'value_not_in_allowed_set')
        or (criterion_type = 'required_field_present' and reason_code = 'field_missing')
        or (criterion_type = 'requirement_slot_status'
          and reason_code in ('requirement_slot_not_satisfied', 'requirement_slot_unknown'))
      );
  end if;
end $$;

-- reason_code must also be compatible with outcome specifically, not
-- just criterion_type: 'requirement_slot_unknown' is the one reason_code
-- that means "we could not determine this" (the slot doesn't exist),
-- so it may only ever pair with outcome = 'unknown'; every other reason_
-- code is a definite, known negative determination and may only pair
-- with outcome = 'fail'. Without this, a row like outcome = 'unknown'
-- with reason_code = 'below_minimum' would otherwise pass every other
-- constraint in this table despite being nonsensical (below_minimum
-- implies the actual value was read and compared; 'unknown' means it
-- wasn't).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_analysis_criterion_results_reason_outcome_compat_check'
      and conrelid = 'public.application_analysis_criterion_results'::regclass
  ) then
    alter table public.application_analysis_criterion_results
      add constraint application_analysis_criterion_results_reason_outcome_compat_check
      check (
        reason_code is null
        or (reason_code = 'requirement_slot_unknown' and outcome = 'unknown')
        or (reason_code != 'requirement_slot_unknown' and outcome = 'fail')
      );
  end if;
end $$;

-- The one real query shape: "every result row for this analysis run,"
-- to reconstruct a full historical explanation.
create index if not exists application_analysis_criterion_results_application_analysis_id_idx
  on public.application_analysis_criterion_results (application_analysis_id);

alter table public.application_analysis_criterion_results enable row level security;

-- Select ONLY — no insert, no update, no delete. An immutable per-
-- criterion audit fact, the same strictest posture already applied to
-- automation_events, strengthened further: there is no legitimate direct
-- write path at all, by design, not by omission. The sole way a row is
-- ever written here is inside create_application_analysis_snapshot()
-- below (SECURITY DEFINER), alongside its application_analysis header,
-- as one atomic transaction.
grant select on public.application_analysis_criterion_results to service_role;

-- ============================================================================
-- 4. create_application_analysis_snapshot(...)
-- ============================================================================
--
-- The ONLY code path that ever writes to application_analysis or
-- application_analysis_criterion_results. Pure, atomic persistence —
-- ZERO lending-rule evaluation, ZERO recommendation calculation, ZERO
-- business-policy interpretation. Every value it writes has already
-- been computed, in typed TypeScript, by the time this is called; this
-- function's only job is making the multi-row, multi-table write
-- atomic, which no sequence of separate Supabase-JS REST calls could
-- guarantee (see this migration's header comment).
--
-- SECURITY DEFINER is required, not merely chosen: service_role holds
-- NEITHER an INSERT grant on application_analysis NOR on application_
-- analysis_criterion_results (see both tables' grants above) — a
-- structural choice, not an oversight, made specifically so this
-- function is the ONLY possible write path, not merely the
-- conventionally-used one. Without DEFINER, this function's own INSERT
-- statements would fail with a permission error for the very role
-- that's meant to call it — the identical reasoning already applied to
-- review_application_analysis() below, extended here to the initial
-- write as well as the later human-review update.
--
-- Risk controls (mirroring review_application_analysis()'s posture):
--   - set search_path = public, pg_temp: matches this repository's own
--     established convention for exactly this class of function — see
--     find_or_create_direct_conversation's migration (20260808060252),
--     whose own comment states this exact clause "is standard defense-
--     in-depth for any plpgsql function regardless of definer/invoker."
--     The reason it must be `public, pg_temp` and not merely `public`:
--     Postgres always implicitly searches the caller's temporary-table
--     schema (pg_temp_NNN) FIRST, before any schema named in search_path
--     — UNLESS pg_temp is itself explicitly listed, in which case it is
--     searched at that explicit position instead. Leaving pg_temp
--     unlisted is the actual documented SECURITY DEFINER hazard: it
--     would let any session's own temp objects shadow an unqualified
--     identifier ahead of `public`, regardless of this SET clause.
--     Listing `public, pg_temp` explicitly closes that gap. (pg_catalog
--     needs no explicit mention: Postgres always implicitly searches it
--     first when it is not itself named, so it is already effectively
--     ahead of `public` here — no built-in function this body calls
--     unqualified, e.g. gen_random_uuid()/jsonb_array_length(), is at
--     risk of being shadowed by anything in the public schema.) Every
--     table reference in this function body is additionally fully-
--     qualified (public.application_analysis, public.application_
--     analysis_criterion_results, public.loan_criteria, public.
--     applications) as defense in depth on top of the fixed search_path.
--   - No dynamic SQL anywhere in this function — every statement is
--     static, parameterized PL/pgSQL. No caller-controlled identifiers
--     (table/column names) are ever interpolated into a query string.
--   - Writes ONLY to the two tables named above — no other table is
--     referenced in an INSERT/UPDATE/DELETE anywhere in this body.
--   - INSERT only, never UPDATE or DELETE, on either table — matching
--     exactly what each table's own grant comment documents as the sole
--     legitimate machine-write operation.
--   - Every table's own CHECK/FK constraints (defined above) still
--     validate every inserted row exactly as they would for any other
--     write — this function performs zero duplicate validation logic;
--     it relies entirely on those constraints plus its own explicit
--     cross-Product guard below.
--   - The cross-Product guard and unique(application_analysis_id,
--     loan_criteria_id) duplicate-protection (both below) are preserved
--     unchanged from the original design — this security-mode change
--     alters only WHO may call this function, never WHAT it validates.
create or replace function public.create_application_analysis_snapshot(
  p_application_id uuid,
  p_recommendation text,
  p_generated_by text,
  p_criterion_results jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_analysis_id uuid;
  v_expected_count integer;
  v_matching_count integer;
begin
  -- Responsibility 1: the payload must genuinely be a JSON array. An
  -- explicit guard here (rather than relying only on jsonb_array_elements
  -- erroring on bad input) also protects the count-based guard just
  -- below, which would otherwise silently no-op on a SQL NULL input
  -- (NULL != count evaluates to NULL, never TRUE).
  if p_criterion_results is null or jsonb_typeof(p_criterion_results) != 'array' then
    raise exception 'create_application_analysis_snapshot: p_criterion_results must be a JSON array';
  end if;

  -- Responsibility 2: cross-Product referential integrity. Every
  -- loan_criteria_id in the payload must both exist AND belong to the
  -- same Product as this Application. An explicit count comparison
  -- (rather than relying solely on the downstream FK/insert to fail)
  -- gives a clear, specific error message for either failure mode — a
  -- nonexistent loan_criteria_id and a wrong-Product loan_criteria_id
  -- both simply fail to appear in the matching-rows count. This is
  -- still pure referential-integrity counting, not rule evaluation.
  select jsonb_array_length(p_criterion_results) into v_expected_count;

  select count(*) into v_matching_count
  from jsonb_array_elements(p_criterion_results) as elem
  join public.loan_criteria lc on lc.id = (elem->>'loanCriteriaId')::uuid
  join public.applications a on a.id = p_application_id
  where lc.product_id = a.product_id;

  if v_matching_count != v_expected_count then
    raise exception
      'create_application_analysis_snapshot: one or more loan_criteria_id values do not exist or do not belong to the Application''s Product (expected % matching rows, found %)',
      v_expected_count, v_matching_count;
  end if;

  -- Responsibility 3: insert the header. recommendation = ''
  -- missing_configuration'' with an empty p_criterion_results array is
  -- exactly as valid and complete a call as any other — jsonb_array_
  -- length('[]'::jsonb) = 0 = v_matching_count, the guard above passes
  -- trivially, and the INSERT...SELECT below simply produces zero rows.
  insert into public.application_analysis (application_id, recommendation, generated_by)
  values (p_application_id, p_recommendation, p_generated_by)
  returning id into v_analysis_id;

  -- Responsibility 4: insert every criterion result row. One INSERT ...
  -- SELECT ... FROM jsonb_array_elements — table-level CHECK constraints
  -- (outcome/severity/criterion_type/field_source/shape/reason_code
  -- vocabularies, all defined above) apply to this insert exactly as
  -- they would to any other, so malformed elements are rejected by the
  -- tables themselves, not reinterpreted here. unique(application_
  -- analysis_id, loan_criteria_id) rejects a duplicate loan_criteria_id
  -- within one payload, aborting this entire function call — both
  -- inserts above roll back together, since this is all one PL/pgSQL
  -- function body and therefore one Postgres transaction.
  insert into public.application_analysis_criterion_results (
    application_analysis_id, loan_criteria_id, criterion_code, criterion_name, criterion_description,
    criterion_type, field_source, field_source_detail, severity, outcome, actual_value, expected_value,
    reason_code, display_order
  )
  select
    v_analysis_id,
    (elem->>'loanCriteriaId')::uuid,
    elem->>'criterionCode',
    elem->'criterionName',
    elem->'criterionDescription',
    elem->>'criterionType',
    elem->>'fieldSource',
    elem->>'fieldSourceDetail',
    elem->>'severity',
    elem->>'outcome',
    elem->'actualValue',
    elem->'expectedValue',
    elem->>'reasonCode',
    (elem->>'displayOrder')::integer
  from jsonb_array_elements(p_criterion_results) as elem;

  -- Responsibility 5: return the new analysis id.
  return v_analysis_id;
end;
$$;

comment on function public.create_application_analysis_snapshot(uuid, text, text, jsonb) is
  'The sole write path for application_analysis and application_'
  'analysis_criterion_results (Milestone 15E). Pure atomic persistence '
  '— zero lending-rule evaluation. SECURITY DEFINER because service_'
  'role holds no INSERT grant on either table at all — see this '
  'function''s own comment above and the Milestone 15E implementation '
  'report''s function-ownership finding.';

revoke all on function public.create_application_analysis_snapshot(uuid, text, text, jsonb) from public;
grant execute on function public.create_application_analysis_snapshot(uuid, text, text, jsonb) to service_role;

-- ============================================================================
-- 5. review_application_analysis(...)
-- ============================================================================
--
-- The ONLY code path that ever writes reviewed_at/reviewed_by_profile_id/
-- review_outcome/review_notes on application_analysis. The highest-
-- sensitivity object in this migration.
--
-- SECURITY DEFINER is required, not merely chosen: service_role holds
-- NO update grant on application_analysis at all (see the table's own
-- grant above), so without DEFINER this function's own UPDATE statement
-- would fail with a permission error for the very role that's meant to
-- call it. DEFINER makes the function execute with its OWNER's
-- privileges instead of the caller's — see the "function ownership"
-- note in this migration's implementation report for exactly which role
-- that is and why no ALTER FUNCTION ... OWNER TO ... statement is
-- needed here.
--
-- Risk controls:
--   - set search_path = public, pg_temp: matches this repository's own
--     established convention (see find_or_create_direct_conversation's
--     migration, 20260808060252) and closes the same gap documented on
--     create_application_analysis_snapshot above — a fixed search_path
--     is mandatory practice for SECURITY DEFINER functions, but leaving
--     pg_temp unlisted does NOT protect against it: Postgres always
--     implicitly searches the caller's own temp-table schema FIRST
--     unless pg_temp is itself given an explicit, later position in
--     search_path, which is what this clause now does. Every reference
--     in this function body is additionally fully-qualified (public.
--     application_analysis) as defense in depth on top of the fixed
--     search_path.
--   - No dynamic SQL anywhere in this function — every statement is
--     static, parameterized PL/pgSQL. No caller-controlled identifiers
--     (table/column names) are ever interpolated into a query string.
--   - Updates ONLY the four review columns — enforced by the UPDATE
--     statement's own SET clause, not a promise elsewhere.
--   - application_analysis_review_outcome_check (defined above) still
--     validates p_review_outcome on this UPDATE exactly as it would on
--     any other write — CHECK constraints are enforced by the table
--     itself regardless of which role or privilege level performed the
--     write, so no duplicate validation is needed inside this function.
--   - reviewed_by_profile_id's own FK constraint (defined above)
--     validates the actor profile actually exists.
--   - Guarded, race-safe, one-time-only: the UPDATE's WHERE clause
--     requires reviewed_at IS NULL, the same idiom used throughout this
--     schema (e.g. reviewDocumentEvidence) — a concurrent second review
--     attempt matches zero rows and this function returns NULL rather
--     than overwriting the first review.
--   - No general update capability: this function cannot be used to
--     change recommendation/generated_at/generated_by/application_id —
--     they are absent from both its parameter list and its SET clause.
create or replace function public.review_application_analysis(
  p_analysis_id uuid,
  p_actor_profile_id uuid,
  p_review_outcome text,
  p_review_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated_id uuid;
begin
  update public.application_analysis
  set reviewed_at = now(),
      reviewed_by_profile_id = p_actor_profile_id,
      review_outcome = p_review_outcome,
      review_notes = p_review_notes
  where id = p_analysis_id
    and reviewed_at is null
  returning id into v_updated_id;

  -- NULL means: no row with this id exists, or it was already reviewed
  -- (both collapse to the same safe "nothing was changed" outcome — the
  -- caller distinguishes NOT_FOUND from ALREADY_REVIEWED with an
  -- ordinary, unprivileged SELECT beforehand, the same idiom already
  -- used throughout this schema's other guarded-update functions).
  return v_updated_id;
end;
$$;

comment on function public.review_application_analysis(uuid, uuid, text, text) is
  'The sole write path for application_analysis''s four human-review '
  'columns (Milestone 15E). SECURITY DEFINER because service_role holds '
  'no UPDATE grant on application_analysis at all — see this function''s '
  'own comment above and the Milestone 15E implementation report''s '
  'function-ownership finding.';

revoke all on function public.review_application_analysis(uuid, uuid, text, text) from public;
grant execute on function public.review_application_analysis(uuid, uuid, text, text) to service_role;
