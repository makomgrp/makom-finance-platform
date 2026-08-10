"use server";

import { getDocumentEvidenceWorkspace } from "@/lib/services/document-workspace";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import type { DocumentWorkspaceRow } from "@/types";

/**
 * The ONLY new Server Action for Milestone 12D (see the Milestone 12D
 * architecture review's "Server Action Strategy," revised: the four
 * Milestone 12C actions this module also needs — uploadRequirementEvidence,
 * reviewRequirementEvidence, getRequirementEvidenceViewUrl,
 * setDossierRequirementSlotStatus — are reused as-is, imported directly
 * from src/app/(app)/expedientes/actions.ts by documents-table.tsx. They
 * are NOT duplicated or relocated here.
 *
 * Read-only refetch of the entire global Document Evidence workspace,
 * called once on initial load (documentos/page.tsx) and again after every
 * mutation (upload/review/replace/status-change) — the same "refetch and
 * replace, never optimistically merge" discipline Milestone 12C
 * established for the Dossier's Requirements tab, for the identical
 * reason: a single Evidence upload can silently transition its own Slot's
 * status as a side effect, which a piecemeal client-side merge could miss.
 */
export type GetDocumentEvidenceWorkspaceActionResult =
  | { status: "success"; rows: DocumentWorkspaceRow[] }
  | { status: "error"; code: "UNAUTHENTICATED" | "QUERY_FAILED" };

export async function getDocumentEvidenceWorkspaceAction(): Promise<GetDocumentEvidenceWorkspaceActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) {
    console.error("[documentos actions] getDocumentEvidenceWorkspaceAction rejected: no authenticated profile.");
    return { status: "error", code: "UNAUTHENTICATED" };
  }

  const result = await getDocumentEvidenceWorkspace();
  if (result.status !== "ok") {
    return { status: "error", code: "QUERY_FAILED" };
  }

  return { status: "success", rows: result.rows };
}
