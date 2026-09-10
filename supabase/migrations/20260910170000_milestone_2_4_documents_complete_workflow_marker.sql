-- ============================================================================
-- MILESTONE 2.4 — "READY FOR REVIEW" WORKFLOW MARKER
-- ============================================================================
--
-- The durable, idempotent record of one fact: the applicant's required
-- document package became complete, and an internal nudge was sent to the
-- assigned advisor about it. Same minimal shape Milestones 2.2 and 2.3 already
-- proved (application_follow_ups.internal_reminder_sent_at,
-- requirement_slots.document_request_generated_at) — one nullable timestamp,
-- no new table, no crm_events entry.
--
-- ----------------------------------------------------------------------------
-- WHY ONE COLUMN IS ENOUGH
-- ----------------------------------------------------------------------------
-- No existing column on `applications` carries this meaning —
-- status/status_changed_at describe the application's OWN lifecycle
-- (new/in_review/approved/...), not whether the document-completeness
-- workflow already fired. This is the same class of fact as 2.2's sent
-- reminder and 2.3's generated request: "something happened once, at this
-- timestamp." The row is the record.
--
-- ----------------------------------------------------------------------------
-- THE ATOMIC CLAIM, NOT A NEW LOCKING PRIMITIVE
-- ----------------------------------------------------------------------------
-- Same shape as 2.2/2.3: a single guarded UPDATE
-- (`documents_complete_notified_at is null`, re-checked at claim time,
-- combined with excluding terminal application statuses so an already-decided
-- case cannot receive an obsolete "ready for review" nudge). Postgres's normal
-- row-level locking makes two concurrent claims on the same application safe
-- without an advisory lock or SELECT ... FOR UPDATE.
--
-- ----------------------------------------------------------------------------
-- WHAT THIS DELIBERATELY DOES NOT DO
-- ----------------------------------------------------------------------------
-- Does not touch `applications.status` — this is not a review completion, an
-- approval, or any credit decision. It identifies that the structurally
-- required applicant-document package is complete, nothing more.
-- No `workflow_stage` column, no generic workflow table, no task table — the
-- audit found no existing generic "task" entity worth extending, and inventing
-- one is explicitly out of this milestone's minimal scope.
-- No CHECK constraint mirroring 2.2/2.3's "nothing promised, nothing to act
-- on" pattern: those constraints tie the marker to a sibling boolean on the
-- SAME row (`next_action`, `required`). Completeness here is a fact about a
-- DIFFERENT table's rows (`requirement_slots`), so there is no analogous
-- same-row invariant to enforce at the database layer — the application
-- service (`document-completeness-workflow.ts`) is what recomputes it.
-- No grant changes: service_role already holds UPDATE on the whole table
-- (20260809150000) — a new column is covered by that existing table-level
-- grant, not by a new one.
-- No rows are populated by this migration — every existing application keeps
-- this column NULL until the workflow itself claims it.

alter table public.applications
  add column documents_complete_notified_at timestamptz;

comment on column public.applications.documents_complete_notified_at is
  'When the automated "ready for review" workflow nudge for this application '
  'was generated and dispatched to the assigned advisor, after every '
  'applicant-facing required document became satisfied or waived. NULL means '
  'not yet triggered. Set exactly once, by the workflow''s atomic claim '
  '(WHERE ... is null), never by any UI action. Never implies a status '
  'change, a completed review, or any credit decision.';
