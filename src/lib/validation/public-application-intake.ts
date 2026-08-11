import "server-only";

/**
 * Authoritative server-side validation for the public website Application
 * Intake endpoint (Milestone 15C — see
 * src/app/api/public/application-intake/route.ts). Pure functions only —
 * no Supabase access here, no Client/Application/Product logic. This
 * module's only job is: given an untrusted request body, decide whether
 * it is well-formed enough to hand to createApplicationIntake(), and
 * normalize it into that exact shape.
 *
 * Deliberately validates against the REAL constraints this data will
 * eventually hit (application_intakes' CHECK constraints,
 * requirement_term_months' 1-360 bound, monthly_salary >= 0) rather than
 * inventing new ODL-specific business policy (no minimum loan amount, no
 * minimum age, no salary floor) — see the Milestone 15B brief's own
 * "do not invent ODL-specific business limits" instruction, which
 * applies equally here since this is still just intake, not underwriting.
 *
 * Every string field is trimmed and length-capped purely as a payload-
 * sanity/overflow guard, not a business rule.
 */

export type PublicIntakeFieldErrorCode =
  | "REQUIRED"
  | "TOO_LONG"
  | "INVALID_EMAIL"
  | "INVALID_IDENTIFICATION_TYPE"
  | "INVALID_DATE"
  | "DATE_IN_FUTURE"
  | "INVALID_NUMBER"
  | "OUT_OF_RANGE"
  | "MUST_ACCEPT";

export type PublicIntakeValidationResult =
  | { status: "ok"; value: NormalizedPublicIntake }
  | { status: "error"; fieldErrors: Partial<Record<string, PublicIntakeFieldErrorCode>> };

export interface NormalizedPublicIntake {
  submissionId: string;
  fullName: string;
  identificationType: "cedula" | "pasaporte";
  identificationNumber: string;
  email: string;
  phone: string;
  birthDate: string;
  nationality: string;
  address: string;
  position: string;
  employerName?: string;
  monthlySalary: number;
  requestedProductCode: string;
  requestedAmount: number;
  requestedTermMonths: number;
}

const MAX_SHORT_TEXT = 200;
const MAX_LONG_TEXT = 500;
const MAX_IDENTIFICATION = 50;
const MAX_EMAIL = 254;
const MAX_PHONE = 30;
// Comfortably under numeric(12,2)'s ceiling — an overflow/garbage guard,
// not a lending policy. See this module's own doc comment.
const MAX_AMOUNT = 99_999_999.99;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function readString(body: Record<string, unknown>, key: string): string | undefined {
  const raw = body[key];
  return typeof raw === "string" ? raw.trim() : undefined;
}

function readNumber(body: Record<string, unknown>, key: string): number | undefined {
  const raw = body[key];
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

/**
 * Validates and normalizes one untrusted request body. Only ever reads
 * the exact named fields below — this is what structurally guarantees
 * the endpoint can never be tricked into forwarding an unexpected field
 * (channel, matched_client_id, created_application_id, review_reason,
 * any automation-event field) to createApplicationIntake(): those keys
 * are simply never read here, regardless of what the caller sends.
 */
export function validatePublicApplicationIntake(
  body: unknown,
  validProductCodes: ReadonlySet<string>
): PublicIntakeValidationResult {
  const fieldErrors: Partial<Record<string, PublicIntakeFieldErrorCode>> = {};

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { status: "error", fieldErrors: { _root: "REQUIRED" } };
  }
  const raw = body as Record<string, unknown>;

  const submissionId = readString(raw, "submissionId");
  // A syntactically-real UUID isn't required for correctness (the DB's
  // own unique(channel, submission_id) constraint is what actually
  // enforces idempotency) — only non-empty and bounded, so a malformed
  // client can't send something absurd.
  if (!submissionId) fieldErrors.submissionId = "REQUIRED";
  else if (submissionId.length > MAX_IDENTIFICATION) fieldErrors.submissionId = "TOO_LONG";

  const fullName = readString(raw, "fullName");
  if (!fullName) fieldErrors.fullName = "REQUIRED";
  else if (fullName.length > MAX_SHORT_TEXT) fieldErrors.fullName = "TOO_LONG";

  const identificationTypeRaw = readString(raw, "identificationType");
  if (!identificationTypeRaw) fieldErrors.identificationType = "REQUIRED";
  else if (identificationTypeRaw !== "cedula" && identificationTypeRaw !== "pasaporte") {
    fieldErrors.identificationType = "INVALID_IDENTIFICATION_TYPE";
  }

  const identificationNumber = readString(raw, "identificationNumber");
  if (!identificationNumber) fieldErrors.identificationNumber = "REQUIRED";
  else if (identificationNumber.length > MAX_IDENTIFICATION) fieldErrors.identificationNumber = "TOO_LONG";

  const email = readString(raw, "email");
  if (!email) fieldErrors.email = "REQUIRED";
  else if (email.length > MAX_EMAIL) fieldErrors.email = "TOO_LONG";
  else if (!EMAIL_PATTERN.test(email)) fieldErrors.email = "INVALID_EMAIL";

  const phone = readString(raw, "phone");
  if (!phone) fieldErrors.phone = "REQUIRED";
  else if (phone.length > MAX_PHONE) fieldErrors.phone = "TOO_LONG";

  const birthDate = readString(raw, "birthDate");
  if (!birthDate) {
    fieldErrors.birthDate = "REQUIRED";
  } else {
    const parsed = new Date(`${birthDate}T00:00:00Z`);
    if (Number.isNaN(parsed.getTime())) {
      fieldErrors.birthDate = "INVALID_DATE";
    } else if (parsed.getTime() > Date.now()) {
      fieldErrors.birthDate = "DATE_IN_FUTURE";
    }
  }

  const nationality = readString(raw, "nationality");
  if (!nationality) fieldErrors.nationality = "REQUIRED";
  else if (nationality.length > MAX_SHORT_TEXT) fieldErrors.nationality = "TOO_LONG";

  const address = readString(raw, "address");
  if (!address) fieldErrors.address = "REQUIRED";
  else if (address.length > MAX_LONG_TEXT) fieldErrors.address = "TOO_LONG";

  const position = readString(raw, "position");
  if (!position) fieldErrors.position = "REQUIRED";
  else if (position.length > MAX_SHORT_TEXT) fieldErrors.position = "TOO_LONG";

  const employerNameRaw = readString(raw, "employerName");
  if (employerNameRaw && employerNameRaw.length > MAX_SHORT_TEXT) fieldErrors.employerName = "TOO_LONG";

  const monthlySalary = readNumber(raw, "monthlySalary");
  if (monthlySalary === undefined) fieldErrors.monthlySalary = "INVALID_NUMBER";
  else if (monthlySalary < 0 || monthlySalary > MAX_AMOUNT) fieldErrors.monthlySalary = "OUT_OF_RANGE";

  const requestedProductCode = readString(raw, "requestedProductCode");
  if (!requestedProductCode) fieldErrors.requestedProductCode = "REQUIRED";
  else if (!validProductCodes.has(requestedProductCode)) fieldErrors.requestedProductCode = "OUT_OF_RANGE";

  const requestedAmount = readNumber(raw, "requestedAmount");
  if (requestedAmount === undefined) fieldErrors.requestedAmount = "INVALID_NUMBER";
  else if (requestedAmount <= 0 || requestedAmount > MAX_AMOUNT) fieldErrors.requestedAmount = "OUT_OF_RANGE";

  // Mirrors application_intakes_requested_term_months_check exactly
  // (1-360) — a real constraint this data will hit, not an invented one.
  const requestedTermMonths = readNumber(raw, "requestedTermMonths");
  if (requestedTermMonths === undefined || !Number.isInteger(requestedTermMonths)) {
    fieldErrors.requestedTermMonths = "INVALID_NUMBER";
  } else if (requestedTermMonths <= 0 || requestedTermMonths > 360) {
    fieldErrors.requestedTermMonths = "OUT_OF_RANGE";
  }

  const consent = raw.consent;
  if (consent !== true) fieldErrors.consent = "MUST_ACCEPT";

  if (Object.keys(fieldErrors).length > 0) {
    return { status: "error", fieldErrors };
  }

  return {
    status: "ok",
    value: {
      submissionId: submissionId!,
      fullName: fullName!,
      identificationType: identificationTypeRaw as "cedula" | "pasaporte",
      identificationNumber: identificationNumber!,
      email: email!,
      phone: phone!,
      birthDate: birthDate!,
      nationality: nationality!,
      address: address!,
      position: position!,
      employerName: employerNameRaw || undefined,
      monthlySalary: monthlySalary!,
      requestedProductCode: requestedProductCode!,
      requestedAmount: requestedAmount!,
      requestedTermMonths: requestedTermMonths!,
    },
  };
}

/** Honeypot check — a real, visible-to-bots-only hidden field. Any
 * non-empty value here means whatever filled it isn't a human using the
 * real form (browsers/humans never populate a field that's hidden and
 * has no visible label). Kept separate from validatePublicApplicationIntake
 * so the caller can soft-reject (respond as if successful, touch nothing)
 * rather than surfacing a validation error that would teach a bot what
 * tripped it. */
export function isHoneypotTriggered(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;
  const value = (body as Record<string, unknown>).website;
  return typeof value === "string" && value.trim().length > 0;
}
