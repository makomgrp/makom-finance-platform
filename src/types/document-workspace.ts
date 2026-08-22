import type { BranchOrigin } from "@/types/branch";
import type { DocumentEvidence } from "./document-evidence";
import type { RequirementSlot } from "./requirement-slot";

/**
 * The minimal Application identity the global /documentos workspace
 * (Milestone 12D) needs to display and filter by — not the full
 * Application type. clientId is the real Client Engine relationship
 * (Milestone 14E — see src/types/application.ts), with clientFullName
 * resolved server-side via the same embedded join, never a browser-side
 * lookup.
 *
 * assignedAdvisorFullName is resolved server-side via the applications ->
 * profiles foreign key (src/lib/services/document-workspace.ts) — never
 * guessed client-side, same posture as clientFullName.
 */
export interface DocumentWorkspaceApplication {
  id: string;
  /**
   * MILESTONE 26B-5B — empty for a DRAFT, which has no official number until it
   * is submitted (26B-5). Callers must render that absence as draft context
   * rather than as a blank cell: a requirement belonging to a prospect who has
   * not submitted is a different thing from one on a live application, and an
   * empty column says neither.
   */
  applicationNumber: string;
  /** True while this requirement belongs to an unsubmitted portal draft. */
  isDraft: boolean;
  clientId: string;
  assignedAdvisorProfileId?: string;
  assignedAdvisorFullName?: string;
  /** MILESTONE 25C-2 — resolved from the APPLICATION, which owns the branch;
   * dossier_documents has no branch_id. Null fields mean unassigned. */
  branchOrigin: BranchOrigin;
  /** Resolved server-side (joined from clients) — never guessed
   * client-side. Always populated: clientId is NOT NULL. */
  clientFullName: string;
}

/**
 * One row of the global /documentos workspace (Milestone 12D — see the
 * Milestone 12D architecture review) — a single document-kind Requirement
 * Slot, the minimal identity of the real Application it belongs to, and
 * every Evidence row currently attached to it (current and superseded,
 * exactly as src/lib/services/document-evidence.ts already computes via
 * supersededByEvidenceId).
 *
 * Composed entirely at read time by src/lib/services/document-workspace.ts
 * from the real relational model (requirement_slots -> applications,
 * requirement_slots -> dossier_documents) — nothing here is a redundant,
 * separately-stored copy of anything on Evidence or Application. A Slot
 * with no Evidence yet is still a valid row (evidence: []) — see the
 * architecture review's "Zero-Evidence Requirements" section for why that
 * is the deliberate default, not an edge case to filter out.
 */
export interface DocumentWorkspaceRow {
  requirementSlot: RequirementSlot;
  application: DocumentWorkspaceApplication;
  evidence: DocumentEvidence[];
}
