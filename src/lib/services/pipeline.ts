import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { applyBranchScope, isEmptyScope } from "@/lib/services/branch-scope-query";
import { branchOriginEmbed, toBranchOrigin, type BranchOriginRow } from "@/lib/services/branch-origin";
import { getApplicationDocumentProgress } from "@/lib/services/requirement-slots";
import { isStep2Complete } from "@/lib/services/portal-progress";
import { stageForFormalStatus } from "@/lib/config/pipeline";
import type {
  ApplicationStatus,
  PipelineCard,
  PipelineStage,
  ApplicationStep2,
  BankAccountType,
  BranchScope,
  CollateralType,
  EmploymentStatus,
  LoanPurpose,
  LocalizedText,
  PayrollDeductionAvailability,
} from "@/types";

/**
 * ============================================================================
 * ONE PIPELINE, TWO LIFECYCLES (26B-5A)
 * ============================================================================
 *
 * ODL wants to start following a prospect up the moment they finish Step 1 —
 * not when they finally submit, and especially not never, which is what happens
 * to someone who abandons the portal at Step 3.
 *
 * So the board shows the whole journey: leads still filling in the portal
 * alongside applications ODL has formally received. What it does NOT do is
 * pretend they are the same kind of thing. The lifecycle distinction that
 * 26B-5 established stays exactly where it was — a draft has no official
 * number and is not in the formal table — and is merely PRESENTED on one board.
 *
 * ----------------------------------------------------------------------------
 * THE STAGE IS DERIVED, NEVER STORED
 * ----------------------------------------------------------------------------
 * There is no `pipeline_stage` column, and adding one would have been the
 * expensive mistake. A stored stage is a cache of "how far has this customer
 * actually got", and it goes stale the instant anything behind it changes: a
 * reviewer rejects a pay slip, a conditional requirement appears because a
 * guarantor was added, an applicant deletes something. The board would keep
 * cheerfully reporting the old answer.
 *
 * `application_intakes.current_step` was the tempting shortcut and is the wrong
 * source for the same reason: it is a BOOKMARK. Step 3 writes it on the first
 * file uploaded, so a customer who has sent one document out of four would sit
 * in "Paso 3" having completed none of it. The milestone is explicit that
 * opening a step must not advance the pipeline, and only real completion does.
 *
 * So each stage is recomputed from the rows that actually exist, and Step 2's
 * rules come from `isStep2Complete` — 26A-4's single evaluator, the same
 * function the portal itself gates Continue on. Not a SQL re-implementation of
 * it: a second copy of a product-specific rule is a second answer waiting to
 * disagree with the first.
 *
 * ----------------------------------------------------------------------------
 * SET-BASED, NOT PER CARD
 * ----------------------------------------------------------------------------
 * A fixed handful of queries covers the whole board: applications, then one
 * query per Step 2 table for every draft at once, then document progress. Fifty
 * cards cost the same round trips as three. Nothing here runs inside a loop.
 */

export type GetPipelineResult = { status: "ok"; cards: PipelineCard[] } | { status: "error" };

const PIPELINE_SELECT =
  "id, application_number, status, created_at, client_id, product_id, " +
  "product:products!applications_product_id_fkey(code, application_code, name), " +
  "advisor:profiles!applications_assigned_advisor_profile_id_fkey(full_name), " +
  "client:clients!applications_client_id_fkey(full_name, email, phone), " +
  "intake:application_intakes!application_intakes_created_application_id_fkey(last_activity_at), " +
  branchOriginEmbed("applications_branch_id_fkey");

interface PipelineRow {
  id: string;
  application_number: string | null;
  status: ApplicationStatus;
  created_at: string;
  client_id: string;
  product_id: string;
  product: { code: string; application_code: string | null; name: LocalizedText } | null;
  advisor: { full_name: string } | null;
  client: { full_name: string; email: string | null; phone: string | null } | null;
  intake: { last_activity_at: string }[] | { last_activity_at: string } | null;
  branch: BranchOriginRow | null;
}

/**
 * Every card on the board, scoped to what this viewer may see.
 *
 * Branch scope is applied in the query — never fetched wide and filtered in the
 * browser — so a card outside the viewer's branches is not merely hidden, it is
 * never sent.
 */
export async function getPipelineCards(scope: BranchScope): Promise<GetPipelineResult> {
  if (isEmptyScope(scope)) return { status: "ok", cards: [] };

  try {
    const supabase = getSupabaseServerClient();

    const { data, error } = await applyBranchScope(
      supabase.from("applications").select(PIPELINE_SELECT),
      scope
    ).order("created_at", { ascending: false });

    if (error) {
      console.error("[pipeline service] Failed to load pipeline applications:", error.message);
      return { status: "error" };
    }

    const rows = (data ?? []) as unknown as PipelineRow[];
    if (rows.length === 0) return { status: "ok", cards: [] };

    // Step 2 completion is only ever asked about DRAFTS. A formal application's
    // stage comes from its status, so loading Step 2 for it would be work whose
    // answer is already known.
    const draftIds = rows.filter((row) => row.status === "draft").map((row) => row.id);

    const [step2ByApplication, progressResult] = await Promise.all([
      loadStep2ForApplications(draftIds),
      getApplicationDocumentProgress(scope),
    ]);

    const progress = progressResult.status === "ok" ? progressResult.progress : {};

    const cards = rows.map((row): PipelineCard => {
      const docs = progress[row.id] ?? { received: 0, reviewed: 0, total: 0 };
      const isDraft = row.status === "draft";
      const intake = Array.isArray(row.intake) ? row.intake[0] : row.intake;

      return {
        id: row.id,
        kind: isDraft ? "lead" : "application",
        clientId: row.client_id,
        applicationNumber: row.application_number ?? undefined,
        fullName: row.client?.full_name ?? "—",
        email: row.client?.email ?? undefined,
        phone: row.client?.phone ?? undefined,
        productCode: row.product?.code ?? "",
        productName: row.product?.name ?? { es: "—", en: "—" },
        stage: isDraft
          ? draftStage(row, step2ByApplication.get(row.id), docs)
          : stageForFormalStatus(row.status),
        formalStatus: isDraft ? undefined : row.status,
        status: row.status,
        advisorFullName: row.advisor?.full_name ?? undefined,
        branchOrigin: toBranchOrigin(row.branch),
        createdAt: row.created_at,
        // A draft's activity is the applicant's own last portal action; a formal
        // application has no newer signal here, so it falls back to creation.
        lastActivityAt: intake?.last_activity_at ?? row.created_at,
        documentsReceived: docs.received,
        documentsReviewed: docs.reviewed,
        documentsRequired: docs.total,
      };
    });

    return { status: "ok", cards };
  } catch (error) {
    console.error(
      "[pipeline service] Unexpected failure building pipeline:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

/**
 * How far has this DRAFT actually got?
 *
 * Read downward: the furthest genuinely-completed step wins. A customer sitting
 * on the Step 3 page having uploaded nothing is in Paso 2, because that is the
 * last thing they finished — which is exactly the case ODL's manual QA raised.
 */
function draftStage(
  row: PipelineRow,
  step2: ApplicationStep2 | undefined,
  docs: { received: number; total: number }
): PipelineStage {
  const applicationCode = row.product?.application_code ?? "";

  // Documents complete => Paso 3. `total > 0` guards the moment before the
  // requirement snapshot exists, where 0-of-0 would otherwise read as finished.
  const documentsComplete = docs.total > 0 && docs.received >= docs.total;
  if (documentsComplete) return "paso_3";

  // The SINGLE evaluator (26A-4), not a copy of its rules.
  if (step2 && isStep2Complete(applicationCode, step2)) return "paso_2";

  // The application row exists at all, which only happens once Step 1 is done.
  return "nuevo";
}

/**
 * Step 2 for many applications at once.
 *
 * One query per table for the whole set, then grouped in memory — the shape
 * `isStep2Complete` expects, without calling the per-application reader in a
 * loop. Only the fields those rules actually consult are selected; this is a
 * completeness check, not a dossier, and it must not become a way to pull bank
 * account numbers onto a board.
 */
async function loadStep2ForApplications(
  applicationIds: string[]
): Promise<Map<string, ApplicationStep2>> {
  const byApplication = new Map<string, ApplicationStep2>();
  if (applicationIds.length === 0) return byApplication;

  const supabase = getSupabaseServerClient();
  const [employment, bankAccounts, collateral, business] = await Promise.all([
    supabase
      .from("application_employment")
      .select("application_id, employment_status, employer_name, monthly_income, payroll_deduction_available")
      .in("application_id", applicationIds),
    supabase.from("application_bank_accounts").select("application_id").in("application_id", applicationIds),
    supabase
      .from("application_collateral")
      .select("application_id, collateral_type, vehicle_make, vehicle_model, vehicle_year, vehicle_plate")
      .in("application_id", applicationIds),
    supabase
      .from("application_business_profiles")
      .select("application_id, legal_name, registration_number, average_monthly_revenue, loan_purpose")
      .in("application_id", applicationIds),
  ]);

  for (const id of applicationIds) {
    byApplication.set(id, {
      applicationId: id,
      bankAccounts: [],
      obligations: [],
      guarantors: [],
      collateral: [],
    });
  }

  const rowsOf = <T,>(result: { data: unknown }): T[] => (result.data ?? []) as T[];

  for (const row of rowsOf<{
    application_id: string;
    employment_status: string;
    employer_name: string | null;
    monthly_income: number | null;
    payroll_deduction_available: string | null;
  }>(employment)) {
    const entry = byApplication.get(row.application_id);
    if (!entry) continue;
    entry.employment = {
      id: "",
      applicationId: row.application_id,
      employmentStatus: row.employment_status as EmploymentStatus,
      employerName: row.employer_name ?? undefined,
      monthlyIncome: row.monthly_income ?? undefined,
      payrollDeductionAvailable:
        (row.payroll_deduction_available as PayrollDeductionAvailability | null) ?? undefined,
    };
  }

  for (const row of rowsOf<{ application_id: string }>(bankAccounts)) {
    const entry = byApplication.get(row.application_id);
    if (!entry) continue;
    // Only the COUNT matters to the Step 2 rules, so the placeholder carries no
    // account data — there is nothing here that could leak a number.
    entry.bankAccounts.push({
      id: "",
      applicationId: row.application_id,
      bankName: "",
      accountType: "other" as BankAccountType,
      accountNumberLast4: "",
      isPrimary: false,
    });
  }

  for (const row of rowsOf<{
    application_id: string;
    collateral_type: string;
    vehicle_make: string | null;
    vehicle_model: string | null;
    vehicle_year: number | null;
    vehicle_plate: string | null;
  }>(collateral)) {
    const entry = byApplication.get(row.application_id);
    if (!entry) continue;
    entry.collateral.push({
      id: "",
      applicationId: row.application_id,
      collateralType: row.collateral_type as CollateralType,
      vehicleMake: row.vehicle_make ?? undefined,
      vehicleModel: row.vehicle_model ?? undefined,
      vehicleYear: row.vehicle_year ?? undefined,
      vehiclePlate: row.vehicle_plate ?? undefined,
    });
  }

  for (const row of rowsOf<{
    application_id: string;
    legal_name: string;
    registration_number: string | null;
    average_monthly_revenue: number | null;
    loan_purpose: string | null;
  }>(business)) {
    const entry = byApplication.get(row.application_id);
    if (!entry) continue;
    entry.businessProfile = {
      id: "",
      applicationId: row.application_id,
      legalName: row.legal_name,
      registrationNumber: row.registration_number ?? undefined,
      averageMonthlyRevenue: row.average_monthly_revenue ?? undefined,
      loanPurpose: (row.loan_purpose as LoanPurpose | null) ?? undefined,
    };
  }

  return byApplication;
}
