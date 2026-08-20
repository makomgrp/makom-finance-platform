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
  | "OUT_OF_RANGE";

export type PortalStepOneField =
  | "fullName"
  | "phone"
  | "email"
  | "identificationType"
  | "identificationNumber"
  | "productCode"
  | "requestedAmount";

export interface NormalizedPortalStepOne {
  /**
   * ONE field, matching the approved Step 1 (26B-1A) and the one column the
   * intake actually has. The earlier first-name/last-name split was a UI
   * invention that had to be joined on the way in and guessed apart on the way
   * out — two lossy conversions in service of a question ODL never asked.
   */
  fullName: string;
  phone: string;
  email: string;
  identificationType: "cedula" | "pasaporte";
  identificationNumber: string;
  /** The public N/D/V/E code. The action resolves it to a real Product. */
  productCode: string;
  requestedAmount: number;
}

export type PortalStepOneValidationResult =
  | { status: "ok"; value: NormalizedPortalStepOne }
  | { status: "error"; fieldErrors: Partial<Record<PortalStepOneField, PortalStepOneFieldErrorCode>> };

const MAX_NAME = 100;
const MAX_EMAIL = 254;
const MAX_PHONE = 30;
const MAX_IDENTIFICATION = 50;

/** Overflow guard against numeric(12,2), not lending policy. */
const MAX_AMOUNT = 99_999_999.99;

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
    return { status: "error", fieldErrors: { fullName: "REQUIRED" } };
  }
  const input = body as Record<string, unknown>;
  const fieldErrors: Partial<Record<PortalStepOneField, PortalStepOneFieldErrorCode>> = {};

  const fullName = readString(input, "fullName");
  if (!fullName) fieldErrors.fullName = "REQUIRED";
  else if (fullName.length > MAX_NAME) fieldErrors.fullName = "TOO_LONG";

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

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", fieldErrors };
  }

  return {
    status: "ok",
    value: {
      fullName,
      phone,
      email,
      identificationType: identificationType as "cedula" | "pasaporte",
      identificationNumber,
      productCode,
      requestedAmount: requestedAmount!,
    },
  };
}
