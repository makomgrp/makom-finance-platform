import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { applyBranchScope, isEmptyScope } from "@/lib/services/branch-scope-query";
import type {
  BranchScope,
  DocumentEvidence,
  DocumentWorkspaceRow,
  EvidenceUploadedSource,
  LocalizedText,
  RequirementKind,
  RequirementSlot,
  RequirementSlotSource,
  RequirementSlotStatus,
} from "@/types";

/**
 * Server-only read for the global /documentos operations workspace
 * (Milestone 12D — see the Milestone 12D architecture review). Anchored on
 * requirement_slots, not dossier_documents: a document-kind Requirement
 * Slot with zero Evidence is still a real row here (evidence: []), which
 * is the entire point of this module being a requirements workspace and
 * not a files inbox (architecture review, "Zero-Evidence Requirements").
 *
 * A single PostgREST nested-select resolves the full
 * Slot -> Application -> [Advisor] and Slot -> Evidence -> [Uploader,
 * Reviewer] relationship in one round trip, using the same !constraint
 * embed-hint pattern already used by every other service in this app
 * (document-evidence.ts, requirement-slots.ts) — no Postgres VIEW, no N+1
 * queries (architecture review, "Global Query Strategy" / "Database View
 * Question").
 *
 * Deliberately never touches applications.legacy_id — that bridge exists
 * only to resolve a DEMO application id to a real Application (the
 * Dossier's problem, Milestone 12C). This read starts from real
 * Applications directly via their real FK and must work identically for
 * one created through the real engine with legacy_id = null (architecture
 * review, "Applications Without Legacy Bridge").
 */

interface WorkspaceApplicationRow {
  id: string;
  application_number: string;
  client_id: string;
  assigned_advisor_profile_id: string | null;
  advisor: { full_name: string } | null;
  client: { full_name: string } | null;
}

interface WorkspaceEvidenceRow {
  id: string;
  requirement_slot_id: string | null;
  replaces_evidence_id: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  file_sha256: string | null;
  uploaded_at: string | null;
  uploaded_by_profile_id: string | null;
  uploaded_source: string | null;
  reviewed_at: string | null;
  reviewed_by_profile_id: string | null;
  uploaded_by: { full_name: string } | null;
  reviewed_by: { full_name: string } | null;
}

interface WorkspaceSlotRow {
  id: string;
  application_id: string;
  requirement_template_id: string;
  code: string;
  name: Record<string, string>;
  description: Record<string, string>;
  requirement_kind: string;
  required: boolean;
  display_order: number;
  status: string;
  status_changed_at: string | null;
  status_changed_by_profile_id: string | null;
  status_changed_source: string | null;
  created_at: string;
  status_changed_by: { full_name: string } | null;
  application: WorkspaceApplicationRow | null;
  evidence: WorkspaceEvidenceRow[];
}

// Two levels of embedding: requirement_slots -> applications -> profiles
// (advisor), and requirement_slots -> dossier_documents -> profiles
// (uploader/reviewer) — each !constraint hint names a real FK already
// established by earlier migrations (Milestone 11's requirement_slots_
// application_id_fkey and applications_assigned_advisor_profile_id_fkey,
// Milestone 12A's dossier_documents_requirement_slot_id_fkey). No new
// schema, no view — PostgREST resolves this as one query.
const WORKSPACE_SELECT =
  "id, application_id, requirement_template_id, code, name, description, requirement_kind, required, display_order, status, status_changed_at, status_changed_by_profile_id, status_changed_source, created_at, " +
  "status_changed_by:profiles!requirement_slots_status_changed_by_profile_id_fkey(full_name), " +
  "application:applications!requirement_slots_application_id_fkey(id, application_number, client_id, assigned_advisor_profile_id, advisor:profiles!applications_assigned_advisor_profile_id_fkey(full_name), client:clients!applications_client_id_fkey(full_name)), " +
  "evidence:dossier_documents!dossier_documents_requirement_slot_id_fkey(id, requirement_slot_id, replaces_evidence_id, storage_bucket, storage_path, file_name, mime_type, file_size_bytes, file_sha256, uploaded_at, uploaded_by_profile_id, uploaded_source, reviewed_at, reviewed_by_profile_id, uploaded_by:profiles!dossier_documents_uploaded_by_profile_id_fkey(full_name), reviewed_by:profiles!dossier_documents_reviewed_by_profile_id_fkey(full_name))";

function toRequirementSlot(row: WorkspaceSlotRow): RequirementSlot {
  return {
    id: row.id,
    applicationId: row.application_id,
    requirementTemplateId: row.requirement_template_id,
    code: row.code,
    name: row.name as LocalizedText,
    description: row.description as LocalizedText,
    requirementKind: row.requirement_kind as RequirementKind,
    required: row.required,
    displayOrder: row.display_order,
    status: row.status as RequirementSlotStatus,
    statusChangedAt: row.status_changed_at ?? undefined,
    statusChangedByProfileId: row.status_changed_by_profile_id ?? undefined,
    statusChangedByFullName: row.status_changed_by?.full_name ?? undefined,
    statusChangedSource: (row.status_changed_source as RequirementSlotSource | null) ?? undefined,
    createdAt: row.created_at,
  };
}

/** Mirrors src/lib/services/document-evidence.ts#toDocumentEvidence
 * exactly. Every file-describing field is guaranteed non-null for any row
 * reachable through requirement_slot_id (dossier_documents_file_metadata_
 * check). */
function toDocumentEvidence(row: WorkspaceEvidenceRow, supersededByEvidenceId?: string): DocumentEvidence {
  return {
    id: row.id,
    requirementSlotId: row.requirement_slot_id as string,
    replacesEvidenceId: row.replaces_evidence_id ?? undefined,
    supersededByEvidenceId,
    storageBucket: row.storage_bucket as string,
    storagePath: row.storage_path as string,
    fileName: row.file_name as string,
    mimeType: row.mime_type as string,
    fileSizeBytes: row.file_size_bytes as number,
    fileSha256: row.file_sha256 as string,
    uploadedAt: row.uploaded_at as string,
    uploadedByProfileId: row.uploaded_by_profile_id ?? undefined,
    uploadedByFullName: row.uploaded_by?.full_name ?? undefined,
    uploadedSource: row.uploaded_source as EvidenceUploadedSource,
    reviewedAt: row.reviewed_at ?? undefined,
    reviewedByProfileId: row.reviewed_by_profile_id ?? undefined,
    reviewedByFullName: row.reviewed_by?.full_name ?? undefined,
  };
}

/** Same derivation as document-evidence.ts#withSupersessionInfo, scoped to
 * one Slot's own evidence rows — correct because replaces_evidence_id is
 * only ever valid within the same Slot (CROSS_SLOT_REPLACEMENT is rejected
 * at write time), so a per-Slot pass is equivalent to a global one.
 * Also imposes newest-first ordering client-side, since PostgREST's
 * default embed order is not guaranteed to match created_at/uploaded_at
 * descending. */
function withSupersessionInfo(rows: WorkspaceEvidenceRow[]): DocumentEvidence[] {
  const supersededBy = new Map<string, string>();
  for (const row of rows) {
    if (row.replaces_evidence_id) {
      supersededBy.set(row.replaces_evidence_id, row.id);
    }
  }
  return [...rows]
    .sort((a, b) => new Date(b.uploaded_at ?? 0).getTime() - new Date(a.uploaded_at ?? 0).getTime())
    .map((row) => toDocumentEvidence(row, supersededBy.get(row.id)));
}

export type GetDocumentEvidenceWorkspaceResult =
  | { status: "ok"; rows: DocumentWorkspaceRow[] }
  | { status: "error" };

/**
 * Loads every document-kind Requirement Slot across every Application,
 * each with its owning Application identity (id, application_number,
 * client_id, resolved client + advisor name) and its full Evidence history
 * (current + superseded). No pagination/filtering server-side — matches
 * src/lib/services/documents.ts#getAllDocuments's existing "load
 * everything, filter client-side" contract for this exact page, and is
 * appropriate at current data scale (architecture review: premature to
 * add either a view or server-side pagination before real volume demands
 * it).
 */
export async function getDocumentEvidenceWorkspace(
  scope: BranchScope
): Promise<GetDocumentEvidenceWorkspaceResult> {
  if (isEmptyScope(scope)) return { status: "ok", rows: [] };

  try {
    const supabase = getSupabaseServerClient();
    // The workspace already embeds `application`; scoping filters on that same
    // embed rather than adding a second join. The embed is a plain (non-inner)
    // relation for national, so unassigned slots stay visible there.
    const { data, error } = await applyBranchScope(
      supabase
        .from("requirement_slots")
        .select(
          scope.mode === "national"
            ? WORKSPACE_SELECT
            : `${WORKSPACE_SELECT}, scope_application:applications!requirement_slots_application_id_fkey!inner(branch_id)`
        )
        .eq("requirement_kind", "document"),
      scope,
      "scope_application.branch_id"
    ).order("created_at", { ascending: true });

    if (error) {
      console.error("[document-workspace service] Failed to load document evidence workspace:", error.message);
      return { status: "error" };
    }

    const rows = (data ?? []) as unknown as WorkspaceSlotRow[];
    const workspaceRows: DocumentWorkspaceRow[] = rows.map((row) => ({
      requirementSlot: toRequirementSlot(row),
      application: {
        id: row.application?.id ?? row.application_id,
        applicationNumber: row.application?.application_number ?? "",
        clientId: row.application?.client_id ?? "",
        assignedAdvisorProfileId: row.application?.assigned_advisor_profile_id ?? undefined,
        assignedAdvisorFullName: row.application?.advisor?.full_name ?? undefined,
        clientFullName: row.application?.client?.full_name ?? "",
      },
      evidence: withSupersessionInfo(row.evidence ?? []),
    }));

    return { status: "ok", rows: workspaceRows };
  } catch (error) {
    console.error(
      "[document-workspace service] Unexpected failure loading document evidence workspace:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}
