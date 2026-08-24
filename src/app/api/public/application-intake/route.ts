import { NextResponse, after, type NextRequest } from "next/server";
import { createApplicationIntake, getApplicationIntakeBySubmission } from "@/lib/services/application-intakes";
import { processApplicationIntake } from "@/lib/services/application-intake-processing";
import { getAllProducts } from "@/lib/services/products";
import { isHoneypotTriggered, validatePublicApplicationIntake } from "@/lib/validation/public-application-intake";
import { issueContinuationToken } from "@/lib/services/continuation-tokens";

/**
 * PUBLIC website Application Intake adapter (Milestone 15C). Untrusted
 * internet boundary — treat every input as hostile.
 *
 * This route is an ADAPTER ONLY. It does exactly three things: validate
 * an untrusted payload, call createApplicationIntake() with
 * channel = "website_form" (never read from the request), and call
 * processApplicationIntake() unchanged. It contains ZERO Client-matching
 * logic, ZERO Client-creation logic, ZERO Application-creation logic,
 * ZERO Requirement Slot logic, and ZERO Product-resolution logic beyond
 * checking a submitted code is one of the currently active codes (a UX
 * nicety — processApplicationIntake's own Product resolution is what
 * actually decides, and safely routes an unresolvable code to
 * needs_review regardless of what this route does). All of that
 * business logic belongs to, and stays in, the Milestone 15B Intake
 * Engine — see src/lib/services/application-intake-processing.ts.
 *
 * SAFE-INPUT CONSTRUCTION: the object passed to createApplicationIntake
 * below is built field-by-field from validatePublicApplicationIntake's
 * normalized output — never `...request body`. That is what makes it
 * structurally impossible for a caller to inject channel,
 * matched_client_id, created_application_id, review_reason, or any
 * automation-event field: those keys are never read anywhere in this
 * file, regardless of what a request body contains.
 *
 * SAME-ORIGIN CHECK: this is a public, unauthenticated endpoint, so
 * classic session-based CSRF protection does not apply (there is no
 * privileged session to forge — any visitor, authenticated or not, is
 * equally entitled to submit an application). The real risk here is a
 * third-party page silently auto-submitting this form on a visitor's
 * behalf. Next.js Server Actions get built-in Origin checking; a plain
 * Route Handler does not, so it is done explicitly below: when an Origin
 * header is present and does not match this request's own origin, the
 * request is rejected. Origin is not required to be present (some
 * legitimate same-origin requests may omit it), only required to match
 * when it is.
 *
 * ABUSE PROTECTION (Phase 1 — see the Milestone 15C implementation
 * report's Abuse/Rate-limit section for the full reasoning): a honeypot
 * field plus strict payload validation. Deliberately NOT an in-memory
 * request counter — that would silently reset per cold start and differ
 * per serverless instance, giving false confidence rather than real
 * protection. Genuine volumetric rate limiting needs platform
 * infrastructure this repo does not currently have (e.g. Vercel Firewall
 * rules or an Upstash-backed limiter) and is out of scope for this
 * milestone to fake.
 */

const CANONICAL_CHANNEL = "website_form";

function safeError(error: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, error, ...extra }, { status });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return safeError("FORBIDDEN", 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return safeError("INVALID_REQUEST", 400);
  }

  // Soft-reject: respond exactly like a real success, touch nothing.
  // Never tell a bot what tripped it.
  if (isHoneypotTriggered(body)) {
    return NextResponse.json({ success: true, submissionId: "unknown", status: "received" });
  }

  const productsResult = await getAllProducts();
  if (productsResult.status !== "ok") {
    // Genuine infrastructure failure — no intake was created, nothing to
    // report as "received." Log server-side only.
    console.error("[public application-intake] Failed to load products for validation");
    return safeError("SUBMISSION_FAILED", 500);
  }
  const activeProductCodes = new Set(
    productsResult.products.filter((p) => p.status === "active").map((p) => p.code)
  );

  const validation = validatePublicApplicationIntake(body, activeProductCodes);
  if (validation.status === "error") {
    return safeError("VALIDATION_ERROR", 400, { fieldErrors: validation.fieldErrors });
  }
  const input = validation.value;

  const created = await createApplicationIntake({
    channel: CANONICAL_CHANNEL,
    submissionId: input.submissionId,
    applicantFullName: input.fullName,
    applicantIdentificationType: input.identificationType,
    applicantIdentificationNumber: input.identificationNumber,
    applicantEmail: input.email,
    applicantPhone: input.phone,
    applicantBirthDate: input.birthDate,
    applicantNationality: input.nationality,
    applicantAddress: input.address,
    applicantPosition: input.position,
    employerName: input.employerName,
    monthlySalary: input.monthlySalary,
    requestedProductCode: input.requestedProductCode,
    requestedAmount: input.requestedAmount,
    requestedTermMonths: input.requestedTermMonths,
    applicantLocale: input.locale,
  });

  let intakeId: string;
  if (created.status === "ok") {
    intakeId = created.intake.id;
  } else if (created.code === "DUPLICATE_SUBMISSION") {
    // A retry of a submission this endpoint already accepted (double
    // click, network retry, browser resubmit) — resolve to the existing
    // row rather than erroring, per the idempotency contract.
    const existing = await getApplicationIntakeBySubmission(CANONICAL_CHANNEL, input.submissionId);
    if (existing.status !== "ok") {
      console.error("[public application-intake] Duplicate submission but could not reload it");
      return safeError("SUBMISSION_FAILED", 500);
    }
    intakeId = existing.intake.id;
  } else {
    console.error("[public application-intake] Failed to create intake:", created.code);
    return safeError("SUBMISSION_FAILED", 500);
  }

  // Processed synchronously (not fire-and-forget): this app has no
  // background job/queue infrastructure yet, so anything not awaited
  // here risks being killed mid-flight when the response is sent,
  // stranding the intake at 'received' with nothing to ever pick it back
  // up. The public response below deliberately does not distinguish
  // "processed" from "needs_review" either way — see this file's own
  // doc comment and the implementation report's Processing Behavior
  // section.
  try {
    // ONE SHOT: this endpoint receives the entire long website form in a single
    // POST, so the application is complete on arrival and is formally received
    // immediately — it gets its official number now.
    await processApplicationIntake(intakeId, "one_shot");

    // MILESTONE 26B-17 — the same confirmation the portal sends.
    //
    // Both public doors end at ONE boundary: a formal application is a formal
    // application whichever way it arrived, and the applicant should not be
    // able to tell which code path handled them. Composition, idempotency and
    // recording all live in that service; this only says when.
    //
    // Scheduled inside the try, so it runs only if processing actually
    // resolved, and via `after()` so the website's POST is answered before any
    // SMTP work begins. The service itself refuses to send for an intake that
    // did not become a formal, numbered application — a `needs_review` outcome
    // reaches it and is skipped rather than confirmed.
    after(async () => {
      try {
        const { sendApplicationConfirmationEmail } = await import(
          "@/lib/services/portal-confirmation-email"
        );
        const outcome = await sendApplicationConfirmationEmail(intakeId);
        if (outcome.status !== "sent" && outcome.status !== "skipped") {
          console.error(
            "[public application-intake] Confirmation email not delivered:",
            JSON.stringify({ intakeId, outcome })
          );
        }
      } catch (error) {
        console.error(
          "[public application-intake] Confirmation email threw for intake",
          intakeId,
          error instanceof Error ? error.message : "unknown error"
        );
      }
    });
  } catch (error) {
    // The intake row itself was already durably created above — that is
    // the honest thing being reported as "received" to the caller.
    // Processing failing here means it needs a future retry, not that
    // the submission was lost.
    console.error("[public application-intake] Processing failed for intake", intakeId, error);
  }

  // MILESTONE 26B-1 — THE PREFILL HANDOFF.
  //
  // The ODL website POSTs the customer's basic details here and needs a way to
  // send that customer onward to the portal with those details ALREADY FILLED.
  // The obvious approach — appending name, email and cédula to a redirect URL —
  // is exactly what this returns instead of, because a URL carrying PII ends up
  // in browser history, server access logs, analytics payloads and the Referer
  // header of every third-party asset the next page loads.
  //
  // So the caller gets an OPAQUE CONTINUATION TOKEN: 256 bits of randomness
  // that encode nothing about the person. The website redirects to
  // `${portalOrigin}/solicitud/continuar/${continuationToken}`, the portal
  // resolves it server-side, and the customer sees their own data without any
  // of it ever having travelled in a query string.
  //
  // REUSED, NOT REINVENTED: this is the 26A-4 token architecture unchanged —
  // same hashing, same 14-day expiry, same one-live-token-per-intake rotation,
  // same revocation. There is deliberately no second token system.
  //
  // A FAILURE HERE IS NOT A FAILURE OF THE SUBMISSION. The intake is already
  // durably stored by this point. If the token cannot be minted, the response
  // simply omits it and the website falls back to sending the customer to
  // /solicitud, where they fill Step 1 themselves — degraded, not broken.
  let continuationToken: string | undefined;
  const issued = await issueContinuationToken(intakeId);
  if (issued.status === "ok") {
    continuationToken = issued.issued.token;
  } else {
    console.error("[public application-intake] Could not issue a continuation token");
  }

  return NextResponse.json({
    success: true,
    submissionId: input.submissionId,
    status: "received",
    // Present on success only. NEVER logged — see continuation-tokens.ts.
    continuationToken,
    continuationPath: continuationToken ? `/solicitud/continuar/${continuationToken}` : undefined,
  });
}
