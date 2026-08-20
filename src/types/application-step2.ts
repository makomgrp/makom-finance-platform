/**
 * ============================================================================
 * STEP 2 — WHAT AN APPLICANT DECLARES ABOUT THEIR CIRCUMSTANCES (26A-2)
 * ============================================================================
 *
 * These types mirror the six application-owned tables added in
 * supabase/migrations/20260820065903_milestone_26a2_application_data_foundation.sql.
 *
 * THEY BELONG TO THE APPLICATION, NOT THE CLIENT. A person earning 2,500 today
 * who applies again in two years earning 3,500 must not retroactively rewrite
 * what the first application was assessed on. `Client` stays durable identity;
 * everything here is "what was declared for THIS loan request".
 *
 * The string unions below are the exact vocabularies the database CHECK
 * constraints enforce. They are stated once, here, so a service cannot invent a
 * value the database will reject at 3am.
 */

/** Employee or self-employed. Product V accepts either. */
export type EmploymentStatus = "employee" | "self_employed";

export type ContractType = "permanent" | "temporary" | "contractor" | "other";

/**
 * Whether the employer permits direct payroll deduction (product N).
 *
 * "unsure" is a REAL ANSWER, not a missing value — most applicants have not
 * asked their employer yet, and forcing a yes/no would manufacture a fact.
 */
export type PayrollDeductionAvailability = "yes" | "no" | "unsure";

export type BankAccountType = "savings" | "checking" | "other";

/** Whether the vehicle already carries financing or a lien (product V). */
export type LienStatus = "yes" | "no" | "unsure";

export type CollateralType = "vehicle" | "property";

export type LoanPurpose =
  | "working_capital"
  | "inventory"
  | "equipment"
  | "expansion"
  | "other";

export type BusinessRelationship =
  | "owner"
  | "partner"
  | "director"
  | "authorized_representative"
  | "other";

/** Whose debt this is — the applicant's own (N/D/V) or the company's (E). */
export type ObligationOwner = "applicant" | "business";

/** How the applicant earns. At most one per application. */
export interface ApplicationEmployment {
  id: string;
  applicationId: string;
  employmentStatus: EmploymentStatus;
  /** Employee only. */
  employerName?: string;
  /** Employee only. */
  jobTitle?: string;
  contractType?: ContractType;
  /** Self-employed only. */
  selfEmployedActivity?: string;
  /** Employment start for an employee, activity start for the self-employed. */
  startDate?: string;
  monthlyIncome?: number;
  /** Product N only. */
  payrollDeductionAvailable?: PayrollDeductionAvailability;
}

/** The applicant's declared personal finances. At most one per application. */
export interface ApplicationFinancialProfile {
  id: string;
  applicationId: string;
  monthlyExpenses?: number;
}

/**
 * A bank account nominated for direct debit — WITHOUT the account number.
 *
 * THIS IS THE ONLY SHAPE LIST-LEVEL CODE EVER SEES. `accountNumberLast4` is
 * derived by the database (a generated column), so it cannot drift from the
 * value it masks. The full number is deliberately absent from this type rather
 * than merely optional: a field that is not here cannot be logged, serialised
 * into a client component, or leaked by a careless spread.
 */
export interface ApplicationBankAccountSummary {
  id: string;
  applicationId: string;
  bankName: string;
  accountType: BankAccountType;
  /** Render as ****1234. Never the full number. */
  accountNumberLast4: string;
  receivesSalary?: boolean;
  isPrimary: boolean;
}

/**
 * The same account WITH the full number.
 *
 * A SEPARATE TYPE ON PURPOSE. Reading the full account number requires asking
 * for it by name, through a single-record service call — which makes every such
 * read visible in review rather than an accident of a wide SELECT.
 */
export interface ApplicationBankAccountDetail extends ApplicationBankAccountSummary {
  accountNumber: string;
}

/** One existing debt. Zero-to-many per application. */
export interface ApplicationObligation {
  id: string;
  applicationId: string;
  obligationOwner: ObligationOwner;
  lenderName: string;
  outstandingBalance?: number;
  monthlyPayment?: number;
}

/**
 * Someone offered as guarantor.
 *
 * NOT A CLIENT, and deliberately never written into `clients` — see the table
 * comment in the migration. They have not consented and are not verified.
 */
export interface ApplicationGuarantor {
  id: string;
  applicationId: string;
  fullName: string;
  email?: string;
  phone?: string;
}

/**
 * Security pledged for the loan.
 *
 * For product V the vehicle is one the applicant ALREADY OWNS and may already
 * have encumbered — which is why `ownedByApplicant` and `lienStatus` exist.
 * This is not a purchase being financed.
 */
export interface ApplicationCollateral {
  id: string;
  applicationId: string;
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

/** The company behind a business application. At most one per application. */
export interface ApplicationBusinessProfile {
  id: string;
  applicationId: string;
  legalName: string;
  tradeName?: string;
  economicActivity?: string;
  operationsStartDate?: string;
  /** Panama RUC / registry number. */
  registrationNumber?: string;
  averageMonthlyRevenue?: number;
  averageMonthlyExpenses?: number;
  loanPurpose?: LoanPurpose;
  purposeDescription?: string;
  applicantRelationship?: BusinessRelationship;
}

/**
 * Everything Step 2 holds for one application, in one shape.
 *
 * Every part is optional because Step 2 is filled in PROGRESSIVELY: an
 * application legitimately has no employment record until the applicant reaches
 * that question. Absence here means "not declared yet", never "invalid".
 *
 * Note `bankAccounts` carries the SUMMARY type — the bundle can never leak a
 * full account number.
 */
export interface ApplicationStep2 {
  applicationId: string;
  employment?: ApplicationEmployment;
  financialProfile?: ApplicationFinancialProfile;
  bankAccounts: ApplicationBankAccountSummary[];
  obligations: ApplicationObligation[];
  guarantors: ApplicationGuarantor[];
  collateral: ApplicationCollateral[];
  businessProfile?: ApplicationBusinessProfile;
}
