-- ============================================================================
-- application_intakes
-- ============================================================================
--
-- Purpose: the canonical, channel-neutral landing zone for every inbound
-- loan-application signal — website, WhatsApp, email, CRM manual entry,
-- and future AI-assisted intake all converge into exactly this one table
-- (Milestone 15B — see the Milestone 15A architecture review's "Proposed
-- Canonical Intake Pipeline" section). No channel gets its own table;
-- channel-specific work is confined to a future adapter that normalizes
-- raw channel input into a row here, never to a parallel schema.
--
-- This migration builds the foundation ONLY: the table, its constraints,
-- and its indexes. No external channel is connected by this migration —
-- no website endpoint, no WhatsApp webhook, no mailbox exists yet. Rows
-- in this table today can only be inserted by a server-only service
-- (src/lib/services/application-intakes.ts) called from trusted code —
-- see the RLS/grants section below.
--
-- STATUS LIFECYCLE (deliberately the smallest correct model for this
-- milestone — see the Milestone 15B brief's own instruction to "evaluate
-- whether all seven [candidate statuses] are necessary" and "prefer the
-- smallest correct lifecycle"):
--
--   received        - the row exists, nothing has processed it yet (the
--                      column DEFAULT; every intake starts here)
--   client_matched   - Client identity has been resolved (matched_client_id
--                      is now set) but the Application has not been
--                      created yet — a genuine, useful checkpoint: see
--                      this migration's application_intakes_created_
--                      application_id_pair_check comment and the
--                      Milestone 15B implementation report's concurrency
--                      section for why this state earns its place rather
--                      than being collapsed away
--   needs_review     - the automated pipeline could not safely proceed
--                      (ambiguous Client match, missing required Client
--                      fields, unresolvable Product, missing required
--                      Application fields) and a human must look at this;
--                      review_reason records exactly why
--   processed        - a real Application was created (created_
--                      application_id is now set) — the pipeline's
--                      successful terminal state
--
-- Two candidate statuses named in the Milestone 15B brief are
-- DELIBERATELY EXCLUDED from this migration's CHECK constraint:
--   - documents_pending: this milestone builds zero document-intake
--     logic (staged uploads, classification, Evidence creation are all
--     explicitly Milestone 15D's scope) — including a status no code
--     path in 15B could ever produce would be exactly the "complicated
--     workflow engine" the brief warns against building prematurely.
--   - rejected: reachable only via a future staff decision made against
--     a needs_review intake — that decision requires a UI/Server Action
--     this milestone explicitly does not build.
-- Both are straightforward, additive future widenings of
-- application_intakes_status_check via the exact same drop-and-re-add
-- pattern this schema already uses repeatedly (see
-- 20260811000000_add_email_to_source_vocabularies.sql, itself modeled on
-- 20260809170000_extend_dossier_documents_uploaded_source_check.sql) —
-- never a reason to over-build the vocabulary now.
--
-- Legal transitions (enforced at the service layer, not by a DB CHECK —
-- this table's status graph is simple enough that the same
-- guarded-UPDATE idiom used throughout this schema, see e.g.
-- src/lib/services/applications.ts#setApplicationStatus, is sufficient
-- without needing a transitions-table precedent like
-- APPLICATION_STATUS_TRANSITIONS; see src/lib/config/application-intake.ts):
--   received       -> client_matched | needs_review
--   client_matched -> processed | needs_review
--   (processed and needs_review are terminal within this milestone's scope)
--
-- CHANNEL is deliberately the exact same five-value vocabulary as
-- ApplicationSource (src/types/application.ts) — not a redefined or
-- narrower one — per this migration's sibling
-- (20260811000000_add_email_to_source_vocabularies.sql) and the
-- Milestone 15B brief's explicit instruction not to invent a duplicate
-- TypeScript vocabulary where the canonical one already fits.
--
-- SUBMISSION_ID / IDEMPOTENCY: nullable, because CRM-manual and other
-- internally-originated intakes genuinely have no external submission
-- identifier to preserve — this column is never fabricated for those
-- rows (see this migration's unique constraint comment below for the
-- exact null-handling semantics this depends on).
--
-- RAW_PAYLOAD SECURITY: this column exists purely as an audit/replay
-- mechanism for whatever a channel adapter normalized before calling
-- createApplicationIntake — it must NEVER contain secrets, API keys,
-- webhook signatures, or authorization headers. This is a contract
-- enforced by every future channel adapter, not by this table; see
-- src/lib/services/application-intakes.ts's own module doc comment for
-- where this is restated as the service-layer boundary.
--
-- Nothing here is fabricated Client data. This table only ever stores
-- what a channel actually supplied — see the Milestone 15B implementation
-- report's "New-Client creation rules" section for how the processing
-- pipeline treats a Client field it cannot find here.
--
-- APPLICANT_BIRTH_DATE / APPLICANT_NATIONALITY / APPLICANT_ADDRESS /
-- APPLICANT_POSITION (Milestone 15B correction — see the correction's
-- implementation report): added so a channel that genuinely collected a
-- new applicant's full profile can carry every field
-- src/lib/services/clients.ts#createClient requires, letting the
-- processing pipeline create a real Client automatically instead of
-- always routing new applicants to needs_review. Still nullable, still
-- never fabricated — a channel that did not collect one of these simply
-- leaves it null, and the pipeline treats that exactly like any other
-- missing required field (routes to needs_review /
-- insufficient_client_data, per application-intake-processing.ts). No
-- CHECK constraint beyond type/nullability is added for these four
-- columns, matching clients.birth_date/nationality/address/position
-- themselves, which carry no CHECK beyond `not null` on the clients
-- table (see 20260810210000_create_clients_table.sql) — this table does
-- not invent stricter validation than the Client Engine it feeds.

create table if not exists public.application_intakes (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  submission_id text,
  status text not null default 'received',
  raw_payload jsonb not null default '{}'::jsonb,
  applicant_full_name text,
  applicant_identification_type text,
  applicant_identification_number text,
  applicant_email text,
  applicant_phone text,
  applicant_birth_date date,
  applicant_nationality text,
  applicant_address text,
  applicant_position text,
  requested_product_code text,
  requested_amount numeric(12, 2),
  requested_term_months integer,
  employer_name text,
  monthly_salary numeric(12, 2),
  matched_client_id uuid references public.clients(id) on delete restrict,
  created_application_id uuid references public.applications(id) on delete restrict,
  review_reason text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (channel, submission_id)
);

comment on table public.application_intakes is
  'The canonical, channel-neutral landing zone for every inbound loan-'
  'application signal (Milestone 15B — see the Milestone 15A architecture '
  'review). Website/WhatsApp/email/CRM-manual/AI intake all converge '
  'here; no channel gets its own table. This migration is foundation '
  'only — no external channel is connected by it.';
comment on column public.application_intakes.channel is
  'The exact same five-value vocabulary as ApplicationSource '
  '(src/types/application.ts) — crm_manual/website_form/whatsapp/email/'
  'ai. See application_intakes_channel_check below.';
comment on column public.application_intakes.submission_id is
  'Channel-supplied idempotency key, when the channel has one (a '
  'website form''s client-generated submission id, a WhatsApp message '
  'id, an email Message-ID). NULL for CRM-manual and any other '
  'internally-originated intake with no external identifier to '
  'preserve — never fabricated. See the unique(channel, submission_id) '
  'constraint above: Postgres treats every NULL as distinct from every '
  'other NULL in a unique constraint, so any number of rows may share '
  '(channel, NULL) — only a genuine (channel, non-null submission_id) '
  'collision is ever rejected. This is exactly the idempotency guarantee '
  'this column exists to provide, and exactly why manual/internal '
  'intake is correctly unaffected by it.';
comment on column public.application_intakes.status is
  'received / client_matched / needs_review / processed — see this '
  'migration''s header comment for the full lifecycle and why '
  'documents_pending/rejected are deliberately not part of this '
  'milestone''s vocabulary. See application_intakes_status_check below.';
comment on column public.application_intakes.raw_payload is
  'Exactly what the originating channel supplied, normalized into JSON, '
  'for audit/replay. MUST NEVER contain secrets, API keys, webhook '
  'signatures, or authorization headers — see this migration''s header '
  'comment and src/lib/services/application-intakes.ts''s own module '
  'doc comment for this boundary.';
comment on column public.application_intakes.applicant_identification_type is
  'cedula / pasaporte / NULL — the same vocabulary as '
  'clients.identification_type, deliberately reused rather than '
  'redefined. NULL when the channel did not supply it (e.g. an initial '
  'WhatsApp contact with no identity information yet). See '
  'application_intakes_identification_type_check below.';
comment on column public.application_intakes.applicant_birth_date is
  'The same field as clients.birth_date, deliberately reused rather than '
  'redefined. NULL when the channel did not collect it — see this '
  'migration''s header comment (Milestone 15B correction) for why this '
  'column exists and why it carries no CHECK beyond its date type.';
comment on column public.application_intakes.applicant_nationality is
  'The same field as clients.nationality. NULL when the channel did not '
  'collect it — see this migration''s header comment.';
comment on column public.application_intakes.applicant_address is
  'The same field as clients.address. NULL when the channel did not '
  'collect it — see this migration''s header comment.';
comment on column public.application_intakes.applicant_position is
  'The same field as clients.position. NULL when the channel did not '
  'collect it — see this migration''s header comment.';
comment on column public.application_intakes.matched_client_id is
  'The real Client this intake was resolved to, once matching succeeds '
  '(src/lib/services/client-matching.ts). NULL until then. ON DELETE '
  'RESTRICT: clients are never hard-deleted in this schema, only moved '
  'to inactivo, so this never faces a dangling reference in practice.';
comment on column public.application_intakes.created_application_id is
  'The real Application this intake produced, once the processing '
  'pipeline succeeds (src/lib/services/applications.ts#createApplication, '
  'reused unchanged — never duplicated here). NULL until status = '
  '''processed''. ON DELETE RESTRICT, matching matched_client_id''s '
  'posture: applications are never hard-deleted in this schema either.';
comment on column public.application_intakes.review_reason is
  'Populated only when status = ''needs_review'' — a closed, machine-'
  'readable vocabulary (see ApplicationIntakeReviewReason in '
  'src/types/application-intake.ts) explaining exactly why the pipeline '
  'could not safely proceed on its own. See '
  'application_intakes_review_reason_pair_check and '
  'application_intakes_review_reason_check below.';

-- Restricts channel to the exact ApplicationSource vocabulary.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_intakes_channel_check'
      and conrelid = 'public.application_intakes'::regclass
  ) then
    alter table public.application_intakes
      add constraint application_intakes_channel_check
      check (channel in ('crm_manual', 'website_form', 'whatsapp', 'email', 'ai'));
  end if;
end $$;

-- Restricts status to the four values this milestone actually produces —
-- see this migration's header comment for the full reasoning.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_intakes_status_check'
      and conrelid = 'public.application_intakes'::regclass
  ) then
    alter table public.application_intakes
      add constraint application_intakes_status_check
      check (status in ('received', 'client_matched', 'needs_review', 'processed'));
  end if;
end $$;

-- Mirrors clients_identification_type_check exactly, but nullable — a
-- channel may not have identity information yet.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_intakes_identification_type_check'
      and conrelid = 'public.application_intakes'::regclass
  ) then
    alter table public.application_intakes
      add constraint application_intakes_identification_type_check
      check (applicant_identification_type is null or applicant_identification_type in ('cedula', 'pasaporte'));
  end if;
end $$;

-- Guards a positive requested amount, when provided — mirrors
-- applications_requested_amount_check's bound exactly, just nullable
-- (an intake may arrive before the applicant has stated an amount).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_intakes_requested_amount_check'
      and conrelid = 'public.application_intakes'::regclass
  ) then
    alter table public.application_intakes
      add constraint application_intakes_requested_amount_check
      check (requested_amount is null or requested_amount > 0);
  end if;
end $$;

-- Mirrors applications_requested_term_months_check's bound exactly
-- (360 months / 30 years — see that constraint's own comment for why),
-- just nullable for the same reason as requested_amount above.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_intakes_requested_term_months_check'
      and conrelid = 'public.application_intakes'::regclass
  ) then
    alter table public.application_intakes
      add constraint application_intakes_requested_term_months_check
      check (requested_term_months is null or (requested_term_months > 0 and requested_term_months <= 360));
  end if;
end $$;

-- Mirrors clients_monthly_salary_check exactly, just nullable.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_intakes_monthly_salary_check'
      and conrelid = 'public.application_intakes'::regclass
  ) then
    alter table public.application_intakes
      add constraint application_intakes_monthly_salary_check
      check (monthly_salary is null or monthly_salary >= 0);
  end if;
end $$;

-- One-directional, not a full iff pairing (unlike
-- created_application_id/review_reason below, which really are "set
-- exactly when status = X"): 'received' must NOT have matched_client_id
-- set — that is the one invariant this table actually needs to protect,
-- since Client matching is specifically what the received->client_matched
-- transition performs (claimApplicationIntakeForClient), and nothing
-- upstream of that transition has any legitimate reason to have written
-- it yet. Every other status is deliberately left unconstrained on this
-- column: needs_review is reachable directly from 'received' (Client
-- matching itself failed, or the intake was missing required Client
-- data — see application-intake-processing.ts#resolveClient) with
-- matched_client_id still NULL, and equally reachable from
-- 'client_matched' (a later step, e.g. Product resolution, failed) with
-- matched_client_id already set. A needs_review row legitimately has
-- either value, so no pair-check can require one for that status without
-- breaking the first, entirely normal case.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_intakes_client_matched_pair_check'
      and conrelid = 'public.application_intakes'::regclass
  ) then
    alter table public.application_intakes
      add constraint application_intakes_client_matched_pair_check
      check (
        (status = 'received' and matched_client_id is null)
        or (status != 'received')
      );
  end if;
end $$;

-- created_application_id is set if and only if status = 'processed'.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_intakes_created_application_id_pair_check'
      and conrelid = 'public.application_intakes'::regclass
  ) then
    alter table public.application_intakes
      add constraint application_intakes_created_application_id_pair_check
      check ((status = 'processed') = (created_application_id is not null));
  end if;
end $$;

-- review_reason is set if and only if status = 'needs_review'.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_intakes_review_reason_pair_check'
      and conrelid = 'public.application_intakes'::regclass
  ) then
    alter table public.application_intakes
      add constraint application_intakes_review_reason_pair_check
      check ((status = 'needs_review') = (review_reason is not null));
  end if;
end $$;

-- Closed vocabulary for review_reason — mirrors
-- ApplicationIntakeReviewReason in src/types/application-intake.ts
-- exactly. Widening this list later (a new failure case a future
-- channel adapter discovers) is a single DROP CONSTRAINT + ADD
-- CONSTRAINT, matching this schema's established convention.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'application_intakes_review_reason_check'
      and conrelid = 'public.application_intakes'::regclass
  ) then
    alter table public.application_intakes
      add constraint application_intakes_review_reason_check
      check (review_reason is null or review_reason in (
        'conflicting_client_identity',
        'low_confidence_client_match',
        'insufficient_client_data',
        'product_not_found',
        'product_inactive',
        'missing_product_code',
        'missing_requested_amount',
        'missing_requested_term_months'
      ));
  end if;
end $$;

-- The real query shapes this table needs to support: a staff work-queue
-- filtered by status, a chronological feed, "every intake for this
-- Client," and "which intake produced this Application." (channel,
-- submission_id) is already indexed via its own unique constraint above
-- — no separate index needed for that pair. applicant identification is
-- deliberately NOT indexed here: Client matching (src/lib/services/
-- client-matching.ts) looks up identity against the clients table
-- itself (already indexed via its own unique constraint), never against
-- past application_intakes rows, so an index here would serve no actual
-- query in this milestone — see the Milestone 15B implementation
-- report's indexes section for this reasoning stated explicitly.
create index if not exists application_intakes_status_idx
  on public.application_intakes (status);

create index if not exists application_intakes_received_at_idx
  on public.application_intakes (received_at desc);

create index if not exists application_intakes_matched_client_id_idx
  on public.application_intakes (matched_client_id);

create index if not exists application_intakes_created_application_id_idx
  on public.application_intakes (created_application_id);

-- ============================================================================
-- Row Level Security
-- ============================================================================

-- Enabled with zero policies, same posture as every other real table in
-- this schema: fully locked to both `anon` and `authenticated` until a
-- real permissions model exists. Reads/writes go through the server-only
-- Supabase client (src/lib/supabase/server.ts) exclusively — no browser-
-- direct access, and (crucially for this table specifically) no external
-- channel writes to it directly either: every future channel adapter
-- (website endpoint, WhatsApp webhook, email poller) will itself be
-- server-side code calling src/lib/services/application-intakes.ts, not
-- a client with its own Supabase credentials.
alter table public.application_intakes enable row level security;

-- ============================================================================
-- service_role grants
-- ============================================================================

-- Select + insert + update — no delete. Intakes are never hard-deleted,
-- matching the "never delete" posture already applied to every other
-- real table in this schema; an intake that turns out to be spam or a
-- mistake is a future needs_review/rejected disposition, not a row
-- removal.
grant select, insert, update on public.application_intakes to service_role;
