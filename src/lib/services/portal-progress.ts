import "server-only";
import { SYSTEM_NATIONAL_SCOPE } from "@/lib/services/branch-scope-query";
import { getApplicationById } from "@/lib/services/applications";
import { getApplicationStep2 } from "@/lib/services/application-step2";
import { getRequirementSlotsByApplicationId, evaluateFileCompletion } from "@/lib/services/requirement-slots";
import { getEvidenceByApplicationId } from "@/lib/services/document-evidence";
import { getProductById } from "@/lib/services/products";
import {
  areRequiredDeclarationsComplete,
  getApplicationDeclarations,
} from "@/lib/services/application-declarations";
import { PORTAL_STEP_ORDER } from "@/types";
import type {
  ApplicationDeclarationSet,
  ApplicationIntake,
  ApplicationStep2,
  PortalProgress,
  PortalStep,
  RequirementSlot,
} from "@/types";

/**
 * ============================================================================
 * HOW FAR ALONG IS THIS APPLICATION? (26A-4)
 * ============================================================================
 *
 * Everything here is DERIVED. There is no stored percentage and no stored
 * "completed" flag, because both are caches that go stale silently: add a
 * requirement, let a conditional become relevant, reject a blurry pay slip, and
 * a stored number keeps cheerfully reporting the old answer. Recomputing from
 * the rows that actually exist costs a few queries and cannot lie.
 *
 * `application_intakes.current_step` is a BOOKMARK, not an input to any decision
 * below. Resume routing uses the EARLIEST incomplete step, so an applicant
 * whose earlier answer stopped being valid is taken back to fix it rather than
 * waved forward past it.
 *
 * ----------------------------------------------------------------------------
 * WHY THIS USES SYSTEM_NATIONAL_SCOPE
 * ----------------------------------------------------------------------------
 * Branch scope answers "WHICH STAFF may operate here?". An applicant is not
 * staff and has no branch, so applying a branch predicate to their own
 * application would be a category error — and, worse, would make an
 * applicant's access depend on which ODL office happened to own their file.
 *
 * The applicant's authorization is the CONTINUATION TOKEN, and it is strictly
 * tighter than any branch scope: it resolves to exactly ONE application id,
 * server-side, from a value the caller cannot forge. Callers in this module
 * must have established that id through `resolveContinuationToken` (the portal)
 * or through a branch-scoped read (the CRM) before calling in. The system scope
 * here widens nothing that the caller had not already proven.
 */

/**
 * The minimum identity Step 1 needs.
 *
 * These are the same fields the 15B intake engine requires before it will
 * create a Client — deliberately, so the portal cannot report Step 1 "complete"
 * for a lead the engine would then refuse to process. Contact is `email OR
 * phone` because a walk-in applicant may genuinely have only one.
 */
function hasApplicantIdentity(intake: ApplicationIntake): boolean {
  return Boolean(
    intake.applicantFullName &&
      intake.applicantIdentificationType &&
      intake.applicantIdentificationNumber &&
      (intake.applicantEmail || intake.applicantPhone)
  );
}

/**
 * STEP 1 — identity supplied AND a product chosen.
 *
 * "Product chosen" means an Application EXISTS, not that a code was typed into
 * the lead form. The application is the thing that carries the official ODL
 * number, so its existence is the only honest evidence that the selection
 * actually took effect.
 */
export function isStep1Complete(intake: ApplicationIntake, applicationId?: string): boolean {
  return hasApplicantIdentity(intake) && Boolean(applicationId);
}

/**
 * STEP 2 — the product-specific financial picture.
 *
 * ⚠️ THESE RULES ARE DERIVED FROM PRODUCT MECHANICS, NOT FROM AN ODL-CONFIRMED
 * UNDERWRITING CHECKLIST. Each is the minimum without which the product cannot
 * function at all — a payroll-deduction loan that does not know the employer
 * cannot be deducted; a direct-debit loan with no bank account has nothing to
 * debit. They are a floor for "the applicant finished the form", NOT an
 * approval criterion, and ODL should confirm them before the portal ships.
 *
 * Underwriting thresholds deliberately live nowhere near here — 26A-1's loan
 * criteria own that, and duplicating any of it would create a second answer
 * that drifts.
 */
export function isStep2Complete(productCode: string, step2: ApplicationStep2): boolean {
  const employment = step2.employment;
  const hasIncome = Boolean(employment && employment.monthlyIncome !== undefined);

  switch (productCode) {
    case "N":
      // Payroll deduction: the employer IS the repayment mechanism, and
      // whether they permit deduction decides whether the product is possible.
      return Boolean(
        employment &&
          hasIncome &&
          employment.employerName &&
          employment.payrollDeductionAvailable !== undefined
      );

    case "D":
      // Direct debit: needs income, and an account to debit.
      return hasIncome && step2.bankAccounts.length > 0;

    case "V":
      // Vehicle title: needs income, and a vehicle actually identified.
      return (
        hasIncome &&
        step2.collateral.some(
          (item) =>
            item.collateralType === "vehicle" &&
            Boolean(item.vehicleMake && item.vehicleModel && item.vehicleYear && item.vehiclePlate)
        )
      );

    case "E": {
      // Business: the borrower's economics are the COMPANY's, not the
      // signatory's — which is why this branch ignores personal employment
      // entirely rather than also demanding it.
      const business = step2.businessProfile;
      return Boolean(
        business &&
          business.legalName &&
          business.registrationNumber &&
          business.averageMonthlyRevenue !== undefined &&
          business.loanPurpose
      );
    }

    default:
      // An unknown product cannot be declared complete. Fail closed: a future
      // product added without a rule here reports incomplete rather than
      // silently waving the applicant through Step 2.
      return false;
  }
}

/**
 * Which requirement slots count toward the APPLICANT's progress.
 *
 * Three exclusions, each deliberate:
 *
 *   * NOT `applicantVisible` — internal checks and staff-produced artefacts.
 *     Counting these would show an applicant a bar they cannot move.
 *   * NOT `required` — optional requirements are genuinely optional.
 *   * `minFiles === null` — completion for these is not measured in files at
 *     all (an internal approval, a phone verification). 26A-3's
 *     `evaluateFileCompletion` never marks them complete, so including them
 *     would permanently pin the bar below 100%.
 *
 * IRRELEVANT CONDITIONALS NEED NO FILTER HERE, and that is by design: 26A-3
 * does not MATERIALISE a conditional requirement until its condition is met, so
 * an applicant with no guarantor simply has no guarantor slots to count. The
 * absence is structural rather than a rule this function has to remember.
 */
export function applicantFacingSlots(slots: RequirementSlot[]): RequirementSlot[] {
  return slots.filter(
    (slot) => slot.applicantVisible && slot.required && slot.minFiles !== null && slot.minFiles !== undefined
  );
}

/**
 * STEP 3 — every applicable document uploaded AND every declaration accepted.
 *
 * Both halves are required. Documents alone are not Step 3: PEP, source of
 * funds and credit consent are part of what the applicant must complete, they
 * are simply not files (see application-declarations.ts).
 *
 * File counts come from evidence rows, and completion from 26A-3's own
 * `evaluateFileCompletion`, so `min_files` semantics are honoured here rather
 * than re-implemented — one consolidated six-month bank PDF completes a
 * requirement whose minimum is 1, and two pay slips are needed where the
 * minimum is 2.
 */
export function isStep3Complete(
  slots: RequirementSlot[],
  fileCountsBySlotId: Map<string, number>,
  declarations: ApplicationDeclarationSet
): boolean {
  const relevant = applicantFacingSlots(slots);
  const documentsComplete = relevant.every(
    (slot) =>
      evaluateFileCompletion(
        { id: slot.id, minFiles: slot.minFiles ?? null },
        fileCountsBySlotId.get(slot.id) ?? 0
      ).isFileComplete
  );
  return documentsComplete && areRequiredDeclarationsComplete(declarations);
}

/**
 * Turn per-step verdicts into a resume target and a percentage.
 *
 * FIRST PENDING, NOT FURTHEST REACHED. `find` returns the EARLIEST incomplete
 * step, which is what makes "your guarantor withdrew, go back to Step 2"
 * possible. A model that tracked the furthest point reached would strand the
 * applicant at Review with an invisible hole behind them.
 *
 * `review` completes only when everything before it does — it is a read-back,
 * so it has no completion rule of its own.
 */
export function summariseProgress(completed: Set<PortalStep>): PortalProgress {
  const firstPendingStep = PORTAL_STEP_ORDER.find((step) => !completed.has(step));
  return {
    completedSteps: PORTAL_STEP_ORDER.filter((step) => completed.has(step)),
    firstPendingStep,
    percentComplete: Math.round((completed.size / PORTAL_STEP_ORDER.length) * 100),
  };
}

export type EvaluatePortalProgressResult =
  | { status: "ok"; progress: PortalProgress }
  | { status: "error"; code: "APPLICATION_NOT_FOUND" | "EVALUATION_FAILED" };

/**
 * The whole picture for one intake.
 *
 * Short-circuits before Step 1 is done: with no application there is nothing to
 * ask Step 2 or Step 3 about, and issuing those queries anyway would be work
 * whose answer is already known.
 */
export async function evaluatePortalProgress(
  intake: ApplicationIntake
): Promise<EvaluatePortalProgressResult> {
  const completed = new Set<PortalStep>();
  const applicationId = intake.createdApplicationId;

  if (hasApplicantIdentity(intake)) {
    completed.add("applicant_data");
  }
  if (!isStep1Complete(intake, applicationId) || !applicationId) {
    return { status: "ok", progress: summariseProgress(completed) };
  }
  completed.add("loan_selection");

  const application = await getApplicationById(SYSTEM_NATIONAL_SCOPE, applicationId);
  if (application.status !== "ok") {
    return { status: "error", code: "APPLICATION_NOT_FOUND" };
  }

  const [productResult, step2Result, slotsResult, evidenceResult, declarationsResult] =
    await Promise.all([
      // The product CODE is what the Step 2 rules switch on, and `Application`
      // carries only productId — resolved here rather than threaded through, so
      // the rules stay keyed to the stable business code (N/D/V/E) instead of a
      // UUID that means nothing when read.
      getProductById(application.application.productId),
      getApplicationStep2(SYSTEM_NATIONAL_SCOPE, applicationId),
      getRequirementSlotsByApplicationId(SYSTEM_NATIONAL_SCOPE, applicationId),
      getEvidenceByApplicationId(SYSTEM_NATIONAL_SCOPE, applicationId),
      getApplicationDeclarations(applicationId),
    ]);

  if (
    productResult.status !== "ok" ||
    step2Result.status !== "ok" ||
    slotsResult.status !== "ok" ||
    evidenceResult.status !== "ok" ||
    declarationsResult.status !== "ok"
  ) {
    return { status: "error", code: "EVALUATION_FAILED" };
  }

  if (isStep2Complete(productResult.product.code, step2Result.step2)) {
    completed.add("financial_data");
  } else {
    return { status: "ok", progress: summariseProgress(completed) };
  }

  const fileCounts = new Map<string, number>();
  for (const evidence of evidenceResult.evidence) {
    fileCounts.set(evidence.requirementSlotId, (fileCounts.get(evidence.requirementSlotId) ?? 0) + 1);
  }

  if (isStep3Complete(slotsResult.requirementSlots, fileCounts, declarationsResult.declarations)) {
    completed.add("documents");
    // Review is a read-back of work already finished; nothing else gates it.
    completed.add("review");
  }

  return { status: "ok", progress: summariseProgress(completed) };
}
