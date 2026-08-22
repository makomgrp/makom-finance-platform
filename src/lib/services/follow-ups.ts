import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { applyBranchScope, isEmptyScope, withScopedParent } from "@/lib/services/branch-scope-query";
import { isSameBusinessDay } from "@/lib/config/business-time";
import type {
  ApplicationFollowUp,
  BranchScope,
  ContactMethod,
  ContactOutcome,
  FollowUpSummary,
  NextActionUrgency,
} from "@/types";

/**
 * ============================================================================
 * FOLLOW-UP READS AND WRITES (26B-6)
 * ============================================================================
 *
 * The operational layer: who called, what happened, what is promised next.
 *
 * ----------------------------------------------------------------------------
 * BRANCH SCOPE COMES FROM THE APPLICATION
 * ----------------------------------------------------------------------------
 * `application_follow_ups` has no branch_id, deliberately — the process owns the
 * branch, and copying it here would create a second answer that could drift
 * when a file is transferred. Every read joins to the owning application and
 * applies the branch predicate there, exactly as requirement_slots and
 * dossier_documents already do.
 *
 * ----------------------------------------------------------------------------
 * URGENCY IS DERIVED, NEVER STORED
 * ----------------------------------------------------------------------------
 * "Overdue" and "today" are statements about the reader's clock, not properties
 * of the row. A stored flag would be wrong the moment midnight passed, with
 * nothing having changed to trigger an update.
 */

const FOLLOW_UP_SELECT =
  "id, application_id, author_profile_id, contacted_at, contact_method, outcome, note, " +
  "next_action, next_action_at, completed_at, completed_by_profile_id, created_at, " +
  "author:profiles!application_follow_ups_author_profile_id_fkey(full_name), " +
  "completed_by:profiles!application_follow_ups_completed_by_profile_id_fkey(full_name)";

const FOLLOW_UP_APPLICATION_SCOPE_EMBED =
  "scope_application:applications!application_follow_ups_application_id_fkey!inner(branch_id)";

interface FollowUpRow {
  id: string;
  application_id: string;
  author_profile_id: string;
  contacted_at: string;
  contact_method: ContactMethod;
  outcome: ContactOutcome;
  note: string | null;
  next_action: string | null;
  next_action_at: string | null;
  completed_at: string | null;
  completed_by_profile_id: string | null;
  created_at: string;
  author: { full_name: string } | null;
  completed_by: { full_name: string } | null;
}

function toFollowUp(row: FollowUpRow): ApplicationFollowUp {
  return {
    id: row.id,
    applicationId: row.application_id,
    authorProfileId: row.author_profile_id,
    authorFullName: row.author?.full_name ?? undefined,
    contactedAt: row.contacted_at,
    contactMethod: row.contact_method,
    outcome: row.outcome,
    note: row.note ?? undefined,
    nextAction: row.next_action ?? undefined,
    nextActionAt: row.next_action_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    completedByProfileId: row.completed_by_profile_id ?? undefined,
    completedByFullName: row.completed_by?.full_name ?? undefined,
    createdAt: row.created_at,
  };
}

/**
 * Is this pending action late, due today, or still ahead?
 *
 * THE ONE PLACE THIS IS DECIDED. The pipeline board filters on the value this
 * returns and the dashboard counts it (26B-7), so both screens agree by
 * construction rather than by two implementations happening to match.
 *
 * OVERDUE IS AN INSTANT COMPARISON and deliberately timezone-free: "the moment
 * has passed" is true everywhere at once.
 *
 * TODAY IS A CALENDAR QUESTION, and MILESTONE 26B-8 pins it to Panama.
 * It previously compared the runtime's own local Y/M/D, which is correct on a
 * developer machine in Panama and wrong on a UTC server: with Panama at UTC-5,
 * anything due after 7pm local already belonged to "tomorrow" in UTC, so
 * evening commitments silently dropped out of the day's work list. See
 * src/lib/config/business-time.ts.
 */
export function deriveUrgency(nextActionAt: string, now: Date = new Date()): NextActionUrgency {
  const due = new Date(nextActionAt);
  if (due.getTime() < now.getTime()) return "overdue";

  return isSameBusinessDay(due, now) ? "today" : "upcoming";
}

export type GetFollowUpsResult =
  | { status: "ok"; followUps: ApplicationFollowUp[] }
  | { status: "error" };

/** Full contact history for one process, newest first. */
export async function getFollowUpsByApplicationId(
  scope: BranchScope,
  applicationId: string
): Promise<GetFollowUpsResult> {
  if (isEmptyScope(scope)) return { status: "ok", followUps: [] };

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await applyBranchScope(
      supabase
        .from("application_follow_ups")
        .select(withScopedParent(FOLLOW_UP_SELECT, scope, FOLLOW_UP_APPLICATION_SCOPE_EMBED))
        .eq("application_id", applicationId),
      scope,
      "scope_application.branch_id"
    ).order("contacted_at", { ascending: false });

    if (error) {
      console.error("[follow-ups service] Failed to load follow-ups:", error.message);
      return { status: "error" };
    }

    return { status: "ok", followUps: (data ?? []).map((r) => toFollowUp(r as unknown as FollowUpRow)) };
  } catch (error) {
    console.error(
      "[follow-ups service] Unexpected failure loading follow-ups:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

export type FollowUpSummaryMap = Record<string, FollowUpSummary>;

export type GetFollowUpSummariesResult =
  | { status: "ok"; summaries: FollowUpSummaryMap }
  | { status: "error" };

/**
 * Last contact and outstanding action for EVERY process in scope, in one query.
 *
 * The board needs both facts on every card. Fetching them per card would be the
 * textbook N+1; this reads the whole scoped set once and reduces in memory, so
 * fifty cards cost the same as three.
 */
export async function getFollowUpSummaries(
  scope: BranchScope,
  now: Date = new Date()
): Promise<GetFollowUpSummariesResult> {
  if (isEmptyScope(scope)) return { status: "ok", summaries: {} };

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await applyBranchScope(
      supabase
        .from("application_follow_ups")
        .select(
          withScopedParent(
            "id, application_id, contacted_at, contact_method, outcome, next_action, next_action_at, completed_at",
            scope,
            FOLLOW_UP_APPLICATION_SCOPE_EMBED
          )
        ),
      scope,
      "scope_application.branch_id"
    );

    if (error) {
      console.error("[follow-ups service] Failed to load follow-up summaries:", error.message);
      return { status: "error" };
    }

    const rows = (data ?? []) as unknown as {
      id: string;
      application_id: string;
      contacted_at: string;
      contact_method: ContactMethod;
      outcome: ContactOutcome;
      next_action: string | null;
      next_action_at: string | null;
      completed_at: string | null;
    }[];

    const summaries: FollowUpSummaryMap = {};
    for (const row of rows) {
      const entry = (summaries[row.application_id] ??= { applicationId: row.application_id });

      // LATEST contact wins — this is "when did we last speak to them".
      if (!entry.lastContactAt || row.contacted_at > entry.lastContactAt) {
        entry.lastContactAt = row.contacted_at;
        entry.lastContactMethod = row.contact_method;
        entry.lastContactOutcome = row.outcome;
      }

      // OLDEST outstanding action wins — the one someone is most late on is the
      // one a work queue has to surface, not the most recently promised.
      const pending = row.next_action && row.next_action_at && !row.completed_at;
      if (pending && (!entry.nextActionAt || row.next_action_at! < entry.nextActionAt)) {
        entry.nextAction = row.next_action!;
        entry.nextActionAt = row.next_action_at!;
        entry.nextActionFollowUpId = row.id;
        entry.nextActionUrgency = deriveUrgency(row.next_action_at!, now);
      }
    }

    return { status: "ok", summaries };
  } catch (error) {
    console.error(
      "[follow-ups service] Unexpected failure loading follow-up summaries:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

export interface LogFollowUpInput {
  applicationId: string;
  authorProfileId: string;
  contactMethod: ContactMethod;
  outcome: ContactOutcome;
  note?: string;
  nextAction?: string;
  nextActionAt?: string;
}

export type LogFollowUpResult =
  | { status: "ok"; followUp: ApplicationFollowUp }
  | { status: "error"; code: "INVALID_INPUT" | "INSERT_FAILED" };

/**
 * Record one contact attempt.
 *
 * A plain row insert — never a read-modify-write of some aggregated operational
 * blob. Two advisors logging calls on the same prospect at the same moment
 * produce two rows, and neither can erase the other's work.
 *
 * Authorization is the CALLER's job (the server action), which checks the
 * capability and the branch scope before reaching this. This function is the
 * write, not the gate.
 */
export async function logFollowUp(input: LogFollowUpInput): Promise<LogFollowUpResult> {
  // Mirrors the CHECK constraints so a bad request gets a clear code instead of
  // a raw database error — the constraint remains the enforcement.
  const hasAction = Boolean(input.nextAction?.trim());
  const hasActionDate = Boolean(input.nextActionAt);
  if (hasAction !== hasActionDate) return { status: "error", code: "INVALID_INPUT" };
  if (input.outcome === "other" && !input.note?.trim()) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("application_follow_ups")
      .insert({
        application_id: input.applicationId,
        author_profile_id: input.authorProfileId,
        contact_method: input.contactMethod,
        outcome: input.outcome,
        note: input.note?.trim() || null,
        next_action: input.nextAction?.trim() || null,
        next_action_at: input.nextActionAt ?? null,
      })
      .select(FOLLOW_UP_SELECT)
      .single();

    if (error || !data) {
      console.error("[follow-ups service] Failed to log follow-up:", error?.message ?? "no row");
      return { status: "error", code: "INSERT_FAILED" };
    }

    return { status: "ok", followUp: toFollowUp(data as unknown as FollowUpRow) };
  } catch (error) {
    console.error(
      "[follow-ups service] Unexpected failure logging follow-up:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error", code: "INSERT_FAILED" };
  }
}

export type CompleteFollowUpActionResult =
  | { status: "ok"; followUp: ApplicationFollowUp }
  | { status: "error"; code: "NOT_FOUND" | "ALREADY_COMPLETED" | "UPDATE_FAILED" };

/**
 * Mark a promised action done.
 *
 * The `completed_at is null` guard makes this idempotent under a double click:
 * the second attempt matches no row and is reported as already completed rather
 * than overwriting who finished it and when.
 */
export async function completeFollowUpAction(
  followUpId: string,
  completedByProfileId: string
): Promise<CompleteFollowUpActionResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("application_follow_ups")
      .update({
        completed_at: new Date().toISOString(),
        completed_by_profile_id: completedByProfileId,
      })
      .eq("id", followUpId)
      .is("completed_at", null)
      .not("next_action", "is", null)
      .select(FOLLOW_UP_SELECT)
      .maybeSingle();

    if (error) {
      console.error("[follow-ups service] Failed to complete action:", error.message);
      return { status: "error", code: "UPDATE_FAILED" };
    }
    if (!data) return { status: "error", code: "ALREADY_COMPLETED" };

    return { status: "ok", followUp: toFollowUp(data as unknown as FollowUpRow) };
  } catch (error) {
    console.error(
      "[follow-ups service] Unexpected failure completing action:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error", code: "UPDATE_FAILED" };
  }
}
