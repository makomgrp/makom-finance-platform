import "server-only";
import { productAsksForGuarantor } from "@/lib/config/application";
import { isPrimarySocialNetwork } from "@/types";
import type { PrimarySocialNetwork } from "@/types";
import type {
  BankAccountType,
  BusinessRelationship,
  CollateralType,
  ContractType,
  EmploymentStatus,
  LienStatus,
  LoanPurpose,
  PayrollDeductionAvailability,
} from "@/types";

/**
 * ============================================================================
 * STEP 2 VALIDATION (26B-2)
 * ============================================================================
 *
 * Server-authoritative validation for the product-specific step. Pure
 * functions: no Supabase, no product catalog, no business rules of its own.
 *
 * ----------------------------------------------------------------------------
 * TWO MODES, BECAUSE "SAVED" AND "FINISHED" ARE DIFFERENT QUESTIONS
 * ----------------------------------------------------------------------------
 *   draft    — "Guardar y continuar después". Nothing is required. Anything
 *              the customer DID type must still be well-formed and storable.
 *   complete — "Continuar". Everything the product needs must be present.
 *
 * A nullable column is not the same thing as an optional question. 26A-2 made
 * most of these columns nullable so a half-finished application could be saved
 * at all; which of them a customer must eventually answer is a business rule,
 * and it lives here.
 *
 * ----------------------------------------------------------------------------
 * WHERE THE REQUIRED SET COMES FROM — NOT INVENTED HERE
 * ----------------------------------------------------------------------------
 * Two sources, both pre-existing:
 *
 *   1. 26A-2's own CHECK constraints. `application_employment_shape_check`
 *      already says an employee record must carry an employer and a job title;
 *      `application_collateral_shape_check` says a vehicle must carry make,
 *      model, year and plate. Data that violates these cannot be stored at all,
 *      so requiring them is not an added rule — it is the storage contract.
 *   2. 26A-4's `isStep2Complete`, which already decides per product what makes
 *      Step 2 done. That evaluator stays the single progress engine; this
 *      module simply refuses to let "Continue" through while it would say no.
 *
 * Everything else the milestone lists — contract type, start dates, trade name,
 * economic activity, monthly expenses — is collected but not demanded, because
 * nothing in the approved behaviour says a customer cannot proceed without it.
 *
 * ----------------------------------------------------------------------------
 * A STARTED SECTION MUST BE STORABLE, EVEN IN DRAFT
 * ----------------------------------------------------------------------------
 * If a customer types an employer and saves for later, the employment row
 * cannot be written without a job title (the CHECK). Silently dropping the
 * section would lose what they typed; so a partially-filled section reports
 * what it needs rather than vanishing.
 */

export type Step2Mode = "draft" | "complete";

export type Step2ErrorCode =
  | "REQUIRED"
  | "TOO_LONG"
  | "INVALID_EMAIL"
  | "INVALID_NUMBER"
  | "INVALID_DATE"
  | "DATE_IN_FUTURE"
  | "OUT_OF_RANGE"
  | "INVALID_OPTION";

export type Step2Errors = Record<string, Step2ErrorCode>;

/** The exact shape the client posts. Every value is a string: it came from a form. */
export interface Step2Payload {
  employmentStatus?: string;
  employerName?: string;
  jobTitle?: string;
  contractType?: string;
  selfEmployedActivity?: string;
  startDate?: string;
  monthlyIncome?: string;
  payrollDeductionAvailable?: string;

  monthlyExpenses?: string;

  // MILESTONE 26B-25 — otros ingresos. Los cuatro productos.
  hasAdditionalIncome?: string;
  additionalMonthlyIncome?: string;
  additionalIncomeSource?: string;

  // MILESTONE 26B-25 — red social principal. Los cuatro productos.
  primarySocialNetwork?: string;
  primarySocialNetworkOther?: string;

  hasObligations?: string;
  obligations?: Array<{
    id?: string;
    lenderName?: string;
    outstandingBalance?: string;
    monthlyPayment?: string;
  }>;

  hasGuarantor?: string;
  guarantorFullName?: string;
  guarantorEmail?: string;
  guarantorPhone?: string;

  bankName?: string;
  accountType?: string;
  accountNumber?: string;
  receivesSalary?: string;

  collateralType?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleYear?: string;
  vehiclePlate?: string;
  ownedByApplicant?: string;
  lienStatus?: string;
  lienBalance?: string;
  propertyType?: string;
  propertyLocation?: string;

  legalName?: string;
  tradeName?: string;
  economicActivity?: string;
  operationsStartDate?: string;
  registrationNumber?: string;
  averageMonthlyRevenue?: string;
  averageMonthlyExpenses?: string;
  loanPurpose?: string;
  purposeDescription?: string;
  applicantRelationship?: string;
}

export interface NormalizedStep2 {
  employment?: {
    employmentStatus: EmploymentStatus;
    employerName?: string;
    jobTitle?: string;
    contractType?: ContractType;
    selfEmployedActivity?: string;
    startDate?: string;
    monthlyIncome?: number;
    payrollDeductionAvailable?: PayrollDeductionAvailability;
  };
  monthlyExpenses?: number;
  /** MILESTONE 26B-25 — undefined = no preguntado; false = respondió que no. */
  hasAdditionalIncome?: boolean;
  additionalMonthlyIncome?: number;
  additionalIncomeSource?: string;
  primarySocialNetwork?: PrimarySocialNetwork;
  primarySocialNetworkOther?: string;
  obligations: Array<{
    id?: string;
    lenderName: string;
    outstandingBalance?: number;
    monthlyPayment?: number;
  }>;
  guarantor?: { fullName: string; email?: string; phone?: string };
  bankAccount?: {
    bankName: string;
    accountType: BankAccountType;
    accountNumber?: string;
    receivesSalary?: boolean;
  };
  collateral?: {
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
  };
  business?: {
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
  };
}

export type Step2ValidationResult =
  | { status: "ok"; value: NormalizedStep2 }
  | { status: "error"; fieldErrors: Step2Errors };

const MAX_TEXT = 200;
const MAX_LONG_TEXT = 500;
/** Overflow guard against numeric(12,2), not a lending limit. */
const MAX_MONEY = 99_999_999.99;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const CONTRACT_TYPES: ContractType[] = ["permanent", "temporary", "contractor", "other"];
const YES_NO_UNSURE = ["yes", "no", "unsure"];
const ACCOUNT_TYPES: BankAccountType[] = ["savings", "checking", "other"];
const LOAN_PURPOSES: LoanPurpose[] = ["working_capital", "inventory", "equipment", "expansion", "other"];
const RELATIONSHIPS: BusinessRelationship[] = [
  "owner",
  "partner",
  "director",
  "authorized_representative",
  "other",
];

function text(value: string | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Accepts "1,500" and "1 500" — that is how people write amounts. */
function money(value: string | undefined): number | undefined {
  const raw = text(value).replace(/[\s,]/g, "");
  if (raw === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function integer(value: string | undefined): number | undefined {
  const raw = text(value).replace(/[\s,]/g, "");
  if (raw === "") return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

const isTrue = (value: string | undefined) => text(value) === "yes";

/**
 * Validate and normalise one Step 2 submission for one product.
 *
 * `productCode` is the N/D/V/E letter the SERVER resolved from the application
 * — never a value the browser chose. That is what makes cross-product leakage
 * impossible here: a payload carrying vehicle fields on a payroll application
 * simply has nowhere to land, because this function only ever reads the
 * sections its product owns.
 */
export function validatePortalStepTwo(
  productCode: string,
  payload: Step2Payload,
  mode: Step2Mode
): Step2ValidationResult {
  const errors: Step2Errors = {};
  const value: NormalizedStep2 = { obligations: [] };
  const required = mode === "complete";

  const checkText = (key: string, raw: string | undefined, max = MAX_TEXT): string => {
    const v = text(raw);
    if (v.length > max) errors[key] = "TOO_LONG";
    return v;
  };

  const checkMoney = (key: string, raw: string | undefined): number | undefined => {
    const v = money(raw);
    if (v === undefined) return undefined;
    if (Number.isNaN(v)) { errors[key] = "INVALID_NUMBER"; return undefined; }
    if (v < 0 || v > MAX_MONEY) { errors[key] = "OUT_OF_RANGE"; return undefined; }
    return v;
  };

  const checkDate = (key: string, raw: string | undefined): string | undefined => {
    const v = text(raw);
    if (v === "") return undefined;
    if (!ISO_DATE.test(v) || Number.isNaN(Date.parse(v))) { errors[key] = "INVALID_DATE"; return undefined; }
    // A start date in the future describes something that has not happened.
    if (Date.parse(v) > Date.now()) { errors[key] = "DATE_IN_FUTURE"; return undefined; }
    return v;
  };

  const requireValue = (key: string, present: boolean) => {
    if (required && !present && !errors[key]) errors[key] = "REQUIRED";
  };

  /* ---- Employment (N, D, V) --------------------------------------------- */
  if (productCode === "N" || productCode === "D" || productCode === "V") {
    // V is the only product that offers the self-employed branch; N and D are
    // payroll/salary products and are always employee.
    const rawStatus = text(payload.employmentStatus);
    const status: EmploymentStatus =
      productCode === "V" && rawStatus === "self_employed" ? "self_employed" : "employee";

    const employerName = checkText("employerName", payload.employerName);
    const jobTitle = checkText("jobTitle", payload.jobTitle);
    const activity = checkText("selfEmployedActivity", payload.selfEmployedActivity);
    const startDate = checkDate("startDate", payload.startDate);
    const monthlyIncome = checkMoney("monthlyIncome", payload.monthlyIncome);

    const rawContract = text(payload.contractType);
    if (rawContract && !CONTRACT_TYPES.includes(rawContract as ContractType)) {
      errors.contractType = "INVALID_OPTION";
    }

    const rawPayroll = text(payload.payrollDeductionAvailable);
    if (rawPayroll && !YES_NO_UNSURE.includes(rawPayroll)) {
      errors.payrollDeductionAvailable = "INVALID_OPTION";
    }

    const started =
      Boolean(employerName || jobTitle || activity || startDate || monthlyIncome !== undefined || rawPayroll);

    if (status === "employee") {
      // The storage contract, not an added rule — see this module's header.
      if (required || started) {
        requireValue("employerName", Boolean(employerName));
        requireValue("jobTitle", Boolean(jobTitle));
        if (!required && started) {
          if (!employerName) errors.employerName = "REQUIRED";
          if (!jobTitle) errors.jobTitle = "REQUIRED";
        }
      }
    } else if (required || started) {
      if (!activity) errors.selfEmployedActivity = "REQUIRED";
    }

    requireValue("monthlyIncome", monthlyIncome !== undefined);
    if (productCode === "N") requireValue("payrollDeductionAvailable", Boolean(rawPayroll));

    if (status === "employee" ? Boolean(employerName && jobTitle) : Boolean(activity)) {
      value.employment = {
        employmentStatus: status,
        employerName: status === "employee" ? employerName : undefined,
        jobTitle: status === "employee" ? jobTitle : undefined,
        contractType:
          status === "employee" && rawContract ? (rawContract as ContractType) : undefined,
        selfEmployedActivity: status === "self_employed" ? activity : undefined,
        startDate,
        monthlyIncome,
        payrollDeductionAvailable:
          productCode === "N" && rawPayroll
            ? (rawPayroll as PayrollDeductionAvailability)
            : undefined,
      };
    }

    value.monthlyExpenses = checkMoney("monthlyExpenses", payload.monthlyExpenses);
  }

  /* ---- Otros ingresos (los cuatro productos) ----------------------------- */
  //
  // MILESTONE 26B-25. Tres campos que responden UNA pregunta, así que se validan
  // juntos y se guardan juntos. Sin responder deja los tres vacíos, y eso no es
  // un error: nadie preguntó esto a quien empezó su solicitud antes de hoy.
  //
  // "Sí" exige el monto. La fuente queda opcional a propósito: quien dice
  // "sí, unos B/. 300" y no elabora ya ha dicho algo cierto, y rechazarlo sería
  // perder la cifra por proteger una frase. Mismo criterio que el CHECK.
  const rawAdditional = text(payload.hasAdditionalIncome);
  if (rawAdditional === "yes" || rawAdditional === "no") {
    const yes = rawAdditional === "yes";
    value.hasAdditionalIncome = yes;
    if (yes) {
      const amount = checkMoney("additionalMonthlyIncome", payload.additionalMonthlyIncome);
      if (amount === undefined || amount <= 0) {
        if (!errors.additionalMonthlyIncome) errors.additionalMonthlyIncome = "REQUIRED";
      } else {
        value.additionalMonthlyIncome = amount;
      }
      const source = checkText("additionalIncomeSource", payload.additionalIncomeSource, 200);
      if (source) value.additionalIncomeSource = source;
    }
    // Si respondió "no", monto y fuente NO se copian: el CHECK de la tabla los
    // exige nulos, y arrastrar lo que llegó a escribir antes de cambiar de idea
    // guardaría un dato que la persona ya retiró.
  }

  /* ---- Red social principal (los cuatro productos) ----------------------- */
  //
  // MILESTONE 26B-25. Se guarda en el CLIENTE, no en la solicitud: quien tiene
  // tres préstamos tiene un solo Instagram.
  const rawSocial = text(payload.primarySocialNetwork);
  if (rawSocial !== "") {
    if (!isPrimarySocialNetwork(rawSocial)) {
      errors.primarySocialNetwork = "INVALID_OPTION";
    } else {
      value.primarySocialNetwork = rawSocial;
      if (rawSocial === "other") {
        const other = checkText("primarySocialNetworkOther", payload.primarySocialNetworkOther, 60);
        if (!other) errors.primarySocialNetworkOther = "REQUIRED";
        else value.primarySocialNetworkOther = other;
      }
      // Si NO es `other`, el texto libre no se copia — así cambiar de opción no
      // puede dejar varada la descripción anterior.
    }
  }

  /* ---- Banking (D) ------------------------------------------------------- */
  if (productCode === "D") {
    const bankName = checkText("bankName", payload.bankName);
    const rawAccountType = text(payload.accountType);
    const accountNumber = text(payload.accountNumber);

    if (rawAccountType && !ACCOUNT_TYPES.includes(rawAccountType as BankAccountType)) {
      errors.accountType = "INVALID_OPTION";
    }
    // 26A-2's own bounds; not a new rule.
    if (accountNumber && (accountNumber.length < 4 || accountNumber.length > 34)) {
      errors.accountNumber = "OUT_OF_RANGE";
    }

    requireValue("bankName", Boolean(bankName));
    requireValue("accountType", Boolean(rawAccountType));

    if (bankName && rawAccountType) {
      value.bankAccount = {
        bankName,
        accountType: rawAccountType as BankAccountType,
        // Blank means "leave the stored number alone" — see BankAccountWrite.
        accountNumber: accountNumber || undefined,
        receivesSalary: text(payload.receivesSalary)
          ? isTrue(payload.receivesSalary)
          : undefined,
      };
    }
  }

  /* ---- Vehicle collateral (V) ------------------------------------------- */
  if (productCode === "V") {
    const make = checkText("vehicleMake", payload.vehicleMake);
    const model = checkText("vehicleModel", payload.vehicleModel);
    const plate = checkText("vehiclePlate", payload.vehiclePlate);
    const year = integer(payload.vehicleYear);
    if (year !== undefined) {
      if (Number.isNaN(year) || !Number.isInteger(year)) errors.vehicleYear = "INVALID_NUMBER";
      else if (year < 1900 || year > 2200) errors.vehicleYear = "OUT_OF_RANGE";
    }

    const rawLien = text(payload.lienStatus);
    if (rawLien && !YES_NO_UNSURE.includes(rawLien)) errors.lienStatus = "INVALID_OPTION";
    const lienBalance = checkMoney("lienBalance", payload.lienBalance);

    const complete = Boolean(make && model && plate && year !== undefined && !errors.vehicleYear);
    const started = Boolean(make || model || plate || year !== undefined);

    if (required || started) {
      if (!make) errors.vehicleMake = "REQUIRED";
      if (!model) errors.vehicleModel = "REQUIRED";
      if (!plate) errors.vehiclePlate = "REQUIRED";
      if (year === undefined) errors.vehicleYear = "REQUIRED";
    }

    if (complete) {
      value.collateral = {
        collateralType: "vehicle",
        vehicleMake: make,
        vehicleModel: model,
        vehicleYear: year,
        vehiclePlate: plate,
        ownedByApplicant: text(payload.ownedByApplicant)
          ? isTrue(payload.ownedByApplicant)
          : undefined,
        lienStatus: rawLien ? (rawLien as LienStatus) : undefined,
        lienBalance,
      };
    }
  }

  /* ---- Business (E) ------------------------------------------------------ */
  if (productCode === "E") {
    const legalName = checkText("legalName", payload.legalName);
    const tradeName = checkText("tradeName", payload.tradeName);
    const economicActivity = checkText("economicActivity", payload.economicActivity);
    const registrationNumber = checkText("registrationNumber", payload.registrationNumber);
    const operationsStartDate = checkDate("operationsStartDate", payload.operationsStartDate);
    const revenue = checkMoney("averageMonthlyRevenue", payload.averageMonthlyRevenue);
    const expenses = checkMoney("averageMonthlyExpenses", payload.averageMonthlyExpenses);
    const purposeDescription = checkText("purposeDescription", payload.purposeDescription, MAX_LONG_TEXT);

    const rawPurpose = text(payload.loanPurpose);
    if (rawPurpose && !LOAN_PURPOSES.includes(rawPurpose as LoanPurpose)) {
      errors.loanPurpose = "INVALID_OPTION";
    }
    const rawRelationship = text(payload.applicantRelationship);
    if (rawRelationship && !RELATIONSHIPS.includes(rawRelationship as BusinessRelationship)) {
      errors.applicantRelationship = "INVALID_OPTION";
    }

    const started = Boolean(
      legalName || tradeName || economicActivity || registrationNumber ||
      operationsStartDate || revenue !== undefined || expenses !== undefined || rawPurpose
    );

    // legal_name is NOT NULL: without it the row cannot exist at all.
    if ((required || started) && !legalName) errors.legalName = "REQUIRED";
    requireValue("registrationNumber", Boolean(registrationNumber));
    requireValue("averageMonthlyRevenue", revenue !== undefined);
    requireValue("loanPurpose", Boolean(rawPurpose));

    if (legalName) {
      value.business = {
        legalName,
        tradeName: tradeName || undefined,
        economicActivity: economicActivity || undefined,
        operationsStartDate,
        registrationNumber: registrationNumber || undefined,
        averageMonthlyRevenue: revenue,
        averageMonthlyExpenses: expenses,
        loanPurpose: rawPurpose ? (rawPurpose as LoanPurpose) : undefined,
        purposeDescription: purposeDescription || undefined,
        applicantRelationship: rawRelationship
          ? (rawRelationship as BusinessRelationship)
          : undefined,
      };
    }

    /* Collateral for E: vehicle OR property. */
    const rawCollateralType = text(payload.collateralType);
    if (rawCollateralType === "vehicle" || rawCollateralType === "property") {
      if (rawCollateralType === "vehicle") {
        const make = checkText("vehicleMake", payload.vehicleMake);
        const model = checkText("vehicleModel", payload.vehicleModel);
        const plate = checkText("vehiclePlate", payload.vehiclePlate);
        const year = integer(payload.vehicleYear);
        if (year !== undefined && (Number.isNaN(year) || !Number.isInteger(year))) {
          errors.vehicleYear = "INVALID_NUMBER";
        } else if (year !== undefined && (year < 1900 || year > 2200)) {
          errors.vehicleYear = "OUT_OF_RANGE";
        }
        if (!make) errors.vehicleMake = "REQUIRED";
        if (!model) errors.vehicleModel = "REQUIRED";
        if (!plate) errors.vehiclePlate = "REQUIRED";
        if (year === undefined) errors.vehicleYear = "REQUIRED";

        if (make && model && plate && year !== undefined && !errors.vehicleYear) {
          value.collateral = {
            collateralType: "vehicle",
            vehicleMake: make,
            vehicleModel: model,
            vehicleYear: year,
            vehiclePlate: plate,
          };
        }
      } else {
        const propertyType = checkText("propertyType", payload.propertyType);
        const propertyLocation = checkText("propertyLocation", payload.propertyLocation);
        if (!propertyType) errors.propertyType = "REQUIRED";
        if (!propertyLocation) errors.propertyLocation = "REQUIRED";
        if (propertyType && propertyLocation) {
          value.collateral = { collateralType: "property", propertyType, propertyLocation };
        }
      }
    } else if (rawCollateralType) {
      errors.collateralType = "INVALID_OPTION";
    }
  }

  /* ---- Obligations (all products) --------------------------------------- */
  if (isTrue(payload.hasObligations)) {
    const rows = Array.isArray(payload.obligations) ? payload.obligations : [];
    rows.forEach((row, index) => {
      const lenderName = text(row.lenderName);
      const balance = money(row.outstandingBalance);
      const payment = money(row.monthlyPayment);

      // lender_name is NOT NULL — an obligation with no lender is not a record
      // of anything.
      if (!lenderName) errors[`obligations.${index}.lenderName`] = "REQUIRED";
      else if (lenderName.length > MAX_TEXT) errors[`obligations.${index}.lenderName`] = "TOO_LONG";

      if (balance !== undefined && (Number.isNaN(balance) || balance < 0 || balance > MAX_MONEY)) {
        errors[`obligations.${index}.outstandingBalance`] =
          Number.isNaN(balance) ? "INVALID_NUMBER" : "OUT_OF_RANGE";
      }
      if (payment !== undefined && (Number.isNaN(payment) || payment < 0 || payment > MAX_MONEY)) {
        errors[`obligations.${index}.monthlyPayment`] =
          Number.isNaN(payment) ? "INVALID_NUMBER" : "OUT_OF_RANGE";
      }

      if (lenderName) {
        value.obligations.push({
          id: row.id,
          lenderName,
          outstandingBalance:
            balance !== undefined && !Number.isNaN(balance) ? balance : undefined,
          monthlyPayment:
            payment !== undefined && !Number.isNaN(payment) ? payment : undefined,
        });
      }
    });
  }
  // "No" leaves value.obligations empty, which the write layer reconciles into
  // "remove the ones that were there" — the honest meaning of answering no.

  /* ---- Guarantor (D, V) — see productAsksForGuarantor (26B-25) ---------- */
  if (productAsksForGuarantor(productCode) && isTrue(payload.hasGuarantor)) {
    const fullName = checkText("guarantorFullName", payload.guarantorFullName);
    const email = checkText("guarantorEmail", payload.guarantorEmail, 254);
    const phone = checkText("guarantorPhone", payload.guarantorPhone, 30);

    if (!fullName) errors.guarantorFullName = "REQUIRED";
    if (email && !EMAIL_PATTERN.test(email)) errors.guarantorEmail = "INVALID_EMAIL";

    if (fullName) {
      value.guarantor = { fullName, email: email || undefined, phone: phone || undefined };
    }
  }

  if (Object.keys(errors).length > 0) return { status: "error", fieldErrors: errors };
  return { status: "ok", value };
}
