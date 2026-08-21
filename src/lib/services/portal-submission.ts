import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { SYSTEM_NATIONAL_SCOPE } from "@/lib/services/branch-scope-query";
import { authorizePortalWrite } from "@/lib/services/portal-snapshot";
import { getApplicationIntakeById } from "@/lib/services/application-intakes";
import { getApplicationById, setApplicationStatus } from "@/lib/services/applications";
import { evaluatePortalProgress } from "@/lib/services/portal-progress";
import type { PortalStep } from "@/types";

/**
 * ============================================================================
 * SUBMITTING THE APPLICATION (26B-4)
 * ============================================================================
 *
 * The one place a public applicant hands their application to ODL. There is no
 * second submission path and no second completion engine — this asks 26A-4's
 * evaluator whether anything is still pending and refuses if it says yes.
 *
 * ----------------------------------------------------------------------------
 * SUBMITTED MEANS SUBMITTED, NOT APPROVED
 * ----------------------------------------------------------------------------
 * The application moves `new -> in_review`, which is the status this schema
 * already uses for "with ODL, awaiting a human". Nothing here sets `approved`,
 * and nothing infers an underwriting outcome. A customer pressing the button is
 * saying "I am finished", not receiving an answer.
 *
 * ----------------------------------------------------------------------------
 * THE COMPLETION CHECK IS SERVER-SIDE AND AUTHORITATIVE
 * ----------------------------------------------------------------------------
 * The browser's disabled button is a courtesy. This function re-derives
 * completion from stored data every time, so a manipulated client, a stale tab
 * or a replayed request all hit the same gate. `firstPendingStep` doubles as
 * the reason: the customer is told which step still needs them, not merely that
 * something is wrong.
 *
 * ----------------------------------------------------------------------------
 * IDEMPOTENCY IS A DATABASE GUARANTEE, NOT A UI ONE
 * ----------------------------------------------------------------------------
 * The anchor is one guarded UPDATE:
 *
 *     set submitted_at = now() where id = ? and submitted_at is null
 *
 * PostgreSQL locks the row for that statement, so of two simultaneous submits
 * exactly one matches a row and the other matches none. The loser reports
 * `already_submitted` rather than submitting again, and no second application,
 * number, status transition or audit entry is produced. Nothing about that
 * depends on the button being disabled.
 */

export type PortalSubmissionResult =
  | { status: "ok"; applicationNumber: string; submittedAt: string }
  | { status: "already_submitted"; applicationNumber: string; submittedAt: string }
  | { status: "incomplete"; pendingStep: PortalStep }
  | { status: "error"; code: "NOT_AUTHORIZED" | "SUBMIT_FAILED" };

/**
 * Finalise one application.
 *
 * `authorizePortalWrite` is the ownership boundary and already refuses a
 * submitted intake, so a second submission is rejected before this function
 * does any work of its own — the guarded UPDATE below is the backstop for the
 * genuinely concurrent case that check cannot see.
 */
export async function submitPortalApplication(token: string): Promise<PortalSubmissionResult> {
  const authorized = await authorizePortalWrite(token);

  if (authorized.status !== "ok") {
    // Distinguish "already finished" from "this link is not usable", because
    // the first deserves a confirmation and the second an explanation.
    const submitted = await loadSubmittedState(token);
    if (submitted) return { status: "already_submitted", ...submitted };
    return { status: "error", code: "NOT_AUTHORIZED" };
  }
  if (!authorized.applicationId) return { status: "error", code: "NOT_AUTHORIZED" };

  const intakeResult = await getApplicationIntakeById(authorized.intakeId);
  if (intakeResult.status !== "ok") return { status: "error", code: "SUBMIT_FAILED" };

  // THE SINGLE EVALUATOR (26A-4). Steps 1-3, documents and declarations all
  // resolve through it; this module adds no completion rules of its own.
  const progress = await evaluatePortalProgress(intakeResult.intake);
  if (progress.status !== "ok") return { status: "error", code: "SUBMIT_FAILED" };
  if (progress.progress.firstPendingStep) {
    return { status: "incomplete", pendingStep: progress.progress.firstPendingStep };
  }

  const supabase = getSupabaseServerClient();
  const submittedAt = new Date().toISOString();

  // THE IDEMPOTENCY ANCHOR. See this module's header.
  const { data: claimed, error: claimError } = await supabase
    .from("application_intakes")
    .update({ submitted_at: submittedAt, last_activity_at: submittedAt })
    .eq("id", authorized.intakeId)
    .is("submitted_at", null)
    .select("id")
    .maybeSingle();

  if (claimError) {
    console.error("[portal-submission] Failed to claim submission:", claimError.message);
    return { status: "error", code: "SUBMIT_FAILED" };
  }

  if (!claimed) {
    // Lost the race, or a previous attempt already claimed it.
    const submitted = await loadSubmittedState(token);
    if (!submitted) return { status: "error", code: "SUBMIT_FAILED" };
    // REPAIR PATH: if an earlier attempt claimed the submission and then died
    // before moving the application, the record would sit "submitted" while
    // still reading `new` to staff. Re-attempting the transition here costs
    // nothing when it has already happened and fixes it when it has not.
    await moveToReview(authorized.applicationId);
    return { status: "already_submitted", ...submitted };
  }

  const moved = await moveToReview(authorized.applicationId);
  if (!moved) {
    // The submission is recorded and the customer's work is safe; only the
    // staff-facing status lagged. Reported as an error so it is not silently
    // swallowed — the repair path above resolves it on the next attempt.
    console.error("[portal-submission] Submitted but status transition failed for", authorized.applicationId);
  }

  const application = await getApplicationById(SYSTEM_NATIONAL_SCOPE, authorized.applicationId);
  if (application.status !== "ok") return { status: "error", code: "SUBMIT_FAILED" };

  return {
    status: "ok",
    applicationNumber: application.application.applicationNumber,
    submittedAt,
  };
}

/**
 * `new -> in_review` through the EXISTING transition service.
 *
 * Not a direct UPDATE: `setApplicationStatus` owns the legal-transition table
 * and the status_changed_at/source bookkeeping that
 * `applications_status_new_pair_check` depends on. Source is the channel, actor
 * is null — a public applicant is not a CRM profile.
 *
 * Returns false rather than throwing when the application has already moved,
 * which is what makes the repair path above safe to run unconditionally.
 */
async function moveToReview(applicationId: string): Promise<boolean> {
  const result = await setApplicationStatus(applicationId, "in_review", "website_form", null);
  return result.status === "ok";
}

/** The confirmation-safe facts about an application that is already submitted. */
async function loadSubmittedState(
  token: string
): Promise<{ applicationNumber: string; submittedAt: string } | undefined> {
  const state = await getPortalSubmissionState(token);
  return state?.submittedAt
    ? { applicationNumber: state.applicationNumber, submittedAt: state.submittedAt }
    : undefined;
}

export interface PortalSubmissionState {
  intakeId: string;
  applicationId: string;
  applicationNumber: string;
  /** Undefined while the application is still a draft. */
  submittedAt?: string;
}

/**
 * Read whether this token's application has been submitted, and its number.
 *
 * Deliberately READ-ONLY and deliberately NOT routed through
 * `authorizePortalWrite`: that helper refuses a submitted intake by design, so
 * using it here would make the confirmation screen unreachable for exactly the
 * people who need it. The token still has to resolve, and nothing beyond the
 * application number and timestamp is returned — no status, no staff notes, no
 * internal state.
 */
export async function getPortalSubmissionState(
  token: string
): Promise<PortalSubmissionState | undefined> {
  const { resolveContinuationToken } = await import("@/lib/services/continuation-tokens");
  const resolved = await resolveContinuationToken(token);
  if (resolved.status !== "ok" || !resolved.resolved.applicationId) return undefined;

  const [intakeResult, application] = await Promise.all([
    getApplicationIntakeById(resolved.resolved.intakeId),
    getApplicationById(SYSTEM_NATIONAL_SCOPE, resolved.resolved.applicationId),
  ]);
  if (intakeResult.status !== "ok" || application.status !== "ok") return undefined;

  return {
    intakeId: resolved.resolved.intakeId,
    applicationId: resolved.resolved.applicationId,
    applicationNumber: application.application.applicationNumber,
    submittedAt: intakeResult.intake.submittedAt,
  };
}
