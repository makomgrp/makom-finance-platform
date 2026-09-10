/**
 * ============================================================================
 * MILESTONE 2.2 — WHO GETS REMINDED, AS A PURE QUESTION
 * ============================================================================
 *
 * Zero imports, deliberately — this is the only dependency
 * `follow-up-reminders.test.ts` needs, and it is exercised with `node --test`,
 * which resolves real files and knows nothing of the `@/` bundler alias. Every
 * other piece of this milestone's cron (the Supabase read, the atomic claim,
 * the Realtime push) lives in `follow-up-reminders.ts` instead, exactly the
 * split `src/lib/reporting/period.ts` already uses for the same reason.
 */

/** The shape the caller has already resolved from Supabase — see
 * `follow-up-reminders.ts`'s `CANDIDATE_SELECT` for where each field comes
 * from. Deliberately flat and Supabase-agnostic, so a fixture is just an
 * object literal. */
export type FollowUpApplicationStatus =
  | "draft"
  | "new"
  | "in_review"
  | "approved"
  | "not_eligible"
  | "cancelled";

export interface FollowUpReminderCandidate {
  id: string;
  applicationId: string;
  nextAction: string;
  nextActionAt: string;
  advisorProfileId: string | null;
  applicationNumber?: string;
  clientFullName: string;
  /** MILESTONE 2.4 — the owning application's current status, so a stale
   * reminder on an already-decided case can be recognised and skipped. */
  applicationStatus: FollowUpApplicationStatus;
}

/** Mirrors `APPLICATION_STATUS_TRANSITIONS`' own terminal states
 * (src/lib/config/application.ts: approved/not_eligible/cancelled all have
 * an empty outgoing-transitions list). Hardcoded rather than imported —
 * this file stays at zero imports so `node --test` can resolve it directly —
 * but the three values are exactly that config's terminal set. */
const TERMINAL_APPLICATION_STATUSES: ReadonlySet<FollowUpApplicationStatus> = new Set([
  "approved",
  "not_eligible",
  "cancelled",
]);

export interface SelectReminderCandidatesResult {
  toClaim: FollowUpReminderCandidate[];
  skippedUnassigned: number;
  skippedNotDueYet: number;
  skippedTerminalApplication: number;
}

/**
 * Pure decision function: which pending follow-ups are due, and why the rest
 * were left alone. Never touches the database — the caller reads rows once
 * and performs the guarded claim separately (see `processDueFollowUpReminders`).
 *
 * `completedByRowId`/`alreadyRemindedByRowId` exist so this function alone can
 * simulate, in a unit test, what the DB's own guards
 * (`completed_at is null`, `internal_reminder_sent_at is null`) already
 * enforce for real — including "the second cron run does not reclaim what the
 * first one already claimed" without needing two database round-trips to
 * prove it.
 *
 * Rows already completed, already reminded, on an already-decided
 * (terminal-status) application, or not yet due are silently excluded rather
 * than counted as failures: none of those are wrong states, they are simply
 * not this run's job.
 *
 * MILESTONE 2.4 — a follow-up whose application has already reached
 * approved/not_eligible/cancelled is skipped here rather than claimed: the
 * case is decided, and a "you still owe this customer a call" reminder about
 * it is stale noise, not a wrong state. The historical follow-up row itself
 * is never touched — this only stops a NEW automatic reminder from being
 * generated for it.
 */
export function selectReminderCandidates(
  rows: FollowUpReminderCandidate[],
  now: Date,
  completedByRowId: ReadonlySet<string> = new Set(),
  alreadyRemindedByRowId: ReadonlySet<string> = new Set()
): SelectReminderCandidatesResult {
  let skippedUnassigned = 0;
  let skippedNotDueYet = 0;
  let skippedTerminalApplication = 0;
  const toClaim: FollowUpReminderCandidate[] = [];

  for (const row of rows) {
    if (completedByRowId.has(row.id) || alreadyRemindedByRowId.has(row.id)) continue;

    if (TERMINAL_APPLICATION_STATUSES.has(row.applicationStatus)) {
      skippedTerminalApplication += 1;
      continue;
    }

    const dueAt = new Date(row.nextActionAt);
    if (dueAt.getTime() > now.getTime()) {
      skippedNotDueYet += 1;
      continue;
    }

    if (!row.advisorProfileId) {
      skippedUnassigned += 1;
      continue;
    }

    toClaim.push(row);
  }

  return { toClaim, skippedUnassigned, skippedNotDueYet, skippedTerminalApplication };
}
