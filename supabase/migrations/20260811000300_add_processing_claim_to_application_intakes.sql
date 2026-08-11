-- ============================================================================
-- application_intakes.processing_claimed_at
-- ============================================================================
--
-- Purpose: closes a genuine duplicate-Application race that the two
-- status transitions alone (received -> client_matched -> processed)
-- cannot close (Milestone 15B brief, section 17 — "Analyze this
-- carefully").
--
-- The gap: once an intake reaches 'client_matched', it can sit there for
-- an arbitrary amount of time — the processing pipeline
-- (src/lib/services/application-intake-processing.ts#processApplicationIntake)
-- is explicitly designed to be resumable, so a prior attempt crashing
-- between "Client matched" and "Application created" is expected to be
-- picked back up later. But that same resumability means two independent
-- attempts (e.g. a stuck retry plus a fresh manual re-trigger) can both
-- legitimately observe the same row already sitting at 'client_matched'
-- and both proceed to call createApplication() for it. Checking
-- created_application_id first does not close this gap — both attempts
-- would see it null and both would create an Application before either
-- reached the point of writing it back.
--
-- Why a new column rather than a new status value or a DB-side RPC: the
-- brief explicitly asked to "prefer the smallest correct lifecycle" for
-- ApplicationIntakeStatus and to avoid building "a complicated workflow
-- engine" — a fifth status value purely to represent "being worked on
-- right now" would be exactly that. A DB-side RPC was the brief's
-- suggested fallback if the JS-side service layer "cannot provide a
-- clean transaction," but Supabase/PostgREST's actual limitation here is
-- narrower than that: a single UPDATE statement is already atomic at the
-- database level, and this schema already relies on that fact for every
-- other transition (see e.g. applications.ts#setApplicationStatus's
-- `.eq("status", currentStatus)` guard). One nullable timestamp column,
-- guarded the exact same way, closes this specific gap with no new
-- mechanism to reason about — see
-- src/lib/services/application-intakes.ts#claimApplicationIntakeForProcessing.
--
-- This column is claim-only bookkeeping, not part of this table's public
-- lifecycle: it is never read back into the ApplicationIntake TypeScript
-- type (src/types/application-intake.ts) or exposed to any caller
-- outside application-intakes.ts. It has no pair-check against status,
-- unlike matched_client_id/created_application_id/review_reason, because
-- it is not itself a lifecycle fact — merely a lock that happens to be
-- meaningful only while status = 'client_matched'.
--
-- STALE-CLAIM RECOVERY (Milestone 15B correction, section 8): a worker
-- that successfully claims an intake (sets this column) and then
-- crashes before calling completeApplicationIntake would otherwise
-- strand that intake at 'client_matched' forever — nothing else ever
-- clears this marker. claimApplicationIntakeForProcessing's guarded
-- UPDATE treats a claim older than
-- APPLICATION_INTAKE_PROCESSING_CLAIM_STALE_AFTER_MS
-- (src/lib/config/application-intake.ts, currently 15 minutes — generous
-- relative to this pipeline's actual expected runtime) as reclaimable,
-- exactly like a NULL claim. This preserves the same atomicity guarantee
-- as the simple NULL-only guard this migration originally shipped with:
-- a single UPDATE ... WHERE is still one atomic, row-locking statement,
-- so at most one concurrent attempt can ever win it, stale-reclaim
-- included. No separate recovery job, cron sweep, or workflow engine was
-- added — the existing guarded UPDATE already does the job.

alter table public.application_intakes
  add column if not exists processing_claimed_at timestamptz;

comment on column public.application_intakes.processing_claimed_at is
  'Internal concurrency-control marker only — set atomically by '
  'claimApplicationIntakeForProcessing() immediately before this '
  'pipeline attempts to create an Application for a client_matched '
  'intake, so at most one concurrent attempt can ever proceed past this '
  'point for the same row. A claim older than '
  'APPLICATION_INTAKE_PROCESSING_CLAIM_STALE_AFTER_MS is treated as '
  'reclaimable (see this migration''s header comment), so a crashed '
  'worker cannot strand an intake here forever. Never exposed on the '
  'ApplicationIntake TypeScript type or read by anything outside '
  'src/lib/services/application-intakes.ts.';
