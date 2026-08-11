import type { LocalizedText } from "@/types/product";

/**
 * Closed vocabulary for what KIND of comparison a criterion performs — see
 * loan_criteria_criterion_type_check in the Milestone 15E migration. Each
 * type implies exactly one comparison operator; there is deliberately no
 * separate "operator" field.
 */
export type LoanCriterionType =
  | "numeric_minimum"
  | "numeric_maximum"
  | "boolean_equals"
  | "allowed_value_set"
  | "required_field_present"
  | "requirement_slot_status";

/**
 * Closed vocabulary naming WHAT Application/Client/Requirement-Slot fact a
 * criterion evaluates — see loan_criteria_field_source_check. Never a raw
 * expression: no eval, no stored SQL/JS.
 */
export type LoanCriterionFieldSource =
  | "application_requested_amount"
  | "application_requested_term_months"
  | "client_monthly_salary"
  | "client_age"
  | "client_nationality"
  | "client_identification_type"
  | "client_restricted"
  | "requirement_slot_status";

/** hard -> does_not_meet_basic_criteria, soft -> manual_review_required,
 * informational -> evaluated and reported, never affects the
 * recommendation. See loan_criteria_severity_check. */
export type LoanCriterionSeverity = "hard" | "soft" | "informational";

/** draft / active / inactive — identical vocabulary and lifecycle to
 * ProductStatus. Only "active" criteria are evaluated by an analysis run. */
export type LoanCriterionStatus = "draft" | "active" | "inactive";

/**
 * The configured threshold/value shape, per criterion_type — mirrors
 * loan_criteria_expected_value_shape_check exactly: a plain number for the
 * two numeric types, a plain boolean for boolean_equals, the literal `true`
 * for required_field_present, and a non-empty array of strings for
 * allowed_value_set / requirement_slot_status (the latter restricted to the
 * real RequirementSlotStatus vocabulary — validated in
 * validateLoanCriterionConfiguration, not by this type alone).
 */
export type LoanCriterionExpectedValue = number | boolean | string[];

/**
 * The observed value at evaluation time, shaped per criterion_type —
 * mirrors application_analysis_criterion_results_actual_value_shape_check.
 * Deliberately NOT the same shape as LoanCriterionExpectedValue: the two
 * set-membership types observe a single string, not an array: null exactly
 * when outcome = "unknown".
 */
export type LoanCriterionActualValue = number | boolean | string | null;

/**
 * Product-specific configurable loan criteria (Milestone 15E — see the
 * Milestone 15E migration, supabase/migrations/20260811000400_create_
 * loan_criteria_and_application_analysis.sql). Staff-editable, never
 * hard-deleted (see status). Historical explainability comes from
 * CriterionEvaluation snapshotting the full rule definition at evaluation
 * time, NOT from versioning this type.
 */
export interface LoanCriterion {
  id: string;
  productId: string;
  /** Stable, staff-assigned identifier, unique within a Product. */
  code: string;
  name: LocalizedText;
  description?: LocalizedText;
  criterionType: LoanCriterionType;
  fieldSource: LoanCriterionFieldSource;
  /** Required and non-empty ONLY when fieldSource === "requirement_slot_
   * status" — the target RequirementSlot.code within this criterion's own
   * Product. Undefined for every other fieldSource. */
  fieldSourceDetail?: string;
  expectedValue: LoanCriterionExpectedValue;
  severity: LoanCriterionSeverity;
  status: LoanCriterionStatus;
  displayOrder: number;
  statusChangedAt?: string;
  statusChangedByProfileId?: string;
  createdAt: string;
}
