import "server-only";
import { after } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { SYSTEM_NATIONAL_SCOPE } from "@/lib/services/branch-scope-query";
import { authorizePortalWrite } from "@/lib/services/portal-snapshot";
import { getApplicationIntakeById } from "@/lib/services/application-intakes";
import { getApplicationById } from "@/lib/services/applications";
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
 * THIS IS WHERE THE OFFICIAL NUMBER IS BORN (26B-5)
 * ----------------------------------------------------------------------------
 * Until 26B-5 the application row was numbered the moment the portal promoted a
 * lead, at Step 1, so abandoning the journey at Step 3 still burned a number and
 * put the customer in Solicitudes as though ODL had received an application.
 * Now the row is created as a DRAFT with no number, and `submit_application()`
 * is the only thing in the system that can give it one.
 *
 * ----------------------------------------------------------------------------
 * IDEMPOTENCY IS A DATABASE GUARANTEE, NOT A UI ONE
 * ----------------------------------------------------------------------------
 * Two independent guards, each doing a different job:
 *
 *   1. `submit_application()` — takes a row lock, and allocates a number only
 *      if the row does not already have one. This is what makes it impossible
 *      for two concurrent submits to consume two numbers: the second waits for
 *      the first to commit, then sees the number and returns it unchanged.
 *
 *   2. The guarded `submitted_at` UPDATE — decides which caller REPORTS the
 *      submission. Exactly one matches a row; the other reports
 *      `already_submitted`.
 *
 * The first protects the sequence, the second protects the customer-facing
 * story. Neither depends on the button being disabled.
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

  // THE FORMAL BOUNDARY. One statement allocates the official number and moves
  // the row draft -> in_review. Deliberately NOT setApplicationStatus(): that
  // service knows nothing about numbering, and APPLICATION_STATUS_TRANSITIONS
  // gives `draft` no outgoing transitions precisely so this RPC is the only
  // door out of it.
  const { data: allocatedNumber, error: submitError } = await supabase.rpc("submit_application", {
    p_application_id: authorized.applicationId,
    p_source: "website_form",
  });

  if (submitError || typeof allocatedNumber !== "string" || allocatedNumber.length === 0) {
    console.error(
      "[portal-submission] Formal submission failed:",
      submitError?.message ?? "no application number returned"
    );
    return { status: "error", code: "SUBMIT_FAILED" };
  }

  // WHO GETS TO SAY IT WAS THEM. The number above is already safe; this decides
  // which of two racing callers reports the submission and which is told it had
  // already happened.
  const submittedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from("application_intakes")
    .update({ submitted_at: submittedAt, last_activity_at: submittedAt })
    .eq("id", authorized.intakeId)
    .is("submitted_at", null)
    .select("id")
    .maybeSingle();

  if (claimError) {
    // The application IS submitted and numbered — only the portal's own marker
    // lagged. Reported rather than swallowed; the next attempt re-runs the RPC
    // (which returns the same number) and re-tries this update, so it heals.
    console.error("[portal-submission] Numbered but intake claim failed:", claimError.message);
    return { status: "error", code: "SUBMIT_FAILED" };
  }

  if (!claimed) {
    const submitted = await loadSubmittedState(token);
    return {
      status: "already_submitted",
      applicationNumber: allocatedNumber,
      submittedAt: submitted?.submittedAt ?? submittedAt,
    };
  }

  // MILESTONE 26B-26B — EL ÚLTIMO `completed`, EN EL MOMENTO DE LA CONVERSIÓN.
  //
  // Enviar es lo único que puede completar `review`, y la ruta de escritura
  // normal ya no sirve para registrarlo: a partir de aquí `submitted_at` está
  // puesto y toda escritura de borrador queda —correctamente— rechazada.
  //
  // Los eventos son observaciones, no ediciones, así que registrarlos después
  // del envío no reabre nada. En la práctica casi siempre son duplicados que el
  // índice absorbe; existe para el caso en que la última acción del solicitante
  // completó un paso sin pasar por el guardado de un paso.
  after(async () => {
    const { recordCompletedSteps } = await import("@/lib/services/portal-funnel-events");
    await recordCompletedSteps(authorized.intakeId);
  });

  // ---------------------------------------------------------------------------
  // MILESTONE 26B-17 — THE CONFIRMATION EMAIL
  //
  // Scheduled HERE, and nowhere else, because reaching this line means this
  // caller is the one that won the guarded UPDATE above. That election already
  // decides which of two racing submits reports the submission; reusing it to
  // decide which one sends the email means a double click cannot produce two
  // confirmations without any new locking of its own. The send key is a second,
  // durable barrier for the case this cannot see — a retry in a later request.
  //
  // `after()` rather than an await: the applicant's confirmation screen must not
  // wait on a mail server, and an SMTP timeout must never be able to turn a
  // successfully submitted application into a visible error. Everything below
  // runs once the response has already been sent.
  // ---------------------------------------------------------------------------
  after(async () => {
    try {
      const { sendApplicationConfirmationEmail } = await import(
        "@/lib/services/portal-confirmation-email"
      );
      const outcome = await sendApplicationConfirmationEmail(authorized.intakeId);
      if (outcome.status !== "sent" && outcome.status !== "skipped") {
        console.error(
          "[portal-submission] Confirmation email not delivered:",
          JSON.stringify({ applicationNumber: allocatedNumber, outcome })
        );
      }
    } catch (error) {
      // The application is submitted and numbered. Nothing about a failure here
      // may propagate — this callback runs after the response and has no way to
      // report to the applicant even if it should, which it should not.
      console.error(
        "[portal-submission] Confirmation email threw:",
        error instanceof Error ? error.message : "unknown error"
      );
    }
  });

  return { status: "ok", applicationNumber: allocatedNumber, submittedAt };
}

/** The confirmation-safe facts about an application that is already submitted. */
async function loadSubmittedState(
  token: string
): Promise<{ applicationNumber: string; submittedAt: string } | undefined> {
  const state = await getPortalSubmissionState(token);
  // Both must be present: a submitted application always has a number
  // (applications_draft_number_pair_check), so a state missing either is not a
  // submitted one and must not be reported as such.
  return state?.submittedAt && state.applicationNumber
    ? { applicationNumber: state.applicationNumber, submittedAt: state.submittedAt }
    : undefined;
}

export interface PortalSubmissionState {
  intakeId: string;
  applicationId: string;
  /** Undefined while the application is still a draft (26B-5). */
  applicationNumber?: string;
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
