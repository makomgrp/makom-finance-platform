"use server";

import { authorizePortalWrite } from "@/lib/services/portal-snapshot";
import { getApplicationById } from "@/lib/services/applications";
import { syncClientCurrentProfile } from "@/lib/services/clients";
import { getProductById } from "@/lib/services/products";
import { SYSTEM_NATIONAL_SCOPE } from "@/lib/services/branch-scope-query";
import { updateIntakeDraftState } from "@/lib/services/application-intakes";
import {
  saveBankAccount,
  saveBusinessProfile,
  saveCollateral,
  saveEmployment,
  saveClientPrimarySocialNetwork,
  saveFinancialProfile,
  saveGuarantor,
  saveObligations,
  type Step2WriteResult,
} from "@/lib/services/application-step2-write";
import { productAsksForGuarantor } from "@/lib/config/application";
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
  // MILESTONE 26B-25 — los otros ingresos se preguntan en los CUATRO productos,
  // así que el perfil financiero deja de escribirse solo para N/D/V. Para el
  // producto empresarial `monthlyExpenses` sigue sin recogerse y viaja
  // undefined, que es lo que ya significaba antes.
  results.push(
    await saveFinancialProfile(
      applicationId,
      productCode === "E" ? undefined : value.monthlyExpenses,
      value.hasAdditionalIncome === undefined
        ? undefined
        : {
            has: value.hasAdditionalIncome,
            monthlyAmount: value.additionalMonthlyIncome,
            source: value.additionalIncomeSource,
          }
    )
  );
  // La red social es del cliente, no de la solicitud — ver saveClientPrimarySocialNetwork.
  results.push(
    await saveClientPrimarySocialNetwork(
      application.application.clientId,
      value.primarySocialNetwork,
      value.primarySocialNetworkOther
    )
  );
  results.push(await saveObligations(applicationId, obligationOwner, value.obligations));
  if (productAsksForGuarantor(productCode)) {
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

  // MILESTONE 26B-6C — THE CLIENT ROW LEARNS WHERE THEY WORK NOW.
  //
  // Step 2's employment answers are, at this instant, the most recent thing ODL
  // knows about this person's job. `application_employment` keeps them as this
  // application's permanent snapshot — that row is not touched again — and the
  // `clients` row additionally carries them forward as the CURRENT profile, so
  // "Datos personales" stops showing dashes for someone who has told us twice.
  //
  // These are the same three facts the client profile has always had columns
  // for (employer_name, position, monthly_salary), which is why they are the
  // three that sync. Nothing else about the application is mirrored: staff read
  // application data from the application, and 26B-5B's rule that a dossier
  // must not source employment from `clients` is unchanged by this.
  //
  // NON-FATAL. The application's own data is already committed above. A failed
  // mirror is logged inside the service and must not turn a successful save
  // into an error the customer sees; the sync is idempotent and the next save
  // retries it.
  if (value.employment) {
    await syncClientCurrentProfile(application.application.clientId, {
      employerName: value.employment.employerName,
      position: value.employment.jobTitle,
      monthlySalary: value.employment.monthlyIncome,
      source: "website_form",
    });
  }

  // Bookmark + activity. Deliberately AFTER the writes: a save that failed
  // should not leave the customer recorded as having moved on.
  await updateIntakeDraftState(authorized.intakeId, "financial_data");

  return { status: "ok", complete: input.mode === "complete" };
}
