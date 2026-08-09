import type { RequirementKind, RequirementStatus } from "@/types";

export const REQUIREMENT_STATUS_ORDER: RequirementStatus[] = ["draft", "active", "inactive"];

export const REQUIREMENT_STATUS_BADGE_CLASS: Record<RequirementStatus, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  active: "bg-success/10 text-success border-success/20",
  inactive: "bg-destructive/10 text-destructive border-destructive/20",
};

// Legal transitions only — identical shape to PRODUCT_STATUS_TRANSITIONS.
// active -> draft is deliberately not legal. See the requirement_templates
// table migration's comment on the `status` column.
export const REQUIREMENT_STATUS_TRANSITIONS: Record<RequirementStatus, RequirementStatus[]> = {
  draft: ["active"],
  active: ["inactive"],
  inactive: ["active"],
};

// The initial requirement_kind vocabulary, matching the CHECK constraint in
// the requirement_templates table migration exactly. Widening this list
// later is a single migration change to both places, never an ENUM
// migration — see that migration's comment on requirement_kind.
export const REQUIREMENT_KIND_ORDER: RequirementKind[] = [
  "document",
  "phone_verification",
  "apc_check",
  "visit",
  "internal_approval",
  "ai_review",
  "signature",
  "manual_confirmation",
];
