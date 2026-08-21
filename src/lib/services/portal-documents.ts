import "server-only";
import { SYSTEM_NATIONAL_SCOPE } from "@/lib/services/branch-scope-query";
import { getRequirementSlotsByApplicationId, evaluateFileCompletion } from "@/lib/services/requirement-slots";
import { getEvidenceByApplicationId } from "@/lib/services/document-evidence";
import type { LocalizedText, RequirementSlot } from "@/types";

/**
 * ============================================================================
 * WHAT THE APPLICANT IS ASKED TO SEND (26B-3)
 * ============================================================================
 *
 * The read model behind Step 3. It reuses 26A-3's slots and 26A-4's file-count
 * completion unchanged — no second document system, no second progress engine.
 *
 * ITS ONE JOB IS GROUPING. A flat list of ten upload controls is exactly the
 * wall of inputs Step 3 is supposed not to be, so slots are sorted into
 * sections a customer recognises: their own papers, their guarantor's, their
 * vehicle's, their company's. The grouping is derived from `subject_type` and
 * the requirement code — never from a hardcoded per-product list, which would
 * drift the moment ODL edits the catalog.
 */

/** One upload task as the customer sees it. */
export interface PortalDocumentTask {
  slotId: string;
  code: string;
  name: LocalizedText;
  description?: LocalizedText;
  required: boolean;
  /** Null means this requirement is not completed by uploading files. */
  minFiles: number | null;
  allowsMultipleFiles: boolean;
  /** A copy is fine now; ODL needs the original later. */
  originalRequiredLater: boolean;
  isComplete: boolean;
  files: PortalDocumentFile[];
}

export interface PortalDocumentFile {
  evidenceId: string;
  fileName: string;
  uploadedAt: string;
  /** True when a later upload supersedes this one. */
  isSuperseded: boolean;
}

export type PortalDocumentGroupKind = "applicant" | "guarantor" | "vehicle" | "business" | "other";

export interface PortalDocumentGroup {
  kind: PortalDocumentGroupKind;
  /** Present for guarantor/vehicle groups — which guarantor, which vehicle. */
  subjectId?: string;
  tasks: PortalDocumentTask[];
  /** Derived, never stored. "3 de 4 documentos recibidos". */
  completedCount: number;
  totalCount: number;
}

export interface PortalDocuments {
  groups: PortalDocumentGroup[];
  /** True when every REQUIRED file-based task is complete. Gates "Continuar". */
  allRequiredComplete: boolean;
  /** Collateral the customer chose that ODL has no document list for yet. */
  hasPropertyCollateralWithoutRequirements: boolean;
}

export type GetPortalDocumentsResult =
  | { status: "ok"; documents: PortalDocuments }
  | { status: "error"; code: "LOAD_FAILED" };

/**
 * Which section a task belongs in.
 *
 * `subject_type` answers it for guarantor and vehicle documents outright. For
 * application-level ones the requirement CODE distinguishes company paperwork
 * from the applicant's own — the codes are ODL's own stable vocabulary from
 * 26A-3, so this reads the catalog rather than second-guessing it.
 */
function groupKindFor(slot: RequirementSlot): PortalDocumentGroupKind {
  if (slot.subjectType === "guarantor") return "guarantor";
  if (slot.subjectType === "collateral") return "vehicle";
  if (
    slot.code === "business_registration" ||
    slot.code === "good_standing" ||
    slot.code === "tcc"
  ) {
    return "business";
  }
  return "applicant";
}

/**
 * Everything Step 3 renders for one application.
 *
 * ONLY APPLICANT-FACING, FILE-BASED REQUIREMENTS. Internal and later-stage
 * requirements are filtered out here rather than hidden in the UI, so a
 * component cannot accidentally render one — and `minFiles === null` tasks are
 * excluded because 26A-3's own evaluator can never mark them complete, which
 * would pin the progress below 100% forever.
 *
 * OPTIONAL TASKS ARE SHOWN BUT DO NOT GATE. `financial_statements` is seeded
 * `required = false` and must not block a business applicant.
 */
export async function getPortalDocuments(
  applicationId: string,
  hasPropertyCollateral: boolean
): Promise<GetPortalDocumentsResult> {
  const [slotsResult, evidenceResult] = await Promise.all([
    getRequirementSlotsByApplicationId(SYSTEM_NATIONAL_SCOPE, applicationId),
    getEvidenceByApplicationId(SYSTEM_NATIONAL_SCOPE, applicationId),
  ]);

  if (slotsResult.status !== "ok" || evidenceResult.status !== "ok") {
    return { status: "error", code: "LOAD_FAILED" };
  }

  // Which evidence rows have been superseded by a later upload. Shown as
  // history rather than hidden: a replacement chain the customer cannot see is
  // a chain they cannot tell went through.
  const supersededIds = new Set(
    evidenceResult.evidence
      .map((e) => e.replacesEvidenceId)
      .filter((id): id is string => Boolean(id))
  );

  const filesBySlot = new Map<string, PortalDocumentFile[]>();
  for (const evidence of evidenceResult.evidence) {
    const list = filesBySlot.get(evidence.requirementSlotId) ?? [];
    list.push({
      evidenceId: evidence.id,
      fileName: evidence.fileName ?? "",
      uploadedAt: evidence.uploadedAt ?? "",
      isSuperseded: supersededIds.has(evidence.id),
    });
    filesBySlot.set(evidence.requirementSlotId, list);
  }

  const visible = slotsResult.requirementSlots.filter(
    (slot) =>
      slot.applicantVisible &&
      slot.stage === "application" &&
      slot.requirementKind === "document" &&
      slot.minFiles !== null &&
      slot.minFiles !== undefined
  );

  const groups = new Map<string, PortalDocumentGroup>();

  for (const slot of visible) {
    const kind = groupKindFor(slot);
    const subjectId =
      kind === "guarantor"
        ? slot.applicationGuarantorId
        : kind === "vehicle"
          ? slot.applicationCollateralId
          : undefined;
    const groupKey = `${kind}|${subjectId ?? ""}`;

    const files = filesBySlot.get(slot.id) ?? [];
    // COUNTS LIVE FILES ONLY. A replaced pay slip must not keep counting
    // toward "2 received" — otherwise replacing one file would look like
    // supplying a second.
    const liveCount = files.filter((f) => !f.isSuperseded).length;
    const completion = evaluateFileCompletion({ id: slot.id, minFiles: slot.minFiles ?? null }, liveCount);

    const task: PortalDocumentTask = {
      slotId: slot.id,
      code: slot.code,
      name: slot.name,
      description: slot.description,
      required: slot.required,
      minFiles: slot.minFiles ?? null,
      allowsMultipleFiles: slot.allowsMultipleFiles,
      originalRequiredLater: slot.originalRequiredLater,
      isComplete: completion.isFileComplete,
      files: files.sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt)),
    };

    const group = groups.get(groupKey) ?? {
      kind,
      subjectId,
      tasks: [],
      completedCount: 0,
      totalCount: 0,
    };
    group.tasks.push(task);
    groups.set(groupKey, group);
  }

  // Section order the customer reads top to bottom: their own papers first,
  // then the things attached to them.
  const order: PortalDocumentGroupKind[] = ["applicant", "business", "vehicle", "guarantor", "other"];
  const ordered = [...groups.values()]
    .map((group) => ({
      ...group,
      completedCount: group.tasks.filter((t) => t.isComplete).length,
      totalCount: group.tasks.length,
    }))
    .sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));

  const allRequiredComplete = visible
    .filter((slot) => slot.required)
    .every((slot) => {
      const files = filesBySlot.get(slot.id) ?? [];
      const liveCount = files.filter((f) => !supersededIds.has(f.evidenceId)).length;
      return evaluateFileCompletion({ id: slot.id, minFiles: slot.minFiles ?? null }, liveCount)
        .isFileComplete;
    });

  return {
    status: "ok",
    documents: {
      groups: ordered,
      allRequiredComplete,
      // 26A-3 deliberately seeded NO property document requirements. Saying so
      // plainly beats an empty section that looks like a loading failure — and
      // beats inventing a checklist ODL never approved.
      hasPropertyCollateralWithoutRequirements: hasPropertyCollateral,
    },
  };
}
