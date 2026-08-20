import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getApplicationById } from "@/lib/services/applications";
import type {
  ApplicationBankAccountDetail,
  ApplicationBankAccountSummary,
  ApplicationBusinessProfile,
  ApplicationCollateral,
  ApplicationEmployment,
  ApplicationFinancialProfile,
  ApplicationGuarantor,
  ApplicationObligation,
  ApplicationStep2,
  BranchScope,
} from "@/types";

/**
 * ============================================================================
 * READING STEP 2 (Milestone 26A-2)
 * ============================================================================
 *
 * The read side of the six application-owned tables added in 26A-2. Writes are
 * deliberately NOT here: there is no portal and no CRM screen to write from
 * yet, and inventing an input contract for a UI that does not exist would be
 * guessing. They arrive with the surface that needs them.
 *
 * ----------------------------------------------------------------------------
 * AUTHORIZATION IS INHERITED, NOT REINVENTED
 * ----------------------------------------------------------------------------
 * Step 2 data has no authorization model of its own. Every function below first
 * resolves the APPLICATION through getApplicationById(scope, id) — the same
 * branch-scoped read 25B-1 built and 25B-2 enforces mutations against. If the
 * caller cannot see the application, they get NOT_FOUND and no query against
 * these tables is ever issued.
 *
 * That is the whole point: adding six tables must not open a seventh door.
 * There is no second scope check here to drift out of step with the first, and
 * out-of-scope is reported as NOT_FOUND exactly as everywhere else — never as a
 * distinct code that would confirm the record exists in another branch.
 *
 * ----------------------------------------------------------------------------
 * THE BANK ACCOUNT NUMBER
 * ----------------------------------------------------------------------------
 * getApplicationStep2() selects `account_number_last4` and NEVER
 * `account_number`. The full value has its own function, its own return type,
 * and has to be asked for by name — so a wide read cannot leak it and a code
 * review can see every place that wants it. The column list is explicit; this
 * codebase has never used SELECT *, which is what makes that guarantee hold.
 */

const EMPLOYMENT_SELECT =
  "id, application_id, employment_status, employer_name, job_title, contract_type, " +
  "self_employed_activity, start_date, monthly_income, payroll_deduction_available";

const FINANCIAL_SELECT = "id, application_id, monthly_expenses";

/** DELIBERATELY OMITS account_number. See the module header. */
const BANK_ACCOUNT_SUMMARY_SELECT =
  "id, application_id, bank_name, account_type, account_number_last4, receives_salary, is_primary";

const OBLIGATION_SELECT =
  "id, application_id, obligation_owner, lender_name, outstanding_balance, monthly_payment";

const GUARANTOR_SELECT = "id, application_id, full_name, email, phone";

const COLLATERAL_SELECT =
  "id, application_id, collateral_type, vehicle_make, vehicle_model, vehicle_year, " +
  "vehicle_plate, owned_by_applicant, lien_status, lien_balance, property_type, property_location";

const BUSINESS_SELECT =
  "id, application_id, legal_name, trade_name, economic_activity, operations_start_date, " +
  "registration_number, average_monthly_revenue, average_monthly_expenses, loan_purpose, " +
  "purpose_description, applicant_relationship";

/* eslint-disable @typescript-eslint/no-explicit-any -- Row shapes are the
   database's, mapped immediately below into the typed domain models; the
   alternative is seven near-duplicate row interfaces that add no safety. */
type Row = Record<string, any>;

function toEmployment(row: Row): ApplicationEmployment {
  return {
    id: row.id,
    applicationId: row.application_id,
    employmentStatus: row.employment_status,
    employerName: row.employer_name ?? undefined,
    jobTitle: row.job_title ?? undefined,
    contractType: row.contract_type ?? undefined,
    selfEmployedActivity: row.self_employed_activity ?? undefined,
    startDate: row.start_date ?? undefined,
    monthlyIncome: row.monthly_income ?? undefined,
    payrollDeductionAvailable: row.payroll_deduction_available ?? undefined,
  };
}

function toFinancialProfile(row: Row): ApplicationFinancialProfile {
  return {
    id: row.id,
    applicationId: row.application_id,
    monthlyExpenses: row.monthly_expenses ?? undefined,
  };
}

function toBankAccountSummary(row: Row): ApplicationBankAccountSummary {
  return {
    id: row.id,
    applicationId: row.application_id,
    bankName: row.bank_name,
    accountType: row.account_type,
    accountNumberLast4: row.account_number_last4,
    receivesSalary: row.receives_salary ?? undefined,
    isPrimary: row.is_primary,
  };
}

function toObligation(row: Row): ApplicationObligation {
  return {
    id: row.id,
    applicationId: row.application_id,
    obligationOwner: row.obligation_owner,
    lenderName: row.lender_name,
    outstandingBalance: row.outstanding_balance ?? undefined,
    monthlyPayment: row.monthly_payment ?? undefined,
  };
}

function toGuarantor(row: Row): ApplicationGuarantor {
  return {
    id: row.id,
    applicationId: row.application_id,
    fullName: row.full_name,
    email: row.email ?? undefined,
    phone: row.phone ?? undefined,
  };
}

function toCollateral(row: Row): ApplicationCollateral {
  return {
    id: row.id,
    applicationId: row.application_id,
    collateralType: row.collateral_type,
    vehicleMake: row.vehicle_make ?? undefined,
    vehicleModel: row.vehicle_model ?? undefined,
    vehicleYear: row.vehicle_year ?? undefined,
    vehiclePlate: row.vehicle_plate ?? undefined,
    ownedByApplicant: row.owned_by_applicant ?? undefined,
    lienStatus: row.lien_status ?? undefined,
    lienBalance: row.lien_balance ?? undefined,
    propertyType: row.property_type ?? undefined,
    propertyLocation: row.property_location ?? undefined,
  };
}

function toBusinessProfile(row: Row): ApplicationBusinessProfile {
  return {
    id: row.id,
    applicationId: row.application_id,
    legalName: row.legal_name,
    tradeName: row.trade_name ?? undefined,
    economicActivity: row.economic_activity ?? undefined,
    operationsStartDate: row.operations_start_date ?? undefined,
    registrationNumber: row.registration_number ?? undefined,
    averageMonthlyRevenue: row.average_monthly_revenue ?? undefined,
    averageMonthlyExpenses: row.average_monthly_expenses ?? undefined,
    loanPurpose: row.loan_purpose ?? undefined,
    purposeDescription: row.purpose_description ?? undefined,
    applicantRelationship: row.applicant_relationship ?? undefined,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export type GetApplicationStep2Result =
  | { status: "ok"; step2: ApplicationStep2 }
  | { status: "error"; code: "NOT_FOUND" | "QUERY_FAILED" };

/**
 * Everything Step 2 holds for one application.
 *
 * Absence means NOT DECLARED YET, never invalid — Step 2 is filled in
 * progressively, so an application with no employment row is a normal
 * in-progress application, not a broken one.
 *
 * Bank accounts come back WITHOUT their numbers. Use
 * getApplicationBankAccountDetail() when the full value is genuinely needed.
 */
export async function getApplicationStep2(
  scope: BranchScope,
  applicationId: string
): Promise<GetApplicationStep2Result> {
  // The application IS the authorization. Out of scope stops here, and no
  // query against the Step 2 tables is issued at all.
  const application = await getApplicationById(scope, applicationId);
  if (application.status !== "ok") {
    return { status: "error", code: "NOT_FOUND" };
  }

  try {
    const supabase = getSupabaseServerClient();
    const [employment, financial, bankAccounts, obligations, guarantors, collateral, business] =
      await Promise.all([
        supabase
          .from("application_employment")
          .select(EMPLOYMENT_SELECT)
          .eq("application_id", applicationId)
          .maybeSingle(),
        supabase
          .from("application_financial_profiles")
          .select(FINANCIAL_SELECT)
          .eq("application_id", applicationId)
          .maybeSingle(),
        supabase
          .from("application_bank_accounts")
          .select(BANK_ACCOUNT_SUMMARY_SELECT)
          .eq("application_id", applicationId)
          .order("is_primary", { ascending: false }),
        supabase
          .from("application_obligations")
          .select(OBLIGATION_SELECT)
          .eq("application_id", applicationId)
          .order("created_at", { ascending: true }),
        supabase
          .from("application_guarantors")
          .select(GUARANTOR_SELECT)
          .eq("application_id", applicationId)
          .order("created_at", { ascending: true }),
        supabase
          .from("application_collateral")
          .select(COLLATERAL_SELECT)
          .eq("application_id", applicationId)
          .order("created_at", { ascending: true }),
        supabase
          .from("application_business_profiles")
          .select(BUSINESS_SELECT)
          .eq("application_id", applicationId)
          .maybeSingle(),
      ]);

    const failure =
      employment.error ??
      financial.error ??
      bankAccounts.error ??
      obligations.error ??
      guarantors.error ??
      collateral.error ??
      business.error;
    if (failure) {
      console.error("[application-step2 service] Failed to load Step 2 data:", failure.message);
      return { status: "error", code: "QUERY_FAILED" };
    }

    return {
      status: "ok",
      step2: {
        applicationId,
        employment: employment.data ? toEmployment(employment.data) : undefined,
        financialProfile: financial.data ? toFinancialProfile(financial.data) : undefined,
        bankAccounts: (bankAccounts.data ?? []).map(toBankAccountSummary),
        obligations: (obligations.data ?? []).map(toObligation),
        guarantors: (guarantors.data ?? []).map(toGuarantor),
        collateral: (collateral.data ?? []).map(toCollateral),
        businessProfile: business.data ? toBusinessProfile(business.data) : undefined,
      },
    };
  } catch (error) {
    console.error(
      "[application-step2 service] Unexpected failure loading Step 2 data:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error", code: "QUERY_FAILED" };
  }
}

export type GetBankAccountDetailResult =
  | { status: "ok"; bankAccount: ApplicationBankAccountDetail }
  | { status: "error"; code: "NOT_FOUND" | "QUERY_FAILED" };

/**
 * THE ONE PLACE A FULL BANK ACCOUNT NUMBER IS READ.
 *
 * Separate from getApplicationStep2() on purpose: retrieving the full number
 * has to be a deliberate, single-record request, so every caller that wants it
 * is visible in review rather than hidden inside a wide read.
 *
 * Authorized exactly like everything else here — the owning application is
 * resolved through the caller's branch scope first, and the account id alone
 * grants nothing. The error message never distinguishes "wrong application"
 * from "no such account".
 *
 * The returned value must not be logged, cached, or passed into a client
 * component. Callers render `accountNumberLast4` unless there is a specific,
 * justified reason to show more.
 */
export async function getApplicationBankAccountDetail(
  scope: BranchScope,
  applicationId: string,
  bankAccountId: string
): Promise<GetBankAccountDetailResult> {
  const application = await getApplicationById(scope, applicationId);
  if (application.status !== "ok") {
    return { status: "error", code: "NOT_FOUND" };
  }

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("application_bank_accounts")
      .select(`${BANK_ACCOUNT_SUMMARY_SELECT}, account_number`)
      .eq("id", bankAccountId)
      // Ownership is part of the SAME query: an account belonging to another
      // application simply does not come back.
      .eq("application_id", applicationId)
      .maybeSingle();

    if (error) {
      // Deliberately does not log the row — this query can return the number.
      console.error("[application-step2 service] Failed to load bank account detail.");
      return { status: "error", code: "QUERY_FAILED" };
    }
    if (!data) return { status: "error", code: "NOT_FOUND" };

    return {
      status: "ok",
      bankAccount: {
        ...toBankAccountSummary(data),
        accountNumber: (data as Row).account_number,
      },
    };
  } catch {
    console.error("[application-step2 service] Unexpected failure loading bank account detail.");
    return { status: "error", code: "QUERY_FAILED" };
  }
}

/**
 * Total declared monthly obligations, the figure affordability rests on.
 *
 * Computed from the rows rather than stored, so it can never drift from the
 * obligations themselves. `owner` narrows to the applicant's own debts or the
 * company's — a business application's financing is not the owner's household
 * burden and the two must not be silently added together.
 *
 * FEEDS THE EXISTING ANALYSIS ENGINE, does not replace it. This returns a
 * number; loan_criteria and application_analysis keep deciding what it means.
 */
export function totalMonthlyObligations(
  obligations: ApplicationObligation[],
  owner?: ApplicationObligation["obligationOwner"]
): number {
  return obligations
    .filter((obligation) => (owner ? obligation.obligationOwner === owner : true))
    .reduce((total, obligation) => total + (obligation.monthlyPayment ?? 0), 0);
}
