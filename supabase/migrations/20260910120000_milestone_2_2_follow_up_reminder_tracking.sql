-- ============================================================================
-- MILESTONE 2.2 — INTERNAL FOLLOW-UP REMINDER TRACKING
-- ============================================================================
--
-- Turns the existing follow-up record into the idempotency mechanism for an
-- automated internal reminder, without a new table and without touching
-- crm_events.
--
-- ----------------------------------------------------------------------------
-- WHY ONE COLUMN IS ENOUGH
-- ----------------------------------------------------------------------------
-- `application_follow_ups` already proved this pattern with `completed_at`:
-- completing a promised action mutates this same row and is never mirrored
-- into `crm_events` (see 20260822045258) — the row IS the record. A sent
-- reminder is the same class of fact: "something happened to this specific
-- follow-up, once, at this timestamp." Duplicating it into crm_events would
-- record a fact this table already records durably, which is exactly what
-- this schema's audit model says not to do.
--
-- ----------------------------------------------------------------------------
-- THE ATOMIC CLAIM, NOT A NEW LOCKING PRIMITIVE
-- ----------------------------------------------------------------------------
-- `completeFollowUpAction` already guards a mutation with
-- `.is("completed_at", null)`: under Postgres's normal row-level locking, two
-- concurrent UPDATEs against the same row serialize, and the second one's
-- WHERE clause is re-evaluated against what the first one just committed — so
-- it naturally matches nothing. The reminder cron reuses the identical guard
-- (`internal_reminder_sent_at is null`) instead of inventing an advisory lock
-- or a SELECT ... FOR UPDATE step neither this table nor this milestone needs.
--
-- ----------------------------------------------------------------------------
-- WHAT THIS DELIBERATELY DOES NOT DO
-- ----------------------------------------------------------------------------
-- No `customer_reminder_sent_at`: customer-facing communication is not
-- activated in Milestone 2.2 (internal-only), and a column for a channel that
-- cannot fire yet is speculative, not minimal.
-- No grant changes: `service_role` already holds UPDATE on the whole table
-- (20260822045258) — a new column is covered by that existing table-level
-- grant, not by a new one.
-- No new index: `application_follow_ups_pending_action_idx` already narrows
-- to exactly the rows a reminder job would ever look at (`next_action_at is
-- not null and completed_at is null`); the one extra predicate this milestone
-- adds is a cheap filter over that already-small set, not a reason to touch a
-- working index.

alter table public.application_follow_ups
  add column internal_reminder_sent_at timestamptz;

comment on column public.application_follow_ups.internal_reminder_sent_at is
  'When the automated internal reminder for this follow-up''s next_action was '
  'dispatched to the assigned advisor. NULL means not yet sent. Set exactly '
  'once, by the reminder cron''s atomic claim (WHERE ... is null), never by '
  'any UI action — there is no user-facing way to mark this by hand.';

-- Mirrors application_follow_ups_completion_requires_action_check: nothing
-- promised, nothing to remind anyone about.
alter table public.application_follow_ups
  add constraint application_follow_ups_reminder_requires_action_check
  check (internal_reminder_sent_at is null or next_action is not null);
