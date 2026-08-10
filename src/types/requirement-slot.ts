import type { LocalizedText } from "./product";
import type { RequirementKind } from "./requirement-template";

/**
 * The slot's own execution vocabulary — completely independent from
 * RequirementStatus (draft/active/inactive), which is a Template lifecycle
 * concept, not an execution one. See the requirement_slots table
 * migration's comment on `status` for what each value means.
 */
export type RequirementSlotStatus =
  | "pending"
  | "submitted"
  | "under_review"
  | "satisfied"
  | "rejected"
  | "waived"
  | "missing";

/** Which channel/actor-type performed a status transition — mirrors
 * dossier_documents.uploaded_source, extended with "ai" for the first
 * actor-type in this schema with no corresponding authenticated CRM
 * profile at all. */
export type RequirementSlotSource = "crm_manual" | "website_form" | "whatsapp" | "ai";

/**
 * The Requirement Engine's execution layer (Milestone 10B, migrated onto
 * a real applications foreign key in Milestone 11). The per-application
 * instance of a Requirement Template, created by copying the template's
 * defining facts at application-creation time. Every field below except
 * status (and its audit trio) is immutable forever once the slot is
 * created — see the Milestone 10B architecture review.
 *
 * Deliberately has no productId — see the migration's comment on why that
 * would be a genuine, unprotected redundancy: requirementTemplateId
 * already resolves to the correct, permanently-fixed product via the
 * template it was copied from.
 */
export interface RequirementSlot {
  id: string;
  /** The application this slot belongs to. Formerly a temporary
   * applicationLegacyId text bridge, fully replaced by this real foreign
   * key in Milestone 11 — see 20260809150300_finalize_requirement_slots_
   * application_id.sql. */
  applicationId: string;
  requirementTemplateId: string;
  /** Copied from the requirement template at creation time, then frozen
   * forever — never re-synced if the template's own value changes. */
  code: string;
  name: LocalizedText;
  description: LocalizedText;
  requirementKind: RequirementKind;
  required: boolean;
  displayOrder: number;
  status: RequirementSlotStatus;
  statusChangedAt?: string;
  /** Populated only when the actor was a real CRM profile
   * (statusChangedSource === "crm_manual"). */
  statusChangedByProfileId?: string;
  /** Resolved server-side (joined from profiles) — never guessed
   * client-side. */
  statusChangedByFullName?: string;
  statusChangedSource?: RequirementSlotSource;
  createdAt: string;
}
