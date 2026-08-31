import "server-only";
import { after } from "next/server";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  createApplicationIntake,
  getApplicationIntakeById,
  getApplicationIntakeBySubmission,
} from "@/lib/services/application-intakes";
import { processApplicationIntake } from "@/lib/services/application-intake-processing";
import { issueContinuationToken } from "@/lib/services/continuation-tokens";
import type { NormalizedPortalStepOne } from "@/lib/validation/portal-step-one";
import type { ApplicationIntake } from "@/types";
import type { Locale } from "@/i18n/config";

/**
 * ============================================================================
 * SAVING STEP 1 (26B-1)
 * ============================================================================
 *
 * The one server-side path that turns a Step 1 submission into persisted state.
 *
 * ----------------------------------------------------------------------------
 * LEAD IS NOT APPLICATION, AND STEP 1 DOES NOT DECIDE WHICH ONE HAPPENS
 * ----------------------------------------------------------------------------
 * Step 1 always writes a LEAD (`application_intakes`). Whether that lead can
 * additionally become a formal Application is decided by the existing 15B
 * intake engine, which this module CALLS rather than reimplements — so there is
 * exactly one place in the codebase that creates an Application from an intake,
 * and exactly one place that mints an official ODL number.
 *
 * MILESTONE 26B-2A: a Step-1-only lead now becomes a real Application. Those
 * five extra client columns are nullable, so identity plus a product and an
 * amount is enough — which is precisely what Step 1 collects. A lead still
 * comes back `awaiting_completion` when it genuinely lacks a product or an
 * amount, which remains a valid, non-error draft state.
 *
 * ----------------------------------------------------------------------------
 * IDEMPOTENCY — THE THING THAT MUST NOT GO WRONG
 * ----------------------------------------------------------------------------
 * An official application number, once issued, is permanent. A double-clicked
 * button that created two Applications would burn a number and leave ODL with
 * two records of one customer. Three independent guards prevent it:
 *
 *   1. `submissionId` — minted ONCE per browser form instance and reused on
 *      every retry, so `unique(channel, submission_id)` absorbs a duplicate
 *      POST at the database level. This is the 15C mechanism, unchanged.
 *   2. `intakeId` — once a lead exists, the portal updates that row rather
 *      than inserting another.
 *   3. `processApplicationIntake` is itself idempotent: an intake already at
 *      'processed' returns `already_processed` with the existing application
 *      id and creates nothing.
 *
 * ----------------------------------------------------------------------------
 * PRODUCT CHANGE AFTER AN APPLICATION EXISTS
 * ----------------------------------------------------------------------------
 * `applications.product_id` has no update path anywhere in this schema — the
 * column's own migration comment records that product switching is deliberately
 * unsupported, and 26A-3 snapshots the product's document requirements onto the
 * application when it is created.
 *
 * So once an Application exists, the product is LOCKED and this module refuses
 * the change (`PRODUCT_LOCKED`) rather than doing anything clever. The
 * alternatives were both unacceptable: silently ignoring the customer's new
 * choice would show them a product they did not pick, and delete-and-recreate
 * would burn an official number every time someone changed their mind. Before
 * an Application exists the product is freely changeable, which covers the
 * realistic case of a customer reconsidering during Step 1.
 */

export type PortalStepOneOutcome =
  /** Lead saved. No Application yet — normal for a Step-1-only customer. */
  | { status: "saved_lead"; intakeId: string; missing: string[] }
  /** Lead saved AND promoted to a formal Application with an official number. */
  | { status: "application_created"; intakeId: string; applicationId: string }
  /** A human needs to look at this lead. Rare; genuine data conflicts only. */
  | { status: "needs_review"; intakeId: string; reason: string }
  | {
      status: "error";
      code: "PRODUCT_LOCKED" | "INTAKE_NOT_FOUND" | "SAVE_FAILED";
      intakeId?: string;
    };

export interface SavePortalStepOneInput extends NormalizedPortalStepOne {
  /** Existing lead, when the customer arrived through a continuation link. */
  intakeId?: string;
  /** Stable per form instance. Absorbs double clicks and network retries. */
  submissionId: string;
  /**
   * MILESTONE 26B-17 — the language this applicant is filling the form in.
   *
   * Written on every Step 1 save rather than only at creation: somebody who
   * switches the portal to English halfway through has told us something, and
   * the confirmation email should follow them. The guarded UPDATE below still
   * refuses a submitted application, so this cannot change after the fact.
   */
  locale: Locale;
}

/**
 * The applicant columns Step 1 owns.
 *
 * NARROW BY CONSTRUCTION: this update names six columns plus the loan basics
 * and touches nothing else. It cannot reach `status`, `matched_client_id`,
 * `created_application_id`, `review_reason` or `branch_id` — the intake
 * engine's vocabulary — so a public form submission can never drive the
 * engine's state machine or reassign a lead.
 */
async function applyStepOneToIntake(
  intakeId: string,
  input: NormalizedPortalStepOne & { locale: Locale }
): Promise<boolean> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("application_intakes")
    .update({
      applicant_full_name: input.fullName,
      applicant_identification_type: input.identificationType,
      applicant_identification_number: input.identificationNumber,
      applicant_email: input.email,
      applicant_phone: input.phone,
      requested_product_code: input.productCode,
      requested_amount: input.requestedAmount,
      // MILESTONE 26B-1B — the term IS written again, and writing null is
      // deliberate.
      //
      // 26B-1A omitted this column precisely because the field was hidden, and
      // a hidden field must never be silently deleted. Now that Step 1 shows an
      // optional "Plazo deseado" — prefilled with whatever the intake already
      // holds — the submitted value is authoritative: what the customer sees is
      // what they are confirming. So leaving it blank CLEARS it to NULL, which
      // is the only way an optional field the customer can empty actually
      // behaves as optional. NULL stays "not chosen yet"; it is never 0.
      requested_term_months: input.requestedTermMonths ?? null,
      locale: input.locale,
      current_step: "loan_selection",
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", intakeId)
    // A submitted application is with ODL; a late Step 1 edit must not
    // silently change something a human has already begun assessing. Part of
    // the WHERE clause rather than a prior read, so it cannot be raced.
    .is("submitted_at", null);

  if (error) {
    console.error("[portal-step-one service] Failed to apply Step 1 to intake:", error.message);
    return false;
  }
  return true;
}

/**
 * Persist Step 1 and let the intake engine decide whether an Application
 * follows.
 */
export async function savePortalStepOne(
  input: SavePortalStepOneInput
): Promise<PortalStepOneOutcome> {
  let intake: ApplicationIntake | undefined;

  if (input.intakeId) {
    const loaded = await getApplicationIntakeById(input.intakeId);
    if (loaded.status !== "ok") {
      return { status: "error", code: "INTAKE_NOT_FOUND" };
    }
    intake = loaded.intake;
  } else {
    // No lead yet. Create one — or recover the one a previous attempt with
    // this same submissionId already created.
    const created = await createApplicationIntake({
      channel: "website_form",
      submissionId: input.submissionId,
      applicantFullName: input.fullName,
      applicantIdentificationType: input.identificationType,
      applicantIdentificationNumber: input.identificationNumber,
      applicantEmail: input.email,
      applicantPhone: input.phone,
      requestedProductCode: input.productCode,
      requestedAmount: input.requestedAmount,
      // Present only if the customer chose one; otherwise the column stays NULL.
      requestedTermMonths: input.requestedTermMonths,
      applicantLocale: input.locale,
    });

    if (created.status === "ok") {
      intake = created.intake;
    } else if (created.code === "DUPLICATE_SUBMISSION") {
      // The second half of a double click, or a retry after a response was
      // lost in transit. Resolve to the row the first attempt created rather
      // than erroring — this is the idempotency contract working, not a fault.
      const existing = await getApplicationIntakeBySubmission("website_form", input.submissionId);
      if (existing.status !== "ok") {
        return { status: "error", code: "SAVE_FAILED" };
      }
      intake = existing.intake;
    } else {
      return { status: "error", code: "SAVE_FAILED" };
    }
  }

  // PRODUCT LOCK. Checked before writing anything, so a refused change leaves
  // the lead exactly as it was.
  if (intake.createdApplicationId && intake.requestedProductCode !== input.productCode) {
    return { status: "error", code: "PRODUCT_LOCKED", intakeId: intake.id };
  }

  if (!(await applyStepOneToIntake(intake.id, input))) {
    return { status: "error", code: "SAVE_FAILED", intakeId: intake.id };
  }

  // Hand off to the ONE engine that may create an Application. Idempotent: an
  // already-processed intake returns its existing application id untouched.
  // STAGED: Step 1 of four. The application is created as a DRAFT so it can
  // hold Step 2 and Step 3 work, and stays unnumbered and invisible to
  // Solicitudes until the applicant presses "Enviar solicitud" (26B-5).
  const processed = await processApplicationIntake(intake.id, "staged_portal");

  // MILESTONE 26B-26B — `applicant_data` y `loan_selection` se completan aquí.
  //
  // El primero con la identidad; el segundo SOLO si el motor llegó a crear la
  // Application, que es lo que `isStep1Complete` considera "producto elegido de
  // verdad". Por eso se delega en `evaluatePortalProgress` en vez de deducirlo
  // del resultado de aquí arriba: un lead que quedó en `awaiting_completion`
  // eligió un producto en el formulario y no completó el paso, y esa diferencia
  // es exactamente la que el embudo tiene que conservar.
  after(async () => {
    const { recordCompletedSteps } = await import("@/lib/services/portal-funnel-events");
    await recordCompletedSteps(intake.id);
  });

  switch (processed.status) {
    case "processed":
    case "already_processed":
      return {
        status: "application_created",
        intakeId: intake.id,
        applicationId: processed.applicationId,
      };
    case "awaiting_completion":
      return { status: "saved_lead", intakeId: intake.id, missing: processed.missing };
    case "needs_review":
      return { status: "needs_review", intakeId: intake.id, reason: processed.reason };
    case "concurrent_processing":
      // Another request for this same lead is mid-flight. The lead is saved
      // either way, and the customer continues — reporting an error here would
      // be alarming and wrong.
      return { status: "saved_lead", intakeId: intake.id, missing: [] };
    default:
      return { status: "error", code: "SAVE_FAILED", intakeId: intake.id };
  }
}

/**
 * Mint the continuation link for a lead, if it does not already have a live one.
 *
 * Returns the RAW token, which the caller must hand to the customer (a future
 * milestone's email) and then drop. 26A-4 owns every security property here;
 * this is a thin call-through so the portal does not grow a second token system.
 *
 * NEVER LOGGED. The value is returned and nothing else — see continuation-tokens.ts.
 */
export async function ensureContinuationToken(intakeId: string): Promise<string | undefined> {
  const issued = await issueContinuationToken(intakeId);
  return issued.status === "ok" ? issued.issued.token : undefined;
}
