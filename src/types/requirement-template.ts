import type { LocalizedText } from "./product";

export type RequirementStatus = "draft" | "active" | "inactive";

/** A small, code-owned, closed vocabulary — see the requirement_templates
 * table migration's comment on `requirement_kind` for why this is
 * deliberately NOT free text the way Product.code is. */
export type RequirementKind =
  | "document"
  | "phone_verification"
  | "apc_check"
  | "visit"
  | "internal_approval"
  | "ai_review"
  | "signature"
  | "manual_confirmation";

/**
 * The Requirement Engine's foundation shape (Milestone 10A). Describes
 * something a Product requires — a template/class, not a per-application
 * instance. Deliberately minimal — see the Milestone 10 architecture
 * review for what belongs here vs. future Requirement Slot / Evidence
 * tables, which will reference a requirement by id, none of which this
 * type knows about.
 */
export interface RequirementTemplate {
  id: string;
  productId: string;
  /** Stable, human-assigned identifier, unique per product — practically
   * immutable by convention, not enforced. See the migration comment. */
  code: string;
  name: LocalizedText;
  description?: LocalizedText;
  requirementKind: RequirementKind;
  /** true = required, false = optional — a freely-editable business
   * toggle, unlike code/requirementKind which are treated as locked. */
  required: boolean;
  /** Presentation-only ordering among this PRODUCT's requirements — a
   * distinct axis from Product.displayOrder. */
  displayOrder: number;
  status: RequirementStatus;
  statusChangedAt?: string;
  statusChangedByProfileId?: string;
  /** Resolved server-side (joined from profiles) — never guessed
   * client-side. */
  statusChangedByFullName?: string;
  createdAt: string;
}
