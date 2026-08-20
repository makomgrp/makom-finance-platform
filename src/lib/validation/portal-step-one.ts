import "server-only";

/**
 * ============================================================================
 * STEP 1 VALIDATION (26B-1)
 * ============================================================================
 *
 * Authoritative server-side validation for the public portal's first step.
 * Pure functions only — no Supabase, no Client/Application/Product logic.
 *
 * SEPARATE FROM public-application-intake.ts ON PURPOSE. That module validates
 * the LEGACY long website form, which demands ten applicant fields plus amount,
 * term and consent in one shot. Step 1 asks for six identity fields, a product
 * and the loan basics, and must ACCEPT the absence of everything else — a
 * portal customer has not reached those questions yet. Sharing one validator
 * would mean one of the two forms getting rules that do not fit it.
 *
 * NO INVENTED PANAMANIAN RULES. There is no cédula checksum here and no
 * national phone-format regex, because this repository has never implemented
 * either and guessing one would reject real people. A Panamanian cédula, a
 * passport, a foreign résident's document and a WhatsApp-era phone number all
 * have to get through. What IS enforced is payload sanity: type, presence,
 * trimming and length caps.
 *
 * NAMES ARE NOT REFORMATTED. No uppercasing, no title-casing, no accent
 * stripping. "de la Guardia" and "MARÍA" are how those people write their
 * names, and a form that silently rewrites them is telling the customer they
 * typed their own name wrong.
 */

export type PortalStepOneFieldErrorCode =
  | "REQUIRED"
  | "TOO_LONG"
  | "INVALID_EMAIL"
  | "INVALID_IDENTIFICATION_TYPE"
  | "INVALID_PRODUCT"
  | "INVALID_NUMBER"
  | "OUT_OF_RANGE";

export type PortalStepOneField =
  | "firstName"
  | "lastName"
  | "phone"
  | "email"
  | "identificationType"
  | "identificationNumber"
  | "productCode"
  | "requestedAmount"
  | "requestedTermMonths";

export interface NormalizedPortalStepOne {
  firstName: string;
  lastName: string;
  /** What the intake actually stores. Rebuilt from the two parts above. */
  fullName: string;
  phone: string;
  email: string;
  identificationType: "cedula" | "pasaporte";
  identificationNumber: string;
  /** The public N/D/V/E code. The action resolves it to a real Product. */
  productCode: string;
  requestedAmount: number;
  requestedTermMonths: number;
}

export type PortalStepOneValidationResult =
  | { status: "ok"; value: NormalizedPortalStepOne }
  | { status: "error"; fieldErrors: Partial<Record<PortalStepOneField, PortalStepOneFieldErrorCode>> };

const MAX_NAME = 100;
const MAX_EMAIL = 254;
const MAX_PHONE = 30;
const MAX_IDENTIFICATION = 50;

/** Overflow guards against numeric(12,2) and the term CHECK, not lending policy. */
const MAX_AMOUNT = 99_999_999.99;
const MAX_TERM_MONTHS = 360;

/**
 * Deliberately permissive: one @, something either side, a dot in the domain.
 * Stricter regexes are famous for rejecting valid addresses, and the real
 * confirmation that an address works is an email arriving at it.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readString(body: Record<string, unknown>, key: string): string {
  const raw = body[key];
  return typeof raw === "string" ? raw.trim() : "";
}

function readNumber(body: Record<string, unknown>, key: string): number | undefined {
  const raw = body[key];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    // Accept "1,500" and "1 500" — a customer typing an amount the way they
    // would write it is not making a mistake.
    const cleaned = raw.replace(/[\s,]/g, "");
    if (cleaned === "") return undefined;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * Validate one Step 1 submission.
 *
 * `activeProductCodes` holds the N/D/V/E codes of products that are active RIGHT
 * NOW, passed IN rather than fetched here: the authoritative catalog is the
 * Product service, and this module must not acquire a second opinion about
 * which products exist. An unrecognised code is an error, never silently
 * dropped — see the 26B-1 intake-engine note about a malformed product never
 * being reinterpreted as "no product".
 */
export function validatePortalStepOne(
  body: unknown,
  activeProductCodes: ReadonlySet<string>
): PortalStepOneValidationResult {
  if (typeof body !== "object" || body === null) {
    return { status: "error", fieldErrors: { firstName: "REQUIRED" } };
  }
  const input = body as Record<string, unknown>;
  const fieldErrors: Partial<Record<PortalStepOneField, PortalStepOneFieldErrorCode>> = {};

  const firstName = readString(input, "firstName");
  if (!firstName) fieldErrors.firstName = "REQUIRED";
  else if (firstName.length > MAX_NAME) fieldErrors.firstName = "TOO_LONG";

  const lastName = readString(input, "lastName");
  if (!lastName) fieldErrors.lastName = "REQUIRED";
  else if (lastName.length > MAX_NAME) fieldErrors.lastName = "TOO_LONG";

  const phone = readString(input, "phone");
  if (!phone) fieldErrors.phone = "REQUIRED";
  else if (phone.length > MAX_PHONE) fieldErrors.phone = "TOO_LONG";

  const email = readString(input, "email");
  if (!email) fieldErrors.email = "REQUIRED";
  else if (email.length > MAX_EMAIL) fieldErrors.email = "TOO_LONG";
  else if (!EMAIL_PATTERN.test(email)) fieldErrors.email = "INVALID_EMAIL";

  const identificationType = readString(input, "identificationType");
  if (!identificationType) fieldErrors.identificationType = "REQUIRED";
  else if (identificationType !== "cedula" && identificationType !== "pasaporte") {
    fieldErrors.identificationType = "INVALID_IDENTIFICATION_TYPE";
  }

  const identificationNumber = readString(input, "identificationNumber");
  if (!identificationNumber) fieldErrors.identificationNumber = "REQUIRED";
  else if (identificationNumber.length > MAX_IDENTIFICATION) {
    fieldErrors.identificationNumber = "TOO_LONG";
  }

  // Upper-cased before checking so a lower-case code from a hand-written
  // website link is accepted rather than rejected as unknown.
  const productCode = readString(input, "productCode").toUpperCase();
  if (!productCode) fieldErrors.productCode = "REQUIRED";
  else if (!activeProductCodes.has(productCode)) fieldErrors.productCode = "INVALID_PRODUCT";

  const requestedAmount = readNumber(input, "requestedAmount");
  if (requestedAmount === undefined) fieldErrors.requestedAmount = "REQUIRED";
  else if (requestedAmount <= 0 || requestedAmount > MAX_AMOUNT) {
    fieldErrors.requestedAmount = "OUT_OF_RANGE";
  }

  const requestedTermMonths = readNumber(input, "requestedTermMonths");
  if (requestedTermMonths === undefined) fieldErrors.requestedTermMonths = "REQUIRED";
  else if (!Number.isInteger(requestedTermMonths)) {
    fieldErrors.requestedTermMonths = "INVALID_NUMBER";
  } else if (requestedTermMonths <= 0 || requestedTermMonths > MAX_TERM_MONTHS) {
    fieldErrors.requestedTermMonths = "OUT_OF_RANGE";
  }

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", fieldErrors };
  }

  return {
    status: "ok",
    value: {
      firstName,
      lastName,
      // The intake schema has ONE name column, so the two inputs are joined
      // here rather than the table being reshaped. Splitting the name in the
      // UI is a courtesy to the customer, not a new data model.
      fullName: `${firstName} ${lastName}`,
      phone,
      email,
      identificationType: identificationType as "cedula" | "pasaporte",
      identificationNumber,
      productCode,
      requestedAmount: requestedAmount!,
      requestedTermMonths: requestedTermMonths!,
    },
  };
}

/**
 * Best-effort split of a stored full name back into two inputs for prefill.
 *
 * FIRST WORD, THEN THE REST — because Spanish names commonly carry two
 * surnames ("Ana Gómez Pérez"), and putting "Gómez Pérez" in the surname field
 * is right far more often than the alternative. It is a display convenience
 * only: whatever the customer confirms is what gets saved, and the stored name
 * is never rewritten by this function.
 */
export function splitFullName(fullName: string | undefined): { firstName: string; lastName: string } {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}
