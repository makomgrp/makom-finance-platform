import type { LocalizedText } from "@/types/product";
import type {
  LoanCriterionActualValue,
  LoanCriterionExpectedValue,
  LoanCriterionFieldSource,
  LoanCriterionSeverity,
  LoanCriterionType,
} from "@/types/loan-criteria";

/**
 * A criterion's evaluation result — pass (fact known, satisfies the rule),
 * fail (fact known, does not satisfy the rule), or unknown (fact could not
 * be determined). See application_analysis_criterion_results_outcome_check.
 * unknown must never collapse into fail — see the Milestone 15E migration's
 * header comment and application_analysis_criterion_results_reason_
 * outcome_compat_check.
 */
export type CriterionEvaluationOutcome = "pass" | "fail" | "unknown";

/** Closed, machine-readable vocabulary explaining a fail/unknown outcome —
 * undefined for pass. Each value maps to exactly one criterionType (or, for
 * requirement_slot_status, one of two) — see application_analysis_
 * criterion_results_reason_code_compat_check. */
export type CriterionReasonCode =
  | "below_minimum"
  | "above_maximum"
  | "value_not_in_allowed_set"
  | "boolean_mismatch"
  | "field_missing"
  | "requirement_slot_not_satisfied"
  | "requirement_slot_unknown";

/**
 * The machine's PRELIMINARY, INTERNAL recommendation — never a final
 * lending decision, never "approved"/"rejected". See application_analysis_
 * recommendation_check and the Milestone 15E migration's CRITICAL BOUNDARY
 * header comment.
 */
export type PreliminaryRecommendation =
  | "ready_for_review"
  | "missing_information"
  | "does_not_meet_basic_criteria"
  | "manual_review_required"
  | "missing_configuration";

/** confirmed (staff agrees with the machine recommendation) or overridden
 * (staff disagrees). Not a workflow/approval mechanism — records a human's
 * judgment as a fact, once. See application_analysis_review_outcome_check. */
export type HumanReviewOutcome = "confirmed" | "overridden";

/**
 * One criterion's evaluation result, snapshotting the complete rule
 * definition that produced it (not just its code/name) — matches exactly
 * what create_application_analysis_snapshot's p_criterion_results jsonb
 * payload expects, key-for-key (see that RPC's body: elem->>'loanCriteriaId'
 * etc.). Has no `id` — that is assigned by the database only once this is
 * actually persisted; see PersistedCriterionEvaluation for the read-back
 * shape.
 */
export interface CriterionEvaluation {
  loanCriteriaId: string;
  criterionCode: string;
  criterionName: LocalizedText;
  criterionDescription?: LocalizedText;
  criterionType: LoanCriterionType;
  fieldSource: LoanCriterionFieldSource;
  fieldSourceDetail?: string;
  severity: LoanCriterionSeverity;
  outcome: CriterionEvaluationOutcome;
  actualValue: LoanCriterionActualValue;
  expectedValue: LoanCriterionExpectedValue;
  reasonCode?: CriterionReasonCode;
  displayOrder: number;
}

/** A CriterionEvaluation once actually persisted — adds the row's own id,
 * assigned by application_analysis_criterion_results.id. Returned only by
 * the analysis-history read services, never by the evaluator itself. */
export interface PersistedCriterionEvaluation extends CriterionEvaluation {
  id: string;
}

/**
 * One freshly-created analysis run, as returned by analyzeApplication()
 * immediately after create_application_analysis_snapshot persists it.
 * Mirrors application_analysis's own header columns exactly — no reviewed*
 * fields, since a brand-new snapshot cannot have been reviewed yet (see
 * application_analysis_review_pair_check: all three null until reviewed).
 */
export interface ApplicationAnalysisResult {
  analysisId: string;
  applicationId: string;
  recommendation: PreliminaryRecommendation;
  generatedAt: string;
  /** "system" for every automated run today — mirrors automation_events.
   * actor's free-text convention. */
  generatedBy: string;
  criterionResults: CriterionEvaluation[];
}

/**
 * A persisted analysis run as read back from the database (analysis-history
 * services) — ApplicationAnalysisResult plus the four nullable human-review
 * columns, populated only once review_application_analysis has run.
 */
export interface ApplicationAnalysisRecord extends Omit<ApplicationAnalysisResult, "criterionResults"> {
  criterionResults: PersistedCriterionEvaluation[];
  reviewedAt?: string;
  reviewedByProfileId?: string;
  reviewOutcome?: HumanReviewOutcome;
  reviewNotes?: string;
}
