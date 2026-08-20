"use server";

import { authorizePortalWrite } from "@/lib/services/portal-snapshot";
import { getApplicationById } from "@/lib/services/applications";
import { getProductById } from "@/lib/services/products";
import { SYSTEM_NATIONAL_SCOPE } from "@/lib/services/branch-scope-query";
import { updateIntakeDraftState } from "@/lib/services/application-intakes";
import {
  saveBankAccount,
  saveBusinessProfile,
  saveCollateral,
  saveEmployment,
  saveFinancialProfile,
  saveGuarantor,
  saveObligations,
  type Step2WriteResult,
} from "@/lib/services/application-step2-write";
import {
  validatePortalStepTwo,
  type Step2Errors,
  type Step2Mode,
  type Step2Payload,
} from "@/lib/validation/portal-step-two";

/**
 * ============================================================================
 * SAVING STEP 2 (26B-2)
 * ============================================================================
 *
 * A Server Action, for the same reasons Step 1's is: the framework's own Origin
 * checking, and no Supabase key of any kind in the client bundle.
 *
 * ----------------------------------------------------------------------------
 * WHAT THE BROWSER IS ALLOWED TO NAME
 * ----------------------------------------------------------------------------
 * The continuation token, the field values, and the ids of obligation rows.
 * That is the complete list.
 *
 * It does NOT name the application, the client, the intake, the branch, or the
 * product. All five are resolved server-side from the token — so a payload
 * cannot aim this action at another applicant's record, and cannot claim to be
 * a different product in order to reach fields its own product does not have.
 * Obligation ids are the one browser-supplied row reference, and the write
 * layer verifies each against the authorized application before touching it.
 */

export type Step2ActionResult =
  | { status: "ok"; complete: boolean }
  | { status: "invalid"; fieldErrors: Step2Errors }
  | {
      status: "error";
      code: "NOT_AUTHORIZED" | "NO_APPLICATION" | "FORBIDDEN_ROW" | "SAVE_FAILED";
    };

export interface Step2SubmitInput {
  continuationToken: string;
  mode: Step2Mode;
  payload: Step2Payload;
}

function firstFailure(results: Step2WriteResult[]): Step2WriteResult | undefined {
  return results.find((r) => r.status === "error");
}

export async function submitPortalStepTwo(input: Step2SubmitInput): Promise<Step2ActionResult> {
  const authorized = await authorizePortalWrite(input.continuationToken);
  if (authorized.status !== "ok") {
    // Expired, revoked, unknown, or already submitted — all mean the same
    // thing to the customer: this link can no longer be edited.
    return { status: "error", code: "NOT_AUTHORIZED" };
  }

  const applicationId = authorized.applicationId;
  if (!applicationId) {
    // Step 2's data hangs off an Application, and this lead has not become one
    // yet. See the page component for why that happens and what it shows.
    return { status: "error", code: "NO_APPLICATION" };
  }

  const application = await getApplicationById(SYSTEM_NATIONAL_SCOPE, applicationId);
  if (application.status !== "ok") return { status: "error", code: "SAVE_FAILED" };

  const product = await getProductById(application.application.productId);
  if (product.status !== "ok" || !product.product.applicationCode) {
    return { status: "error", code: "SAVE_FAILED" };
  }
  // THE SERVER'S ANSWER, not the browser's. Every branch below keys off this.
  const productCode = product.product.applicationCode;

  const validation = validatePortalStepTwo(productCode, input.payload, input.mode);
  if (validation.status === "error") {
    return { status: "invalid", fieldErrors: validation.fieldErrors };
  }
  const value = validation.value;

  // Business financing belongs to the COMPANY; everything else is the
  // applicant's own. Reconciling the wrong owner would delete the other list.
  const obligationOwner = productCode === "E" ? "business" : "applicant";

  const results: Step2WriteResult[] = [];

  if (value.employment) results.push(await saveEmployment(applicationId, value.employment));
  if (productCode !== "E") {
    results.push(await saveFinancialProfile(applicationId, value.monthlyExpenses));
  }
  results.push(await saveObligations(applicationId, obligationOwner, value.obligations));
  if (productCode !== "E") {
    results.push(await saveGuarantor(applicationId, value.guarantor));
  }
  if (productCode === "D") results.push(await saveBankAccount(applicationId, value.bankAccount));
  if (productCode === "V" || productCode === "E") {
    results.push(await saveCollateral(applicationId, value.collateral));
  }
  if (productCode === "E") results.push(await saveBusinessProfile(applicationId, value.business));

  const failure = firstFailure(results);
  if (failure && failure.status === "error") {
    return {
      status: "error",
      code: failure.code === "FORBIDDEN_ROW" ? "FORBIDDEN_ROW" : "SAVE_FAILED",
    };
  }

  // Bookmark + activity. Deliberately AFTER the writes: a save that failed
  // should not leave the customer recorded as having moved on.
  await updateIntakeDraftState(authorized.intakeId, "financial_data");

  return { status: "ok", complete: input.mode === "complete" };
}
