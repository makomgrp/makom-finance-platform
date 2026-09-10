import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  selectReminderCandidates,
  type FollowUpApplicationStatus,
  type FollowUpReminderCandidate,
} from "./follow-up-reminder-eligibility.ts";

/**
 * ============================================================================
 * MILESTONE 2.2 — INTERNAL FOLLOW-UP REMINDERS
 * ============================================================================
 *
 * Turns an existing, already-promised `next_action` into a one-time push to
 * the advisor who owns it, once its moment has passed. Internal only: no
 * customer communication is triggered from this file.
 *
 * The actual eligibility decision — which rows are due, which are skipped,
 * and why — lives in `follow-up-reminder-eligibility.ts` as a pure function,
 * so it can be unit-tested with `node --test` without a Supabase client. This
 * file is everything around that decision: the read, the atomic claim, and
 * the best-effort Realtime push.
 *
 * ----------------------------------------------------------------------------
 * "DUE" MEANS THE SAME THING deriveUrgency's "overdue" ALREADY MEANS
 * ----------------------------------------------------------------------------
 * `next_action_at <= now` — an instant comparison, deliberately not a new
 * timing rule. This project's own follow-ups.ts already treats "overdue" as
 * "the moment has passed" and treats "today" as a calendar question a human
 * can already see on the dashboard/pipeline without being pushed. Reminding
 * once the promised moment is behind us needs no invented business rule
 * ("24 hours", "3 reminders", "7 days") — it needs only the date the advisor
 * themselves already wrote down.
 *
 * ----------------------------------------------------------------------------
 * THE READ IS ALLOWED TO BE STALE. THE CLAIM IS NOT.
 * ----------------------------------------------------------------------------
 * Two concurrent cron invocations can both read the same pending row with no
 * consequence. What must not happen twice is the WRITE: `processDueFollowUpReminders`
 * issues a single guarded UPDATE (`internal_reminder_sent_at is null`), the
 * same idempotency shape `completeFollowUpAction` already uses for
 * `completed_at`. Under Postgres's normal row locking, a second concurrent
 * UPDATE against an already-claimed row serializes behind the first, then
 * re-evaluates its WHERE clause against what was just committed and matches
 * nothing — no advisory lock, no SELECT ... FOR UPDATE, needed for that
 * guarantee.
 *
 * ----------------------------------------------------------------------------
 * NO ADVISOR, NO CLAIM
 * ----------------------------------------------------------------------------
 * A follow-up on an application with no `assigned_advisor_profile_id` is left
 * untouched — not claimed, not notified. There is nobody to remind yet, and
 * inventing a supervisor-escalation target is explicitly out of scope for this
 * milestone. Once the application gets an advisor, the row is still eligible
 * on the next run.
 */

const CANDIDATE_SELECT =
  "id, application_id, next_action, next_action_at, completed_at, internal_reminder_sent_at, " +
  "application:applications!application_follow_ups_application_id_fkey(" +
  "application_number, assigned_advisor_profile_id, status, " +
  "client:clients!applications_client_id_fkey(full_name)" +
  ")";

interface CandidateApplication {
  application_number: string | null;
  assigned_advisor_profile_id: string | null;
  status: FollowUpApplicationStatus;
  client: { full_name: string } | null;
}

interface CandidateRow {
  id: string;
  application_id: string;
  next_action: string | null;
  next_action_at: string | null;
  completed_at: string | null;
  internal_reminder_sent_at: string | null;
  application: CandidateApplication | null;
}

function toCandidate(row: CandidateRow): FollowUpReminderCandidate | null {
  // Both are guarded by CHECK constraints at the DB layer already
  // (application_follow_ups_next_action_pair_check); this mirrors that guard
  // rather than trusting it silently, matching logFollowUp's own convention.
  if (!row.next_action || !row.next_action_at) return null;

  // `application_id` is a NOT NULL, ON DELETE RESTRICT foreign key — the
  // embed should never actually be absent. Skipping rather than guessing a
  // status is the fail-safe choice if it somehow were: MILESTONE 2.4's
  // terminal-application check must never silently treat "unknown" as
  // "still open" or vice versa.
  if (!row.application) return null;

  return {
    id: row.id,
    applicationId: row.application_id,
    nextAction: row.next_action,
    nextActionAt: row.next_action_at,
    advisorProfileId: row.application.assigned_advisor_profile_id,
    applicationNumber: row.application.application_number ?? undefined,
    clientFullName: row.application.client?.full_name ?? "",
    applicationStatus: row.application.status,
  };
}

export interface ReminderNotification {
  followUpId: string;
  applicationId: string;
  applicationNumber?: string;
  advisorProfileId: string;
  clientFullName: string;
  nextAction: string;
  nextActionAt: string;
}

export interface ProcessDueFollowUpRemindersResult {
  candidatesRead: number;
  claimed: number;
  skippedUnassigned: number;
  skippedNotDueYet: number;
  skippedTerminalApplication: number;
  notifyFailures: number;
}

/**
 * Sends one best-effort broadcast to the advisor's existing per-user
 * notification channel. Same channel the chat provider already listens on
 * (`chat:user:{profileId}`) — one persistent subscription per session, not a
 * second one for this milestone — but this file does not import chat.ts's
 * private sender: that helper's type is deliberately narrowed to chat's own
 * three event names, and widening a private, tested helper for one more
 * caller here would touch working, unrelated code for a four-line saving.
 * Failure here is swallowed, never thrown: the persistent "My Follow-ups"
 * card on the dashboard is the reliable surface, this is only the nudge.
 */
async function broadcastFollowUpReminder(notification: ReminderNotification): Promise<void> {
  const supabase = getSupabaseServerClient();
  const channel = supabase.channel(`chat:user:${notification.advisorProfileId}`);
  try {
    await channel.httpSend("followup.reminder", notification);
  } catch (error) {
    console.error(
      "[follow-up reminders] broadcast failed:",
      error instanceof Error ? error.message : "unknown error"
    );
  } finally {
    await supabase.removeChannel(channel);
  }
}

/**
 * The cron's whole job: read pending follow-ups, decide which are due,
 * atomically claim exactly those, and notify their advisors. Safe to invoke
 * with zero rows in the table, and safe to invoke twice in immediate
 * succession — the second call claims nothing the first one already claimed.
 */
export async function processDueFollowUpReminders(
  now: Date = new Date()
): Promise<ProcessDueFollowUpRemindersResult> {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from("application_follow_ups")
    .select(CANDIDATE_SELECT)
    .is("completed_at", null)
    .is("internal_reminder_sent_at", null)
    .not("next_action_at", "is", null);

  if (error) {
    console.error("[follow-up reminders] failed to read candidates:", error.message);
    return {
      candidatesRead: 0,
      claimed: 0,
      skippedUnassigned: 0,
      skippedNotDueYet: 0,
      skippedTerminalApplication: 0,
      notifyFailures: 0,
    };
  }

  const rows = (data ?? []) as unknown as CandidateRow[];
  const candidates = rows.map(toCandidate).filter((c): c is FollowUpReminderCandidate => c !== null);

  const { toClaim, skippedUnassigned, skippedNotDueYet, skippedTerminalApplication } =
    selectReminderCandidates(candidates, now);

  if (toClaim.length === 0) {
    return {
      candidatesRead: candidates.length,
      claimed: 0,
      skippedUnassigned,
      skippedNotDueYet,
      skippedTerminalApplication,
      notifyFailures: 0,
    };
  }

  // THE ATOMIC CLAIM. `is("internal_reminder_sent_at", null)` re-checked here
  // — not just relied upon from the read above — is what makes two concurrent
  // invocations of this whole function safe: whichever one's UPDATE commits
  // first wins each row, and `.select("id")` on the response tells this
  // invocation exactly which rows it actually won, never assumed.
  const { data: claimedRows, error: claimError } = await supabase
    .from("application_follow_ups")
    .update({ internal_reminder_sent_at: now.toISOString() })
    .in(
      "id",
      toClaim.map((c) => c.id)
    )
    .is("internal_reminder_sent_at", null)
    .select("id");

  if (claimError) {
    console.error("[follow-up reminders] failed to claim rows:", claimError.message);
    return {
      candidatesRead: candidates.length,
      claimed: 0,
      skippedUnassigned,
      skippedNotDueYet,
      skippedTerminalApplication,
      notifyFailures: 0,
    };
  }

  const claimedIds = new Set((claimedRows ?? []).map((r) => (r as { id: string }).id));
  const won = toClaim.filter((c) => claimedIds.has(c.id));

  const outcomes = await Promise.allSettled(
    won.map((c) =>
      broadcastFollowUpReminder({
        followUpId: c.id,
        applicationId: c.applicationId,
        applicationNumber: c.applicationNumber,
        advisorProfileId: c.advisorProfileId as string,
        clientFullName: c.clientFullName,
        nextAction: c.nextAction,
        nextActionAt: c.nextActionAt,
      })
    )
  );
  const notifyFailures = outcomes.filter((o) => o.status === "rejected").length;

  return {
    candidatesRead: candidates.length,
    claimed: won.length,
    skippedUnassigned,
    skippedNotDueYet,
    skippedTerminalApplication,
    notifyFailures,
  };
}
