import "server-only";
import { getRequirementSlotsByApplicationId } from "@/lib/services/requirement-slots";
import { ALLOWED_MIME_TYPES } from "@/lib/config/evidence-storage";

/**
 * The Document Classification Foundation (Milestone 15D — see the
 * Milestone 15A architecture review's Document Analysis section for
 * where this fits in the longer-term pipeline). This module answers
 * exactly one question — "which Requirement Slot, if any, does this
 * incoming file satisfy?" — and nothing else. It never decides approval,
 * creditworthiness, or eligibility; it never touches Storage or
 * `dossier_documents`; it is pure classification logic over data already
 * read from `requirement_slots`.
 *
 * PHASE-1 STRATEGY — deliberately not "intelligent": no OCR, no AI, no
 * extracted-text analysis exists anywhere in this codebase yet (audited
 * before writing this file). Rather than fake a confidence score this
 * system cannot actually earn, this classifier uses exactly two
 * deterministic, zero-guesswork rules and routes everything else to
 * `needs_review`:
 *
 *   1. explicit_selection — the caller (today: the authenticated CRM
 *      staff member picking a Requirement in the upload UI) already told
 *      us which Slot this file is for. This is not really "classified"
 *      by this module at all — it is a caller decision this module
 *      merely validates (must be a real, document-kind Slot belonging to
 *      THIS Application — see the cross-Application check below).
 *   2. single_open_slot — no explicit selection was given, but the
 *      Application has exactly one open (pending/missing/rejected)
 *      document-kind Requirement Slot. There is no other slot this file
 *      could possibly satisfy, so this is genuinely unambiguous — not a
 *      guess.
 *
 * Everything else (zero open slots, two or more open slots with no
 * explicit selection) routes to `needs_review`. A later milestone that
 * adds real OCR/AI classification plugs in here as a THIRD method
 * alongside these two — see the `DocumentClassificationMethod` union —
 * without changing this module's exported signature or
 * document-intake.ts's contract at all.
 */

export type DocumentClassificationMethod = "explicit_selection" | "single_open_slot";

/** Closed, machine-readable vocabulary — the smallest correct set this
 * classifier can actually produce (every value below is reachable by the
 * logic in classifyDocument; none is speculative). Storage-layer/infra
 * failures (upload failed, insert failed) are NOT part of this
 * vocabulary — those are `document-intake.ts`'s ERROR codes, not review
 * reasons, since there is nothing for a human to "review" when nothing
 * was ever received. */
export type DocumentReviewReason =
  | "unsupported_file_type"
  | "invalid_file"
  | "no_matching_requirement"
  | "ambiguous_requirement";

export type ClassificationResult =
  | {
      outcome: "classified";
      requirementSlotId: string;
      method: DocumentClassificationMethod;
      /** "explicit" for a caller-provided selection (not inferred at
       * all); "high" for a rule that is deterministic and unambiguous
       * but still an inference this module made on the caller's behalf.
       * Deliberately not a numeric score — a fabricated float would
       * claim more precision than a rule-based classifier can honestly
       * provide. */
      confidence: "explicit" | "high";
    }
  | { outcome: "needs_review"; reason: DocumentReviewReason; candidateSlotIds?: string[] };

export interface ClassifyDocumentInput {
  applicationId: string;
  mimeType: string;
  /** Present when the caller already selected a target Slot (the CRM
   * upload UI always supplies this today). Absent for a hypothetical
   * future channel that submits a file with no human present to choose
   * one. */
  requirementSlotId?: string;
}

export type ClassifyDocumentResult = { status: "ok"; result: ClassificationResult } | { status: "error" };

const OPEN_SLOT_STATUSES = new Set(["pending", "missing", "rejected"]);

/**
 * Classifies one incoming file against one Application's Requirement
 * Slots. Application is authoritative throughout: every candidate Slot
 * is loaded via getRequirementSlotsByApplicationId(applicationId),
 * so a Slot belonging to a different Application can never even be
 * considered — this is what makes cross-Application association
 * structurally impossible, not merely validated after the fact (see the
 * Milestone 15D implementation report's Data Integrity section).
 */
export async function classifyDocument(input: ClassifyDocumentInput): Promise<ClassifyDocumentResult> {
  if (!ALLOWED_MIME_TYPES.includes(input.mimeType)) {
    return { status: "ok", result: { outcome: "needs_review", reason: "unsupported_file_type" } };
  }

  const slotsResult = await getRequirementSlotsByApplicationId(input.applicationId);
  if (slotsResult.status !== "ok") {
    return { status: "error" };
  }

  const documentSlots = slotsResult.requirementSlots.filter((slot) => slot.requirementKind === "document");

  if (input.requirementSlotId) {
    const explicit = documentSlots.find((slot) => slot.id === input.requirementSlotId);
    if (!explicit) {
      // Either the slot doesn't exist, doesn't belong to this
      // Application, or isn't a document-kind slot — all three collapse
      // to the same safe outcome: never fabricate an association.
      return { status: "ok", result: { outcome: "needs_review", reason: "no_matching_requirement" } };
    }
    return {
      status: "ok",
      result: { outcome: "classified", requirementSlotId: explicit.id, method: "explicit_selection", confidence: "explicit" },
    };
  }

  const openSlots = documentSlots.filter((slot) => OPEN_SLOT_STATUSES.has(slot.status));

  if (openSlots.length === 0) {
    return { status: "ok", result: { outcome: "needs_review", reason: "no_matching_requirement" } };
  }
  if (openSlots.length === 1) {
    return {
      status: "ok",
      result: { outcome: "classified", requirementSlotId: openSlots[0].id, method: "single_open_slot", confidence: "high" },
    };
  }

  return {
    status: "ok",
    result: { outcome: "needs_review", reason: "ambiguous_requirement", candidateSlotIds: openSlots.map((slot) => slot.id) },
  };
}
