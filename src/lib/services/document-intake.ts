import "server-only";
import { createHash } from "node:crypto";
import { classifyDocument, type DocumentReviewReason } from "@/lib/services/document-classification";
import {
  createDocumentEvidence,
  getEvidenceByRequirementSlotId,
  type CreateDocumentEvidenceResult,
} from "@/lib/services/document-evidence";
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from "@/lib/config/evidence-storage";
import type { DocumentEvidence, EvidenceUploadedSource } from "@/types";

/**
 * The canonical, channel-neutral Document Intake service (Milestone 15D
 * — see the Milestone 15A architecture review's "Document Intake"
 * section for where this sits in the longer-term pipeline: Application
 * -> Requirement Slots -> Document Intake -> Stored Evidence ->
 * Classification -> Requirement Slot matching -> future Document
 * Analysis -> future Recommendation Engine). This file is the ONE
 * ingestion entry point every channel (crm_manual today; website_form/
 * whatsapp/email/ai once their own adapters exist in later milestones)
 * is meant to call — never a parallel, channel-specific upload path.
 *
 * ORCHESTRATION, NOT DUPLICATION: this file creates no new Evidence
 * model, no new Storage bucket, no new document table. It classifies
 * (via document-classification.ts) and then calls the existing, unmodified
 * src/lib/services/document-evidence.ts#createDocumentEvidence — the
 * Document Evidence Engine built in Milestones 12B-12E4 remains the sole
 * authoritative writer of `dossier_documents`. See the Milestone 15D
 * implementation report's Schema Decision section for why no migration
 * was needed: every field this contract needs (classification method
 * isn't persisted at all — see below) already exists.
 *
 * WHY CLASSIFICATION RESULTS AREN'T PERSISTED: `dossier_documents.metadata`
 * is reserved exactly for this ("OCR output... confidence score...
 * AI/document classification" per its own column comment), but Phase-1's
 * two deterministic rules (see document-classification.ts) don't produce
 * information worth persisting once a Slot association is made — an
 * `explicit_selection` classification is just "a human picked this,"
 * and `single_open_slot` is fully re-derivable at any time by re-running
 * the same query. Writing to `metadata` is deferred until a real
 * OCR/AI classifier produces output actually worth keeping — reserving
 * that column for its intended future use rather than filling it with
 * Phase-1 rule-engine bookkeeping nobody will read back.
 */

export interface IngestDocumentInput {
  applicationId: string;
  file: File;
  /** Present when the caller already knows the target Slot (the CRM
   * upload UI's only mode today). Absent lets classifyDocument's
   * single_open_slot rule attempt to resolve it automatically. */
  requirementSlotId?: string;
  replacesEvidenceId?: string;
  source: EvidenceUploadedSource;
  /** Null for external-intake channels with no CRM profile — identical
   * contract to createDocumentEvidence's own actorProfileId. */
  actorProfileId: string | null;
}

export type IngestDocumentResult =
  | { status: "stored"; evidence: DocumentEvidence; alreadyExisted: boolean }
  | { status: "partial"; evidence: DocumentEvidence; code: "SLOT_TRANSITION_FAILED" }
  | { status: "needs_review"; reason: DocumentReviewReason; candidateSlotIds?: string[] }
  | { status: "error"; code: "CLASSIFICATION_FAILED" | CreateDocumentEvidenceErrorCode };

type CreateDocumentEvidenceErrorCode = Extract<CreateDocumentEvidenceResult, { status: "error" }>["code"];

/**
 * Ingests one file for one Application. Always routes through
 * classifyDocument() first — even when requirementSlotId is supplied,
 * so cross-Application/wrong-kind associations are rejected the exact
 * same way regardless of caller (see document-classification.ts's own
 * doc comment on why Application-scoped loading makes this structural,
 * not just validated).
 *
 * IDEMPOTENCY: before creating a new Evidence row, checks whether an
 * Evidence row already exists for the resolved Slot with the identical
 * file content (SHA-256 of the bytes — dossier_documents.file_sha256 is
 * already computed and stored by createDocumentEvidence on every insert,
 * so this reuses an existing column rather than adding one). A byte-
 * identical resubmission (double-click, channel retry, the exact same
 * file arriving twice) returns the EXISTING row with alreadyExisted:
 * true instead of creating a duplicate. A different file with the same
 * name, or the same content under a different filename, are both
 * handled correctly by this rule — filename is never part of the
 * comparison. Deliberately scoped to (slot, hash), not global: the same
 * document content legitimately satisfying two different Requirement
 * Slots (e.g. the same ID photo attached to two different Applications,
 * or even two different Slots on one Application) is not a duplicate in
 * any business sense.
 */
export async function ingestDocument(input: IngestDocumentInput): Promise<IngestDocumentResult> {
  if (!ALLOWED_MIME_TYPES.includes(input.file.type)) {
    return { status: "needs_review", reason: "unsupported_file_type" };
  }
  if (input.file.size <= 0 || input.file.size > MAX_FILE_SIZE_BYTES) {
    return { status: "needs_review", reason: "invalid_file" };
  }

  const classification = await classifyDocument({
    applicationId: input.applicationId,
    mimeType: input.file.type,
    requirementSlotId: input.requirementSlotId,
  });
  if (classification.status === "error") {
    return { status: "error", code: "CLASSIFICATION_FAILED" };
  }
  if (classification.result.outcome === "needs_review") {
    return {
      status: "needs_review",
      reason: classification.result.reason,
      candidateSlotIds: classification.result.candidateSlotIds,
    };
  }

  const { requirementSlotId } = classification.result;

  const bytes = Buffer.from(await input.file.arrayBuffer());
  const fileSha256 = createHash("sha256").update(bytes).digest("hex");

  const existingEvidenceResult = await getEvidenceByRequirementSlotId(requirementSlotId);
  if (existingEvidenceResult.status === "ok") {
    const duplicate = existingEvidenceResult.evidence.find((evidence) => evidence.fileSha256 === fileSha256);
    if (duplicate) {
      return { status: "stored", evidence: duplicate, alreadyExisted: true };
    }
  }

  const createResult = await createDocumentEvidence({
    requirementSlotId,
    file: input.file,
    actorProfileId: input.actorProfileId,
    uploadedSource: input.source,
    replacesEvidenceId: input.replacesEvidenceId,
  });

  if (createResult.status === "error") {
    return { status: "error", code: createResult.code };
  }
  if (createResult.status === "partial") {
    return { status: "partial", evidence: createResult.evidence, code: createResult.code };
  }
  return { status: "stored", evidence: createResult.evidence, alreadyExisted: false };
}
