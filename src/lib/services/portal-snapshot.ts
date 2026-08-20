import "server-only";
import { SYSTEM_NATIONAL_SCOPE } from "@/lib/services/branch-scope-query";
import { getApplicationIntakeById, touchIntakeActivity } from "@/lib/services/application-intakes";
import { getApplicationById } from "@/lib/services/applications";
import { getProductById } from "@/lib/services/products";
import { getApplicationStep2 } from "@/lib/services/application-step2";
import { getRequirementSlotsByApplicationId } from "@/lib/services/requirement-slots";
import { getEvidenceByApplicationId } from "@/lib/services/document-evidence";
import { getApplicationDeclarations } from "@/lib/services/application-declarations";
import { resolveContinuationToken } from "@/lib/services/continuation-tokens";
import { applicantFacingSlots, evaluatePortalProgress } from "@/lib/services/portal-progress";
import type {
  ApplicationBankAccountSummary,
  ApplicationCollateral,
  ApplicationDeclarationSet,
  ApplicationGuarantor,
  ApplicationObligation,
  ContinuationTokenFailure,
  LocalizedText,
  PortalProgress,
  PortalStep,
} from "@/types";

/**
 * ============================================================================
 * WHAT AN APPLICANT MAY SEE (26A-4)
 * ============================================================================
 *
 * The read boundary between ODL's CRM and a member of the public holding a
 * continuation link. This module exists so that boundary is ONE reviewable
 * place rather than a judgement call repeated in every future portal route.
 *
 * ----------------------------------------------------------------------------
 * ALLOW-LIST, NOT DENY-LIST
 * ----------------------------------------------------------------------------
 * `PortalSnapshot` is built field by field. Nothing is spread, nothing is
 * passed through, and no internal model is returned wholesale. That matters
 * more than any list of exclusions: when a future milestone adds an internal
 * field to `Application` or `RequirementSlot`, it does NOT silently appear
 * here. It would have to be added on purpose, in this file, in a diff someone
 * reviews.
 *
 * What is therefore structurally absent — branch and branch scope, assigned
 * advisor, staff identities, internal notes, alerts, review verdicts and
 * reviewer names, compliance-only and internal requirements, every other
 * application, the client directory, and the full bank account number.
 *
 * ----------------------------------------------------------------------------
 * THE BANK ACCOUNT NUMBER (26A-2 REGRESSION)
 * ----------------------------------------------------------------------------
 * The snapshot carries `ApplicationBankAccountSummary`, whose type has no
 * `accountNumber` field at all — so the full value cannot leak through here
 * even by accident. Reading it still requires `getApplicationBankAccountDetail`
 * by name, one record at a time. A future "edit my bank account" screen should
 * show the mask and REPLACE the value, never fetch and re-display it.
 *
 * ----------------------------------------------------------------------------
 * AUTHORIZATION
 * ----------------------------------------------------------------------------
 * The token is the authorization, and it is resolved SERVER-SIDE into exactly
 * one intake id. No caller passes an application id, an intake id, or a branch
 * scope — so "show me someone else's application" is not a request this module
 * can express. See portal-progress.ts for why branch scope is deliberately not
 * the mechanism here.
 */

/** One requirement as the APPLICANT sees it: what to send, and whether it is in. */
export interface PortalRequirement {
  id: string;
  code: string;
  name: LocalizedText;
  description?: LocalizedText;
  /** How many files this needs. Null means it is not completed by uploading. */
  minFiles: number | null;
  allowsMultipleFiles: boolean;
  fileCount: number;
  isComplete: boolean;
  /** A copy is acceptable now; the original is owed at signing. */
  originalRequiredLater: boolean;
  /** "application" | "guarantor" | "collateral" — what this document is ABOUT. */
  subjectType: string;
  applicationGuarantorId?: string;
  applicationCollateralId?: string;
}

/**
 * Everything the portal may render for one applicant.
 *
 * Note what `application` does NOT include: no status, no advisor, no branch,
 * no review outcome. An applicant seeing "in_review" or "not_eligible" before
 * ODL has spoken to them would be ODL communicating a decision by accident.
 * Post-submission status is explicitly a separate, later concern.
 */
export interface PortalSnapshot {
  intakeId: string;
  currentStep: PortalStep;
  lastActivityAt: string;
  submittedAt?: string;
  progress: PortalProgress;

  applicant: {
    fullName?: string;
    email?: string;
    phone?: string;
  };

  application?: {
    id: string;
    /** The official ODL number — the applicant's own reference for support. */
    applicationNumber: string;
    productCode: string;
    productName: LocalizedText;
    requestedAmount: number;
    requestedTermMonths: number;
  };

  /** Masked only — see this module's header. */
  bankAccounts: ApplicationBankAccountSummary[];
  obligations: ApplicationObligation[];
  guarantors: ApplicationGuarantor[];
  collateral: ApplicationCollateral[];
  requirements: PortalRequirement[];
  declarations: ApplicationDeclarationSet;
}

export type GetPortalSnapshotResult =
  | { status: "ok"; snapshot: PortalSnapshot }
  | { status: "invalid"; reason: ContinuationTokenFailure }
  | { status: "error"; code: "SNAPSHOT_FAILED" };

/**
 * Resolve a continuation token and return everything its holder may see.
 *
 * DOES NOT TOUCH `last_activity_at`. Opening a link is not progress. If a read
 * bumped it, a customer who opened the same email six times would look busy
 * while a customer who actually uploaded three documents would look identical —
 * and the future "you left an application unfinished" reminder would go to the
 * wrong people. Activity is recorded by the write paths, which is why
 * `touchIntakeActivity` is exported alongside rather than called here.
 *
 * The token's own `last_used_at` IS updated, inside the redeem function. That
 * is a different fact — "this link was opened" — and it is kept separate on
 * purpose.
 */
export async function getPortalSnapshot(rawToken: string): Promise<GetPortalSnapshotResult> {
  const resolved = await resolveContinuationToken(rawToken);
  if (resolved.status === "invalid") {
    return { status: "invalid", reason: resolved.reason };
  }
  if (resolved.status !== "ok") {
    return { status: "error", code: "SNAPSHOT_FAILED" };
  }

  const intakeResult = await getApplicationIntakeById(resolved.resolved.intakeId);
  if (intakeResult.status !== "ok") {
    return { status: "error", code: "SNAPSHOT_FAILED" };
  }
  const intake = intakeResult.intake;

  const progressResult = await evaluatePortalProgress(intake);
  if (progressResult.status !== "ok") {
    return { status: "error", code: "SNAPSHOT_FAILED" };
  }

  const snapshot: PortalSnapshot = {
    intakeId: intake.id,
    currentStep: intake.currentStep,
    lastActivityAt: intake.lastActivityAt,
    submittedAt: intake.submittedAt,
    progress: progressResult.progress,
    applicant: {
      fullName: intake.applicantFullName,
      email: intake.applicantEmail,
      phone: intake.applicantPhone,
    },
    bankAccounts: [],
    obligations: [],
    guarantors: [],
    collateral: [],
    requirements: [],
    declarations: { applicationId: "" },
  };

  // A lead that has not chosen a product has no application, and therefore no
  // Step 2 data, no requirements and no declarations. Returning early is not an
  // error path — it is Step 1 not being finished.
  const applicationId = resolved.resolved.applicationId;
  if (!applicationId) {
    return { status: "ok", snapshot };
  }

  const application = await getApplicationById(SYSTEM_NATIONAL_SCOPE, applicationId);
  if (application.status !== "ok") {
    return { status: "error", code: "SNAPSHOT_FAILED" };
  }

  const [productResult, step2Result, slotsResult, evidenceResult, declarationsResult] =
    await Promise.all([
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
    return { status: "error", code: "SNAPSHOT_FAILED" };
  }

  const fileCounts = new Map<string, number>();
  for (const evidence of evidenceResult.evidence) {
    fileCounts.set(evidence.requirementSlotId, (fileCounts.get(evidence.requirementSlotId) ?? 0) + 1);
  }

  // Field-by-field, deliberately. `application.application` also carries
  // branchOrigin, assignedAdvisorProfileId, status and createdByProfileId —
  // none of which an applicant may see, and none of which can arrive here
  // without being typed out below.
  snapshot.application = {
    id: application.application.id,
    applicationNumber: application.application.applicationNumber,
    productCode: productResult.product.code,
    productName: productResult.product.name,
    requestedAmount: application.application.requestedAmount,
    requestedTermMonths: application.application.requestedTermMonths,
  };

  snapshot.bankAccounts = step2Result.step2.bankAccounts;
  snapshot.obligations = step2Result.step2.obligations;
  snapshot.guarantors = step2Result.step2.guarantors;
  snapshot.collateral = step2Result.step2.collateral;
  snapshot.declarations = declarationsResult.declarations;

  // The SAME filter the progress calculation uses, so the list the applicant
  // sees and the bar they watch can never disagree. Internal, optional and
  // non-file requirements are excluded here exactly as they are there.
  snapshot.requirements = applicantFacingSlots(slotsResult.requirementSlots).map((slot) => {
    const fileCount = fileCounts.get(slot.id) ?? 0;
    const minFiles = slot.minFiles ?? null;
    return {
      id: slot.id,
      code: slot.code,
      name: slot.name,
      description: slot.description,
      minFiles,
      allowsMultipleFiles: slot.allowsMultipleFiles,
      fileCount,
      // NOT slot.status. The CRM's review verdict is internal — telling an
      // applicant their document was rejected is a conversation ODL has, not a
      // badge that appears without warning.
      isComplete: minFiles !== null && fileCount >= minFiles,
      originalRequiredLater: slot.originalRequiredLater,
      subjectType: slot.subjectType,
      applicationGuarantorId: slot.applicationGuarantorId,
      applicationCollateralId: slot.applicationCollateralId,
    };
  });

  return { status: "ok", snapshot };
}

export type PortalWriteAuthorization =
  | { status: "ok"; intakeId: string; applicationId?: string }
  | { status: "invalid"; reason: ContinuationTokenFailure }
  | { status: "error"; code: "AUTHORIZATION_FAILED" };

/**
 * The gate every future token-authenticated WRITE must pass through.
 *
 * Returns the ids a write may touch — and nothing else. A caller cannot supply
 * them, so a write cannot be aimed at another applicant's record. There is
 * deliberately no table name, column name, or filter in this contract: a future
 * write endpoint calls a NAMED service method for a specific field, never a
 * generic mutation described by the client.
 *
 * REFUSES AFTER SUBMISSION. Once `submitted_at` is set the application is with
 * ODL, and a draft edit arriving afterwards would silently change something a
 * human has already begun assessing. The check lives here rather than in each
 * endpoint so it cannot be the one place a future author forgets.
 */
export async function authorizePortalWrite(rawToken: string): Promise<PortalWriteAuthorization> {
  const resolved = await resolveContinuationToken(rawToken);
  if (resolved.status === "invalid") {
    return { status: "invalid", reason: resolved.reason };
  }
  if (resolved.status !== "ok") {
    return { status: "error", code: "AUTHORIZATION_FAILED" };
  }

  const intakeResult = await getApplicationIntakeById(resolved.resolved.intakeId);
  if (intakeResult.status !== "ok") {
    return { status: "error", code: "AUTHORIZATION_FAILED" };
  }

  if (intakeResult.intake.submittedAt) {
    // Reported as a revoked credential rather than a new error shape: from the
    // holder's perspective the link genuinely no longer permits editing, and
    // submission will revoke the token outright in the submit milestone.
    return { status: "invalid", reason: "revoked" };
  }

  return {
    status: "ok",
    intakeId: resolved.resolved.intakeId,
    applicationId: resolved.resolved.applicationId,
  };
}

export { touchIntakeActivity };
