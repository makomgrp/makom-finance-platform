-- ============================================================================
-- MILESTONE 2.3 — INTERNAL DOCUMENT REQUEST TRACKING
-- ============================================================================
--
-- Turns the existing requirement slot into the idempotency mechanism for an
-- automated internal document-request nudge, without a new table and without
-- touching crm_events — the same minimal shape Milestone 2.2 already proved
-- for application_follow_ups.internal_reminder_sent_at.
--
-- ----------------------------------------------------------------------------
-- WHY ONE COLUMN IS ENOUGH
-- ----------------------------------------------------------------------------
-- No existing column on requirement_slots carries this meaning:
-- status_changed_at/status_changed_by_profile_id/status_changed_source
-- describe the slot's OWN lifecycle (pending/missing/satisfied/...), not
-- whether an internal automation already generated a request about it. A
-- generated request is the same class of fact as a sent reminder: "something
-- happened once, at this timestamp" — the row IS the record, and duplicating
-- it into crm_events would record a fact this table already records durably.
--
-- ----------------------------------------------------------------------------
-- THE ATOMIC CLAIM, NOT A NEW LOCKING PRIMITIVE
-- ----------------------------------------------------------------------------
-- Identical shape to 2.2: a single guarded UPDATE
-- (`document_request_generated_at is null`, re-checked against every
-- eligibility condition at claim time, not just at candidate-read time).
-- Under Postgres's normal row-level locking, two concurrent UPDATEs against
-- the same row serialize, and the second one's WHERE clause is re-evaluated
-- against what the first one just committed — so it naturally matches
-- nothing. No advisory lock, no SELECT ... FOR UPDATE, needed for that
-- guarantee.
--
-- ----------------------------------------------------------------------------
-- WHAT THIS DELIBERATELY DOES NOT DO
-- ----------------------------------------------------------------------------
-- No customer delivery timestamp: customer-facing communication is not
-- activated in Milestone 2.3 (internal-only), and a column for a channel that
-- cannot fire yet is speculative, not minimal.
-- No retry/escalation counter: repeated requests and escalation are open
-- questions for ODL (see the 2.3 architecture audit), not decided behavior —
-- inventing a counter now would encode an unconfirmed business rule as
-- schema.
-- No document_requests table: a slot's own timestamp is a complete audit
-- trail for a one-shot "was a request ever generated" fact; a dedicated table
-- would only earn its keep if ODL confirms recurring requests are wanted,
-- which is not decided yet.
-- No grant changes: service_role already holds UPDATE on the whole table
-- (20260809140000) — a new column is covered by that existing table-level
-- grant, not by a new one.

alter table public.requirement_slots
  add column document_request_generated_at timestamptz;

comment on column public.requirement_slots.document_request_generated_at is
  'When the automated internal document-request nudge for this slot was '
  'generated and dispatched to the assigned advisor. NULL means not yet '
  'generated. Set exactly once, by the reminder cron''s atomic claim '
  '(WHERE ... is null), never by any UI action — there is no user-facing way '
  'to mark this by hand.';

-- Mirrors application_follow_ups_reminder_requires_action_check (Milestone
-- 2.2): nothing required, nothing to request.
alter table public.requirement_slots
  add constraint requirement_slots_document_request_requires_required_check
  check (document_request_generated_at is null or required = true);
