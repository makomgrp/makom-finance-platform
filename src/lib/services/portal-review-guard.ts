import "server-only";
import { redirect } from "next/navigation";
import { resolveContinuationToken } from "@/lib/services/continuation-tokens";
import { getApplicationIntakeById } from "@/lib/services/application-intakes";

/**
 * ============================================================================
 * MILESTONE 26B-18 — A LEAD WAITING ON A HUMAN IS NOT A BROKEN LINK
 * ============================================================================
 *
 * When the matching engine cannot safely decide who an applicant is, it parks
 * the intake at `needs_review` and — correctly — creates no application. Every
 * portal step after Step 1 is built around an application, so until now the
 * applicant was pushed into Step 2, which found nothing to render and answered
 * with a 404. A person who filled in a loan form honestly was shown a dead end.
 *
 * This guard turns that into a destination. It is the same shape as
 * `redirectIfSubmitted`, deliberately: both answer the question "is this link
 * still a form?", both redirect rather than teach four routes to draw the same
 * screen, and both leave the URL matching what is on screen so a reload or a
 * bookmark still lands somewhere sensible.
 *
 * ----------------------------------------------------------------------------
 * IT CHANGES NOTHING ABOUT MATCHING
 * ----------------------------------------------------------------------------
 * This reads a status. It does not re-run matching, does not link the intake to
 * anyone, does not create an application, and does not lower any threshold. The
 * lead stays exactly as the engine left it — which is the whole point: the
 * protection was right, only the experience was wrong.
 *
 * ----------------------------------------------------------------------------
 * DEFENCE IN DEPTH, NOT A REDIRECT ON ONE HAPPY PATH
 * ----------------------------------------------------------------------------
 * Step 1's form navigates straight to the review screen when the server says
 * `needs_review`, so the common case never touches this. But a customer who
 * bookmarked Step 2, pressed Back, or opened their continuation link days later
 * arrives without that navigation ever happening. Every step calls this guard,
 * so none of them can be reached with a lead that has no application.
 *
 * A FAILURE TO READ IS NOT A REASON TO REDIRECT. If the token or the intake
 * cannot be resolved, this returns silently and lets the caller apply its own
 * existing handling — an unreadable token is "this link is not usable", which
 * those routes already explain, and sending it to a review screen would tell
 * the customer something that may not be true.
 *
 * Callers must invoke this OUTSIDE a try/catch: `redirect` signals by throwing,
 * and a catch-all would swallow it and render the form anyway.
 */
export async function redirectIfUnderReview(token: string): Promise<void> {
  const resolved = await resolveContinuationToken(token);
  if (resolved.status !== "ok") return;

  const intakeResult = await getApplicationIntakeById(resolved.resolved.intakeId);
  if (intakeResult.status !== "ok") return;

  if (isUnderReview(intakeResult.intake.status, resolved.resolved.applicationId)) {
    redirect(`/solicitud/continuar/${token}/revision`);
  }
}

/**
 * Both conditions, because either one alone would be wrong.
 *
 * `needs_review` is the engine's verdict, and an intake carrying it must never
 * be walked forward. The missing application is the structural fact the steps
 * actually depend on. Requiring both means a lead that a human has since
 * resolved — status moved on, application created — stops being sent here the
 * moment that happens, with no extra bookkeeping.
 */
function isUnderReview(status: string, applicationId: string | undefined): boolean {
  return status === "needs_review" && !applicationId;
}

/**
 * The same question, answered without redirecting.
 *
 * The review screen itself cannot call the guard — it would redirect to itself
 * forever — but it still must refuse to render for a lead that is not actually
 * under review, or the URL would become a page anyone could show to anyone.
 */
export async function isIntakeUnderReview(token: string): Promise<boolean> {
  const resolved = await resolveContinuationToken(token);
  if (resolved.status !== "ok") return false;

  const intakeResult = await getApplicationIntakeById(resolved.resolved.intakeId);
  if (intakeResult.status !== "ok") return false;

  return isUnderReview(intakeResult.intake.status, resolved.resolved.applicationId);
}
