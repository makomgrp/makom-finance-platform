import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type {
  BankAccountType,
  CollateralType,
  ContractType,
  EmploymentStatus,
  LienStatus,
  LoanPurpose,
  ObligationOwner,
  PayrollDeductionAvailability,
  BusinessRelationship,
} from "@/types";

/**
 * ============================================================================
 * WRITING STEP 2 (26B-2)
 * ============================================================================
 *
 * The write half of the six application-owned tables 26A-2 created. That
 * milestone deliberately shipped read-only ("they arrive with the surface that
 * needs them"); the portal's Step 2 is that surface.
 *
 * NOTHING NEW WAS MODELLED. Every value below lands in a 26A-2 column, with
 * 26A-2's own CHECK constraints doing the validating. No JSON blob, no second
 * obligations model, no parallel guarantor table.
 *
 * ----------------------------------------------------------------------------
 * THE APPLICATION IS THE ONLY THING THE CALLER MAY NAME
 * ----------------------------------------------------------------------------
 * Every function takes an `applicationId` the CALLER RESOLVED FROM A
 * CONTINUATION TOKEN — never from the browser. Beyond that, the single-row
 * sections (employment, financial profile, business profile, guarantor, bank
 * account, collateral) are found BY application_id, so no row id crosses the
 * wire at all and none can be forged.
 *
 * Obligations are the one exception, because they are a variable-length list
 * the customer edits in place. Their ids are therefore checked against the
 * application before any update or delete — see `saveObligations`.
 *
 * ----------------------------------------------------------------------------
 * UPDATE IN PLACE, DO NOT DELETE-AND-RECREATE
 * ----------------------------------------------------------------------------
 * Single-row sections are UPDATEd when they already exist. Recreating them
 * would churn ids that other tables point at — 26A-3 binds requirement slots to
 * a specific guarantor and a specific collateral with ON DELETE CASCADE, so a
 * lazy delete-and-reinsert on every save would silently destroy a customer's
 * uploaded document requirements. Keeping the row keeps its documents.
 */

export type Step2WriteResult =
  | { status: "ok" }
  | { status: "error"; code: "WRITE_FAILED" | "FORBIDDEN_ROW" };

/* ------------------------------------------------------------------------- */
/* Employment                                                                 */
/* ------------------------------------------------------------------------- */

export interface EmploymentWrite {
  employmentStatus: EmploymentStatus;
  employerName?: string;
  jobTitle?: string;
  contractType?: ContractType;
  selfEmployedActivity?: string;
  startDate?: string;
  monthlyIncome?: number;
  payrollDeductionAvailable?: PayrollDeductionAvailability;
}

/**
 * At most one employment record per application (26A-2 put a UNIQUE on
 * application_id), so this is an upsert on that column.
 *
 * SWITCHING EMPLOYEE <-> SELF-EMPLOYED CLEARS THE OTHER BRANCH'S FIELDS, and
 * that is deliberate rather than incidental: `application_employment_shape_check`
 * requires employer_name AND job_title for an employee and
 * self_employed_activity for the self-employed. Leaving the abandoned branch
 * populated would keep a stale employer on a record that now says the person
 * works for themselves — a contradiction sitting in the underwriting data. The
 * columns not named by the chosen branch are written NULL every time, so the
 * stored record always describes exactly one situation.
 */
export async function saveEmployment(
  applicationId: string,
  input: EmploymentWrite
): Promise<Step2WriteResult> {
  const supabase = getSupabaseServerClient();
  const isEmployee = input.employmentStatus === "employee";

  const row = {
    application_id: applicationId,
    employment_status: input.employmentStatus,
    employer_name: isEmployee ? (input.employerName ?? null) : null,
    job_title: isEmployee ? (input.jobTitle ?? null) : null,
    contract_type: isEmployee ? (input.contractType ?? null) : null,
    self_employed_activity: isEmployee ? null : (input.selfEmployedActivity ?? null),
    start_date: input.startDate ?? null,
    monthly_income: input.monthlyIncome ?? null,
    payroll_deduction_available: input.payrollDeductionAvailable ?? null,
  };

  const { error } = await supabase
    .from("application_employment")
    .upsert(row, { onConflict: "application_id" });

  if (error) {
    console.error("[step2-write] Failed to save employment:", error.message);
    return { status: "error", code: "WRITE_FAILED" };
  }
  return { status: "ok" };
}

/* ------------------------------------------------------------------------- */
/* Financial profile                                                          */
/* ------------------------------------------------------------------------- */

export async function saveFinancialProfile(
  applicationId: string,
  monthlyExpenses: number | undefined
): Promise<Step2WriteResult> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("application_financial_profiles")
    .upsert(
      { application_id: applicationId, monthly_expenses: monthlyExpenses ?? null },
      { onConflict: "application_id" }
    );

  if (error) {
    console.error("[step2-write] Failed to save financial profile:", error.message);
    return { status: "error", code: "WRITE_FAILED" };
  }
  return { status: "ok" };
}

/* ------------------------------------------------------------------------- */
/* Obligations                                                                */
/* ------------------------------------------------------------------------- */

export interface ObligationWrite {
  /** Present only for a row that already exists. Verified against the application. */
  id?: string;
  lenderName: string;
  outstandingBalance?: number;
  monthlyPayment?: number;
}

/**
 * Reconcile the obligation list for ONE owner.
 *
 * SCOPED BY OWNER, and that scoping is the whole point for product E: a
 * business application records the COMPANY's financing as
 * obligation_owner = 'business'. Reconciling the full table would delete an
 * applicant's personal debts while saving the company's, and vice versa. Each
 * owner's list is reconciled independently and the other is never touched.
 *
 * THREE-WAY DIFF rather than delete-everything-and-reinsert: rows the customer
 * kept are UPDATEd, new rows are INSERTed, and only rows they actually removed
 * are DELETEd. That is what makes "remove the second loan" delete the second
 * loan rather than recreating all three with new ids.
 *
 * EVERY INBOUND ID IS CHECKED FIRST. `id` is the only value in Step 2 that
 * comes from the browser naming a specific row, so before anything is written
 * the supplied ids are intersected with the ids this application actually owns.
 * A forged or copied id from another application does not match, and the whole
 * save is refused rather than partially applied.
 */
export async function saveObligations(
  applicationId: string,
  owner: ObligationOwner,
  obligations: ObligationWrite[]
): Promise<Step2WriteResult> {
  const supabase = getSupabaseServerClient();

  const { data: existingRows, error: loadError } = await supabase
    .from("application_obligations")
    .select("id")
    .eq("application_id", applicationId)
    .eq("obligation_owner", owner);

  if (loadError) {
    console.error("[step2-write] Failed to load obligations:", loadError.message);
    return { status: "error", code: "WRITE_FAILED" };
  }

  const ownedIds = new Set(((existingRows ?? []) as { id: string }[]).map((r) => r.id));
  const submittedIds = obligations.map((o) => o.id).filter((id): id is string => Boolean(id));

  // Refuse outright rather than silently ignoring the offending row: a payload
  // naming someone else's obligation is not a partial mistake to paper over.
  if (submittedIds.some((id) => !ownedIds.has(id))) {
    return { status: "error", code: "FORBIDDEN_ROW" };
  }

  const keptIds = new Set(submittedIds);
  const toDelete = [...ownedIds].filter((id) => !keptIds.has(id));

  if (toDelete.length > 0) {
    const { error } = await supabase
      .from("application_obligations")
      .delete()
      .in("id", toDelete)
      // Belt and braces: the ids were already proven to belong here, and the
      // predicate says so again so the statement cannot reach past this
      // application even if the check above were ever refactored away.
      .eq("application_id", applicationId);
    if (error) {
      console.error("[step2-write] Failed to delete obligations:", error.message);
      return { status: "error", code: "WRITE_FAILED" };
    }
  }

  for (const obligation of obligations) {
    const values = {
      lender_name: obligation.lenderName,
      outstanding_balance: obligation.outstandingBalance ?? null,
      monthly_payment: obligation.monthlyPayment ?? null,
    };

    if (obligation.id) {
      const { error } = await supabase
        .from("application_obligations")
        .update(values)
        .eq("id", obligation.id)
        .eq("application_id", applicationId);
      if (error) {
        console.error("[step2-write] Failed to update obligation:", error.message);
        return { status: "error", code: "WRITE_FAILED" };
      }
    } else {
      const { error } = await supabase.from("application_obligations").insert({
        application_id: applicationId,
        obligation_owner: owner,
        ...values,
      });
      if (error) {
        console.error("[step2-write] Failed to insert obligation:", error.message);
        return { status: "error", code: "WRITE_FAILED" };
      }
    }
  }

  return { status: "ok" };
}

/* ------------------------------------------------------------------------- */
/* Guarantor                                                                  */
/* ------------------------------------------------------------------------- */

export interface GuarantorWrite {
  fullName: string;
  email?: string;
  phone?: string;
}

/**
 * The portal manages exactly ONE guarantor — the oldest row.
 *
 * The table supports 0..n and 26A-3 can bind per-guarantor document
 * requirements, but this first version's UX asks about one, so it owns one.
 *
 * ANY OTHER GUARANTOR ROWS ARE LEFT ALONE. Nothing in the portal can create a
 * second one today, so extras would have to have come from somewhere else —
 * and deleting rows this screen never offered to manage, along with whatever
 * 26A-3 requirement slots hang off them, is not a decision a "no" on a radio
 * button should make. Answering "no" removes the one the portal manages.
 */
export async function saveGuarantor(
  applicationId: string,
  guarantor: GuarantorWrite | undefined
): Promise<Step2WriteResult> {
  const supabase = getSupabaseServerClient();

  const { data: existingRows, error: loadError } = await supabase
    .from("application_guarantors")
    .select("id")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: true });

  if (loadError) {
    console.error("[step2-write] Failed to load guarantors:", loadError.message);
    return { status: "error", code: "WRITE_FAILED" };
  }
  const rows = (existingRows ?? []) as { id: string }[];
  const managedId = rows[0]?.id;

  if (!guarantor) {
    if (managedId) {
      const { error } = await supabase
        .from("application_guarantors")
        .delete()
        .eq("id", managedId)
        .eq("application_id", applicationId);
      if (error) {
        console.error("[step2-write] Failed to remove guarantor:", error.message);
        return { status: "error", code: "WRITE_FAILED" };
      }
    }
    return { status: "ok" };
  }

  const values = {
    full_name: guarantor.fullName,
    email: guarantor.email ?? null,
    phone: guarantor.phone ?? null,
  };

  const { error } = managedId
    ? await supabase
        .from("application_guarantors")
        .update(values)
        .eq("id", managedId)
        .eq("application_id", applicationId)
    : await supabase
        .from("application_guarantors")
        .insert({ application_id: applicationId, ...values });

  if (error) {
    console.error("[step2-write] Failed to save guarantor:", error.message);
    return { status: "error", code: "WRITE_FAILED" };
  }
  return { status: "ok" };
}

/* ------------------------------------------------------------------------- */
/* Bank account                                                               */
/* ------------------------------------------------------------------------- */

export interface BankAccountWrite {
  bankName: string;
  accountType: BankAccountType;
  /**
   * OMITTED when the customer is not changing it.
   *
   * That is what lets the resume screen show only `****1234` and still save:
   * the full number is not sent back, so it is not overwritten. A value here
   * means the customer deliberately entered a replacement.
   */
  accountNumber?: string;
  receivesSalary?: boolean;
}

/**
 * Manages the application's primary account — the oldest row, same rule as the
 * guarantor.
 *
 * THE ACCOUNT NUMBER IS NEVER LOGGED and never round-trips through the browser
 * on a resume. `account_number_last4` is a generated column (26A-2), so the
 * mask is derived by the database from whatever is stored and cannot drift out
 * of step with it.
 */
export async function saveBankAccount(
  applicationId: string,
  account: BankAccountWrite | undefined
): Promise<Step2WriteResult> {
  if (!account) return { status: "ok" };

  const supabase = getSupabaseServerClient();
  const { data: existingRows, error: loadError } = await supabase
    .from("application_bank_accounts")
    .select("id")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: true });

  if (loadError) {
    console.error("[step2-write] Failed to load bank accounts:", loadError.message);
    return { status: "error", code: "WRITE_FAILED" };
  }
  const managedId = ((existingRows ?? []) as { id: string }[])[0]?.id;

  if (managedId) {
    // account_number is included ONLY when supplied — see the type's note.
    const values: Record<string, unknown> = {
      bank_name: account.bankName,
      account_type: account.accountType,
      receives_salary: account.receivesSalary ?? null,
    };
    if (account.accountNumber) values.account_number = account.accountNumber;

    const { error } = await supabase
      .from("application_bank_accounts")
      .update(values)
      .eq("id", managedId)
      .eq("application_id", applicationId);
    if (error) {
      console.error("[step2-write] Failed to update bank account:", error.message);
      return { status: "error", code: "WRITE_FAILED" };
    }
    return { status: "ok" };
  }

  // A brand-new account genuinely needs a number — the column is NOT NULL, and
  // there is nothing stored to fall back on.
  if (!account.accountNumber) return { status: "ok" };

  const { error } = await supabase.from("application_bank_accounts").insert({
    application_id: applicationId,
    bank_name: account.bankName,
    account_type: account.accountType,
    account_number: account.accountNumber,
    receives_salary: account.receivesSalary ?? null,
    is_primary: true,
  });

  if (error) {
    console.error("[step2-write] Failed to insert bank account:", error.message);
    return { status: "error", code: "WRITE_FAILED" };
  }
  return { status: "ok" };
}

/* ------------------------------------------------------------------------- */
/* Collateral                                                                 */
/* ------------------------------------------------------------------------- */

export interface CollateralWrite {
  collateralType: CollateralType;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleYear?: number;
  vehiclePlate?: string;
  ownedByApplicant?: boolean;
  lienStatus?: LienStatus;
  lienBalance?: number;
  propertyType?: string;
  propertyLocation?: string;
}

/**
 * Manages the application's single collateral row.
 *
 * UPDATED IN PLACE, NEVER REPLACED. 26A-3 binds vehicle document requirements
 * to a specific collateral id with ON DELETE CASCADE, so deleting and
 * reinserting on every save would take the customer's vehicle document slots —
 * and eventually their uploaded files — with it.
 *
 * The branch not chosen is written NULL, because
 * `application_collateral_shape_check` requires a vehicle row to carry no
 * property columns and vice versa. A property that used to be a vehicle must
 * not keep a plate.
 */
export async function saveCollateral(
  applicationId: string,
  collateral: CollateralWrite | undefined
): Promise<Step2WriteResult> {
  if (!collateral) return { status: "ok" };

  const supabase = getSupabaseServerClient();
  const { data: existingRows, error: loadError } = await supabase
    .from("application_collateral")
    .select("id")
    .eq("application_id", applicationId)
    .order("created_at", { ascending: true });

  if (loadError) {
    console.error("[step2-write] Failed to load collateral:", loadError.message);
    return { status: "error", code: "WRITE_FAILED" };
  }
  const managedId = ((existingRows ?? []) as { id: string }[])[0]?.id;

  const isVehicle = collateral.collateralType === "vehicle";
  const values = {
    collateral_type: collateral.collateralType,
    vehicle_make: isVehicle ? (collateral.vehicleMake ?? null) : null,
    vehicle_model: isVehicle ? (collateral.vehicleModel ?? null) : null,
    vehicle_year: isVehicle ? (collateral.vehicleYear ?? null) : null,
    vehicle_plate: isVehicle ? (collateral.vehiclePlate ?? null) : null,
    owned_by_applicant: collateral.ownedByApplicant ?? null,
    lien_status: collateral.lienStatus ?? null,
    // A lien balance only means something when there IS a lien.
    lien_balance: collateral.lienStatus === "yes" ? (collateral.lienBalance ?? null) : null,
    property_type: isVehicle ? null : (collateral.propertyType ?? null),
    property_location: isVehicle ? null : (collateral.propertyLocation ?? null),
  };

  const { error } = managedId
    ? await supabase
        .from("application_collateral")
        .update(values)
        .eq("id", managedId)
        .eq("application_id", applicationId)
    : await supabase
        .from("application_collateral")
        .insert({ application_id: applicationId, ...values });

  if (error) {
    console.error("[step2-write] Failed to save collateral:", error.message);
    return { status: "error", code: "WRITE_FAILED" };
  }
  return { status: "ok" };
}

/* ------------------------------------------------------------------------- */
/* Business profile                                                           */
/* ------------------------------------------------------------------------- */

export interface BusinessProfileWrite {
  legalName: string;
  tradeName?: string;
  economicActivity?: string;
  operationsStartDate?: string;
  registrationNumber?: string;
  averageMonthlyRevenue?: number;
  averageMonthlyExpenses?: number;
  loanPurpose?: LoanPurpose;
  purposeDescription?: string;
  applicantRelationship?: BusinessRelationship;
}

export async function saveBusinessProfile(
  applicationId: string,
  business: BusinessProfileWrite | undefined
): Promise<Step2WriteResult> {
  if (!business) return { status: "ok" };

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("application_business_profiles").upsert(
    {
      application_id: applicationId,
      legal_name: business.legalName,
      trade_name: business.tradeName ?? null,
      economic_activity: business.economicActivity ?? null,
      operations_start_date: business.operationsStartDate ?? null,
      registration_number: business.registrationNumber ?? null,
      average_monthly_revenue: business.averageMonthlyRevenue ?? null,
      average_monthly_expenses: business.averageMonthlyExpenses ?? null,
      loan_purpose: business.loanPurpose ?? null,
      purpose_description: business.purposeDescription ?? null,
      applicant_relationship: business.applicantRelationship ?? null,
    },
    { onConflict: "application_id" }
  );

  if (error) {
    console.error("[step2-write] Failed to save business profile:", error.message);
    return { status: "error", code: "WRITE_FAILED" };
  }
  return { status: "ok" };
}
