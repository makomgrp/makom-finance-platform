import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getApplicationById } from "@/lib/services/applications";
import { getClientById } from "@/lib/services/clients";
import { getActiveLoanCriteriaForProduct } from "@/lib/services/loan-criteria";
import { getRequirementSlotsByApplicationId } from "@/lib/services/requirement-slots";
import {
  aggregateRecommendation,
  buildApplicationFacts,
  evaluateCriterion,
  toSnapshotPayload,
  validateLoanCriterionConfiguration,
} from "@/lib/services/loan-criteria-evaluator";
import type {
  ApplicationAnalysisRecord,
  ApplicationAnalysisResult,
  BranchScope,
  CriterionEvaluation,
  HumanReviewOutcome,
  LoanCriterionActualValue,
  LoanCriterionExpectedValue,
  LoanCriterionFieldSource,
  LoanCriterionSeverity,
  LoanCriterionType,
  LocalizedText,
  PersistedCriterionEvaluation,
  PreliminaryRecommendation,
  RequirementSlot,
} from "@/types";

/**
 * Server-only orchestration for the Milestone 15E analysis engine (see the
 * Milestone 15E migration and its architecture review). ORCHESTRATION, NOT
 * DUPLICATION — this file creates no new evaluation logic of its own (see
 * loan-criteria-evaluator.ts for the pure rule engine) and no new
 * persistence path of its own: every write goes through create_application_
 * analysis_snapshot / review_application_analysis, the two SECURITY
 * DEFINER RPCs verified live in this milestone's post-migration
 * verification (V15/V16) — service_role structurally CANNOT insert into
 * application_analysis or application_analysis_criterion_results directly
 * (SELECT-only grants, confirmed live in V10/V14), so there is no other
 * code path this file could use even if it tried.
 *
 * Uses the Admin Client, same posture as every other service in this app.
 * generatedBy is always the literal "system" — mirrors automation_events.
 * actor's exact free-text convention; no automated process here is a real
 * CRM profile.
 */

const ANALYSIS_GENERATED_BY = "system";

// ============================================================================
// analyzeApplication
// ============================================================================

export type AnalyzeApplicationResult =
  | { status: "ok"; analysis: ApplicationAnalysisResult }
  | {
      status: "error";
      code:
        | "APPLICATION_NOT_FOUND"
        | "CLIENT_NOT_FOUND"
        | "CRITERIA_LOAD_FAILED"
        | "SLOTS_LOAD_FAILED"
        | "INVALID_CRITERION_CONFIGURATION"
        | "SNAPSHOT_PERSIST_FAILED";
    };

/**
 * The canonical entry point: loads an Application and everything its
 * active loan criteria need, evaluates every criterion deterministically,
 * aggregates one PreliminaryRecommendation, and persists the complete
 * result as one atomic snapshot via create_application_analysis_snapshot.
 *
 * ZERO-CRITERIA IS A REAL, SUPPORTED STATE, not an exception: when a
 * Product has zero active loan_criteria (true for every real Product
 * today — this migration seeds none), criterionResults is evaluated as an
 * empty array, aggregateRecommendation returns "missing_configuration",
 * and create_application_analysis_snapshot persists that exact header with
 * zero child rows — precisely as atomic and valid as any other run (see
 * that RPC's own comment).
 *
 * A malformed loan_criteria row (one that fails validateLoanCriterionConfiguration
 * — structurally impossible via any code path in this app, since the
 * database's own CHECK constraints prevent it, but not impossible via a
 * manually-inserted row) aborts the ENTIRE run with INVALID_CRITERION_
 * CONFIGURATION before evaluating anything — never silently evaluated,
 * never folded into "missing_configuration". See loan-criteria-evaluator.ts
 * #validateLoanCriterionConfiguration's own doc comment for why.
 *
 * Never writes directly to application_analysis or application_analysis_
 * criterion_results, and never changes the Application's own status —
 * this is a preliminary, internal recommendation, not a final decision.
 */
export async function analyzeApplication(
  scope: BranchScope,
  applicationId: string
): Promise<AnalyzeApplicationResult> {
  const applicationResult = await getApplicationById(scope, applicationId);
  if (applicationResult.status !== "ok") {
    return { status: "error", code: "APPLICATION_NOT_FOUND" };
  }
  const application = applicationResult.application;

  const clientResult = await getClientById(scope, application.clientId);
  if (clientResult.status !== "ok") {
    return { status: "error", code: "CLIENT_NOT_FOUND" };
  }
  const client = clientResult.client;

  const criteriaResult = await getActiveLoanCriteriaForProduct(application.productId);
  if (criteriaResult.status !== "ok") {
    return { status: "error", code: "CRITERIA_LOAD_FAILED" };
  }
  const loanCriteria = criteriaResult.loanCriteria;

  const slotsResult = await getRequirementSlotsByApplicationId(scope, applicationId);
  if (slotsResult.status !== "ok") {
    return { status: "error", code: "SLOTS_LOAD_FAILED" };
  }
  const requirementSlots = slotsResult.requirementSlots;

  for (const criterion of loanCriteria) {
    const validation = validateLoanCriterionConfiguration(criterion);
    if (!validation.valid) {
      console.error(
        `[application-analysis service] Refusing to evaluate malformed loan_criteria row (code="${criterion.code}", ` +
          `id="${criterion.id}"): ${validation.reason}`
      );
      return { status: "error", code: "INVALID_CRITERION_CONFIGURATION" };
    }
  }

  const facts = buildApplicationFacts(application, client);
  const slotsByCode = new Map<string, RequirementSlot>(requirementSlots.map((slot) => [slot.code, slot]));
  const criterionResults = loanCriteria.map((criterion) => evaluateCriterion(criterion, facts, slotsByCode));
  const recommendation = aggregateRecommendation(criterionResults);

  const supabase = getSupabaseServerClient();
  const { data: analysisId, error } = await supabase.rpc("create_application_analysis_snapshot", {
    p_application_id: applicationId,
    p_recommendation: recommendation,
    p_generated_by: ANALYSIS_GENERATED_BY,
    p_criterion_results: criterionResults.map(toSnapshotPayload),
  });

  if (error || !analysisId) {
    console.error(
      "[application-analysis service] create_application_analysis_snapshot RPC failed:",
      error?.message ?? "no analysis id returned"
    );
    return { status: "error", code: "SNAPSHOT_PERSIST_FAILED" };
  }

  // The RPC returns only the new id (returns uuid) — read the header back
  // for its authoritative, database-generated generated_at rather than
  // approximating it with a client-observed timestamp.
  const generatedAt = await readAnalysisGeneratedAt(analysisId as string);

  return {
    status: "ok",
    analysis: {
      analysisId: analysisId as string,
      applicationId,
      recommendation,
      generatedAt: generatedAt ?? new Date().toISOString(),
      generatedBy: ANALYSIS_GENERATED_BY,
      criterionResults,
    },
  };
}

async function readAnalysisGeneratedAt(analysisId: string): Promise<string | null> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("application_analysis")
      .select("generated_at")
      .eq("id", analysisId)
      .maybeSingle<{ generated_at: string }>();

    if (error || !data) {
      console.error(
        "[application-analysis service] Snapshot persisted but failed to read back generated_at:",
        error?.message ?? "no row found"
      );
      return null;
    }
    return data.generated_at;
  } catch (error) {
    console.error(
      "[application-analysis service] Unexpected failure reading back generated_at:",
      error instanceof Error ? error.message : "unknown error"
    );
    return null;
  }
}

// ============================================================================
// Analysis-history reads
// ============================================================================

interface AnalysisHeaderRow {
  id: string;
  application_id: string;
  recommendation: string;
  generated_at: string;
  generated_by: string;
  reviewed_at: string | null;
  reviewed_by_profile_id: string | null;
  review_outcome: string | null;
  review_notes: string | null;
}

interface CriterionResultRow {
  id: string;
  loan_criteria_id: string;
  criterion_code: string;
  criterion_name: Record<string, string>;
  criterion_description: Record<string, string> | null;
  criterion_type: string;
  field_source: string;
  field_source_detail: string | null;
  severity: string;
  outcome: string;
  actual_value: unknown;
  expected_value: unknown;
  reason_code: string | null;
  display_order: number;
}

interface AnalysisWithResultsRow extends AnalysisHeaderRow {
  application_analysis_criterion_results: CriterionResultRow[];
}

const ANALYSIS_HEADER_SELECT =
  "id, application_id, recommendation, generated_at, generated_by, reviewed_at, reviewed_by_profile_id, review_outcome, review_notes";

const ANALYSIS_WITH_RESULTS_SELECT =
  `${ANALYSIS_HEADER_SELECT}, application_analysis_criterion_results(` +
  "id, loan_criteria_id, criterion_code, criterion_name, criterion_description, criterion_type, field_source, " +
  "field_source_detail, severity, outcome, actual_value, expected_value, reason_code, display_order)";

function toCriterionResult(row: CriterionResultRow): PersistedCriterionEvaluation {
  return {
    id: row.id,
    loanCriteriaId: row.loan_criteria_id,
    criterionCode: row.criterion_code,
    criterionName: row.criterion_name as LocalizedText,
    criterionDescription: (row.criterion_description as LocalizedText | null) ?? undefined,
    criterionType: row.criterion_type as LoanCriterionType,
    fieldSource: row.field_source as LoanCriterionFieldSource,
    fieldSourceDetail: row.field_source_detail ?? undefined,
    severity: row.severity as LoanCriterionSeverity,
    outcome: row.outcome as CriterionEvaluation["outcome"],
    actualValue: row.actual_value as LoanCriterionActualValue,
    expectedValue: row.expected_value as LoanCriterionExpectedValue,
    reasonCode: (row.reason_code as CriterionEvaluation["reasonCode"] | null) ?? undefined,
    displayOrder: row.display_order,
  };
}

function toApplicationAnalysisRecord(row: AnalysisWithResultsRow): ApplicationAnalysisRecord {
  const criterionResults = [...row.application_analysis_criterion_results]
    .sort((a, b) => a.display_order - b.display_order)
    .map(toCriterionResult);

  return {
    analysisId: row.id,
    applicationId: row.application_id,
    recommendation: row.recommendation as PreliminaryRecommendation,
    generatedAt: row.generated_at,
    generatedBy: row.generated_by,
    criterionResults,
    reviewedAt: row.reviewed_at ?? undefined,
    reviewedByProfileId: row.reviewed_by_profile_id ?? undefined,
    reviewOutcome: (row.review_outcome as HumanReviewOutcome | null) ?? undefined,
    reviewNotes: row.review_notes ?? undefined,
  };
}

export type GetApplicationAnalysisHistoryResult =
  | { status: "ok"; analyses: ApplicationAnalysisRecord[] }
  | { status: "error" };

/** Loads every analysis run for one Application, newest first — the full
 * historical explanation, using the (application_id, generated_at desc)
 * index verified live in this milestone (V9). */
export async function getApplicationAnalysisHistory(scope: BranchScope, applicationId: string): Promise<GetApplicationAnalysisHistoryResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("application_analysis")
      .select(ANALYSIS_WITH_RESULTS_SELECT)
      .eq("application_id", applicationId)
      .order("generated_at", { ascending: false });

    if (error) {
      console.error("[application-analysis service] Failed to load analysis history:", error.message);
      return { status: "error" };
    }

    const rows = (data ?? []) as unknown as AnalysisWithResultsRow[];
    return { status: "ok", analyses: rows.map(toApplicationAnalysisRecord) };
  } catch (error) {
    console.error(
      "[application-analysis service] Unexpected failure loading analysis history:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

export type GetLatestApplicationAnalysisResult =
  | { status: "ok"; analysis: ApplicationAnalysisRecord | null }
  | { status: "error" };

/** Loads only the most recent analysis run for one Application. A null
 * analysis (no run has ever happened yet) is a normal, successful
 * outcome — matches this codebase's established "no match is legitimate
 * ok" precedent (see clients.ts#findClientByIdentification), not an
 * error. */
export async function getLatestApplicationAnalysis(scope: BranchScope, applicationId: string): Promise<GetLatestApplicationAnalysisResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("application_analysis")
      .select(ANALYSIS_WITH_RESULTS_SELECT)
      .eq("application_id", applicationId)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle<AnalysisWithResultsRow>();

    if (error) {
      console.error("[application-analysis service] Failed to load latest analysis:", error.message);
      return { status: "error" };
    }

    return { status: "ok", analysis: data ? toApplicationAnalysisRecord(data) : null };
  } catch (error) {
    console.error(
      "[application-analysis service] Unexpected failure loading latest analysis:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

async function getApplicationAnalysisById(analysisId: string): Promise<ApplicationAnalysisRecord | null> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("application_analysis")
      .select(ANALYSIS_WITH_RESULTS_SELECT)
      .eq("id", analysisId)
      .maybeSingle<AnalysisWithResultsRow>();

    if (error || !data) {
      console.error(
        "[application-analysis service] Failed to re-read analysis after review:",
        error?.message ?? "no row found"
      );
      return null;
    }
    return toApplicationAnalysisRecord(data);
  } catch (error) {
    console.error(
      "[application-analysis service] Unexpected failure re-reading analysis after review:",
      error instanceof Error ? error.message : "unknown error"
    );
    return null;
  }
}

// ============================================================================
// Human review
// ============================================================================

export interface ReviewApplicationAnalysisInput {
  analysisId: string;
  actorProfileId: string;
  outcome: HumanReviewOutcome;
  notes?: string;
}

export type ReviewApplicationAnalysisResult =
  | { status: "ok"; analysis: ApplicationAnalysisRecord }
  | { status: "error"; code: "NOT_FOUND_OR_ALREADY_REVIEWED" | "REVIEW_FAILED" };

/**
 * The one narrowly-scoped wrapper around review_application_analysis —
 * exposes only confirmed/overridden + notes, exactly matching the RPC's
 * own guarded, one-time-only contract. Deliberately not a generic
 * updateAnalysis(): the RPC's parameter list structurally excludes
 * recommendation/generatedAt/generatedBy/applicationId, and this wrapper
 * does too.
 *
 * The RPC returns NULL for two DISTINCT cases it deliberately collapses
 * (analysis id doesn't exist, or it was already reviewed) — see review_
 * application_analysis's own comment. This wrapper does not attempt to
 * distinguish them either (that would require an extra unprivileged SELECT
 * this milestone's scope does not need yet); both surface as the same
 * NOT_FOUND_OR_ALREADY_REVIEWED code, matching the RPC's own documented
 * semantics rather than inventing a finer distinction the database itself
 * doesn't make.
 */
export async function reviewApplicationAnalysis(
  input: ReviewApplicationAnalysisInput
): Promise<ReviewApplicationAnalysisResult> {
  const supabase = getSupabaseServerClient();
  const { data: updatedId, error } = await supabase.rpc("review_application_analysis", {
    p_analysis_id: input.analysisId,
    p_actor_profile_id: input.actorProfileId,
    p_review_outcome: input.outcome,
    p_review_notes: input.notes ?? null,
  });

  if (error) {
    console.error("[application-analysis service] review_application_analysis RPC failed:", error.message);
    return { status: "error", code: "REVIEW_FAILED" };
  }
  if (!updatedId) {
    return { status: "error", code: "NOT_FOUND_OR_ALREADY_REVIEWED" };
  }

  const analysis = await getApplicationAnalysisById(updatedId as string);
  if (!analysis) {
    return { status: "error", code: "REVIEW_FAILED" };
  }

  return { status: "ok", analysis };
}
