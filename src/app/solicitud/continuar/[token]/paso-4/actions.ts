"use server";

import { authorizePortalWrite } from "@/lib/services/portal-snapshot";
import {
  recordCreditConsentDeclaration,
  recordPepDeclaration,
  recordSourceOfFundsDeclaration,
} from "@/lib/services/application-declarations";
import { submitPortalApplication } from "@/lib/services/portal-submission";
import { updateIntakeDraftState } from "@/lib/services/application-intakes";
import type { SourceOfFundsCategory } from "@/types";
import type { PortalStep } from "@/types";

/**
 * ============================================================================
 * DECLARATIONS AND FINAL SUBMISSION (26B-4)
 * ============================================================================
 *
 * Two actions, both authorised the same way every other portal write is: the
 * continuation token resolves server-side to exactly one application, and the
 * browser never names one.
 *
 * DECLARATIONS GO STRAIGHT INTO 26A-4. `recordPepDeclaration`,
 * `recordSourceOfFundsDeclaration` and `recordCreditConsentDeclaration` are
 * used unchanged — which means the append-only revision model, the stored
 * wording `version`, `accepted_at` and `accepted_via` all keep working exactly
 * as that milestone built them. Nothing here writes to the table directly and
 * nothing reduces what is recorded to a bare boolean.
 */

export type DeclarationActionResult =
  | { status: "ok" }
  | {
      status: "error";
      code: "NOT_AUTHORIZED" | "INVALID_DECLARATION" | "SAVE_FAILED";
    };

export interface SaveDeclarationsInput {
  continuationToken: string;
  /** Undefined means the customer has not answered yet — not "no". */
  isPep?: boolean;
  pepDetails?: string;
  sourceOfFundsCategory?: SourceOfFundsCategory;
  sourceOfFundsDescription?: string;
  /** Only ever sent as true; consent is an action, never a default. */
  creditConsentGranted?: boolean;
}

/**
 * Persist whichever declarations the customer has answered.
 *
 * ONLY WHAT CHANGED IS WRITTEN. Each declaration is append-only in 26A-4, so
 * re-saving an unchanged answer would add a revision that records nothing new.
 * The caller sends only the answers it has, and each is recorded through its
 * own named function — there is no generic "write declaration" path a caller
 * could point at an arbitrary type.
 */
export async function savePortalDeclarations(
  input: SaveDeclarationsInput
): Promise<DeclarationActionResult> {
  const authorized = await authorizePortalWrite(input.continuationToken);
  if (authorized.status !== "ok" || !authorized.applicationId) {
    // Also the post-submission case: 26A-4's write guard refuses a submitted
    // intake, so accepted declarations stop being publicly editable the moment
    // the application is sent.
    return { status: "error", code: "NOT_AUTHORIZED" };
  }
  const applicationId = authorized.applicationId;

  if (input.isPep !== undefined) {
    const result = await recordPepDeclaration(
      applicationId,
      input.isPep,
      input.pepDetails,
      "portal"
    );
    if (result.status !== "ok") {
      return {
        status: "error",
        code: result.code === "INVALID_DECLARATION" ? "INVALID_DECLARATION" : "SAVE_FAILED",
      };
    }
  }

  if (input.sourceOfFundsCategory) {
    const result = await recordSourceOfFundsDeclaration(
      applicationId,
      input.sourceOfFundsCategory,
      input.sourceOfFundsDescription,
      "portal"
    );
    if (result.status !== "ok") {
      return {
        status: "error",
        code: result.code === "INVALID_DECLARATION" ? "INVALID_DECLARATION" : "SAVE_FAILED",
      };
    }
  }

  if (input.creditConsentGranted !== undefined) {
    const result = await recordCreditConsentDeclaration(
      applicationId,
      input.creditConsentGranted,
      "portal"
    );
    if (result.status !== "ok") return { status: "error", code: "SAVE_FAILED" };
  }

  await updateIntakeDraftState(authorized.intakeId, "review");
  return { status: "ok" };
}

export type SubmitActionResult =
  | { status: "ok"; applicationNumber: string }
  | { status: "already_submitted"; applicationNumber: string }
  | { status: "incomplete"; pendingStep: PortalStep }
  | { status: "error"; code: "NOT_AUTHORIZED" | "SUBMIT_FAILED" };

/**
 * Hand the application to ODL.
 *
 * A thin adapter over the one submission service — every rule that matters
 * (server-side completion, the guarded claim that makes a double submit
 * impossible, the `new -> in_review` transition) lives there, so no caller can
 * reach a different set of them by going through a different door.
 */
export async function submitPortalApplicationAction(token: string): Promise<SubmitActionResult> {
  const result = await submitPortalApplication(token);

  switch (result.status) {
    case "ok":
      return { status: "ok", applicationNumber: result.applicationNumber };
    case "already_submitted":
      return { status: "already_submitted", applicationNumber: result.applicationNumber };
    case "incomplete":
      return { status: "incomplete", pendingStep: result.pendingStep };
    default:
      return { status: "error", code: result.code };
  }
}
