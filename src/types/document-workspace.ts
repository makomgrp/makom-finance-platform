import type { DocumentEvidence } from "./document-evidence";
import type { RequirementSlot } from "./requirement-slot";

/**
 * The minimal Application identity the global /documentos workspace
 * (Milestone 12D) needs to display and filter by — not the full
 * Application type. clientLegacyId is the same TEMPORARY demo-data bridge
 * every real Application already carries (see src/types/application.ts);
 * resolved to a display name client-side via getClientById(), exactly like
 * the legacy /documentos table already did for DossierDocument.clientId.
 *
 * assignedAdvisorFullName is resolved server-side via the applications ->
 * profiles foreign key (src/lib/services/document-workspace.ts) — never
 * guessed client-side, and deliberately NOT resolved through the demo
 * ADVISORS array: applications.assigned_advisor_profile_id is a real
 * profiles.id UUID with no corresponding demo-data bridge, unlike
 * clientLegacyId.
 */
export interface DocumentWorkspaceApplication {
  id: string;
  applicationNumber: string;
  clientLegacyId: string;
  assignedAdvisorProfileId?: string;
  assignedAdvisorFullName?: string;
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
