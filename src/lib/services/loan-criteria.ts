import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type {
  LoanCriterion,
  LoanCriterionExpectedValue,
  LoanCriterionFieldSource,
  LoanCriterionSeverity,
  LoanCriterionStatus,
  LoanCriterionType,
  LocalizedText,
} from "@/types";

/**
 * Server-only read service for the Loan Criteria configuration table
 * (Milestone 15E — see supabase/migrations/20260811000400_create_loan_
 * criteria_and_application_analysis.sql). Uses the Admin Client, same
 * posture as every other service in this app: RLS is enabled on
 * `loan_criteria` with zero policies, so this is the only way to read it
 * until a real permissions model exists.
 *
 * READ ONLY in this file. This milestone's approved scope deferred
 * criteria-administration write functions (create/update/status
 * transition) — no consumer needs them yet, since analyzeApplication()
 * only ever reads. See this milestone's implementation report, "Optional
 * Configuration Write Service" section, for the exact future integration
 * point when a criteria-administration UI is built.
 *
 * Seeds ZERO real ODL lending criteria — none is invented here or
 * anywhere else in this codebase. getActiveLoanCriteriaForProduct
 * returning an empty array for every real Product today is the expected,
 * correct state, not a bug (see the migration's header comment).
 */

interface LoanCriterionRow {
  id: string;
  product_id: string;
  code: string;
  name: Record<string, string>;
  description: Record<string, string> | null;
  criterion_type: string;
  field_source: string;
  field_source_detail: string | null;
  expected_value: unknown;
  severity: string;
  status: string;
  display_order: number;
  status_changed_at: string | null;
  status_changed_by_profile_id: string | null;
  created_at: string;
}

const LOAN_CRITERION_SELECT =
  "id, product_id, code, name, description, criterion_type, field_source, field_source_detail, expected_value, " +
  "severity, status, display_order, status_changed_at, status_changed_by_profile_id, created_at";

function toLoanCriterion(row: LoanCriterionRow): LoanCriterion {
  return {
    id: row.id,
    productId: row.product_id,
    code: row.code,
    name: row.name as LocalizedText,
    description: (row.description as LocalizedText | null) ?? undefined,
    criterionType: row.criterion_type as LoanCriterionType,
    fieldSource: row.field_source as LoanCriterionFieldSource,
    fieldSourceDetail: row.field_source_detail ?? undefined,
    expectedValue: row.expected_value as LoanCriterionExpectedValue,
    severity: row.severity as LoanCriterionSeverity,
    status: row.status as LoanCriterionStatus,
    displayOrder: row.display_order,
    statusChangedAt: row.status_changed_at ?? undefined,
    statusChangedByProfileId: row.status_changed_by_profile_id ?? undefined,
    createdAt: row.created_at,
  };
}

export type GetActiveLoanCriteriaResult = { status: "ok"; loanCriteria: LoanCriterion[] } | { status: "error" };

/**
 * Loads every ACTIVE loan criterion for one Product, ordered by
 * display_order, with `id` as a deterministic tiebreak for any rows that
 * share a display_order value (matches the sparse-gap display_order
 * convention used across this schema — ties are legal, not an error). No
 * fallback to demo data on failure — callers get an explicit "error"
 * status, matching every other service in this app.
 *
 * "draft" and "inactive" criteria are silently excluded — only "active"
 * criteria participate in an analysis run, matching this table's own
 * column comment. An empty result (zero active criteria configured for
 * this Product) is a normal, expected outcome — analyzeApplication()
 * treats it as the "missing_configuration" case, not an error.
 */
export async function getActiveLoanCriteriaForProduct(productId: string): Promise<GetActiveLoanCriteriaResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("loan_criteria")
      .select(LOAN_CRITERION_SELECT)
      .eq("product_id", productId)
      .eq("status", "active")
      .order("display_order", { ascending: true })
      .order("id", { ascending: true });

    if (error) {
      console.error("[loan-criteria service] Failed to load active loan criteria:", error.message);
      return { status: "error" };
    }

    const rows = (data ?? []) as unknown as LoanCriterionRow[];
    return { status: "ok", loanCriteria: rows.map(toLoanCriterion) };
  } catch (error) {
    console.error(
      "[loan-criteria service] Unexpected failure loading active loan criteria:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}
