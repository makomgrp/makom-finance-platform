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
 * profile at all. `email` added in Milestone 15B alongside
 * ApplicationSource/EvidenceUploadedSource — see the Milestone 15A
 * architecture review. */
export type RequirementSlotSource = "crm_manual" | "website_form" | "whatsapp" | "email" | "ai";

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
/**
 * MILESTONE 26A-3 — Step 3 configuration vocabularies. Mirror the database
 * CHECK constraints exactly, so a service cannot construct a value the database
 * will reject.
 */
export type RequirementStage =
  | "application"
  | "compliance"
  | "approval"
  | "signing"
  | "disbursement"
  | "servicing";

/** Who produces the evidence. `external_third_party` is the employer signing a
 * payroll-deduction authorization — neither the client nor ODL staff. */
export type RequirementActor =
  | "client"
  | "guarantor"
  | "internal"
  | "generated"
  | "external_third_party";

/** Names the question that decides whether a requirement applies. A closed
 * vocabulary, never an expression — the service answers it. */
export type RequirementConditionKey =
  | "has_guarantor"
  | "collateral_is_vehicle"
  | "collateral_is_property"
  | "business_has_tcc"
  | "loan_purpose_requires_proforma"
  | "bank_requires_specific_authorization";

/** What a requirement is ABOUT. On a slot, the matching id names which one. */
export type RequirementSubjectType = "application" | "guarantor" | "collateral";

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
  /** MILESTONE 26A-3 — how many files satisfy this. 2 for pay slips; 1 for
   * bank statements because one consolidated PDF is a valid answer. Undefined
   * means file count is not how this completes. */
  minFiles?: number;
  allowsMultipleFiles: boolean;
  stage: RequirementStage;
  actor: RequirementActor;
  /** Undefined means always required. */
  conditionKey?: RequirementConditionKey;
  /** Whether the public portal may show this. */
  applicantVisible: boolean;
  /** A signed upload proceeds, but the physical original is owed later. */
  originalRequiredLater: boolean;
  subjectType: RequirementSubjectType;
  /** Set only when subjectType is 'guarantor'. */
  applicationGuarantorId?: string;
  /** Set only when subjectType is 'collateral'. */
  applicationCollateralId?: string;
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
