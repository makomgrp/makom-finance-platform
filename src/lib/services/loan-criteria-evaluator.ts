import { REQUIREMENT_SLOT_STATUS_ORDER } from "@/lib/config/requirement-slot";
import type {
  Application,
  Client,
  CriterionEvaluation,
  CriterionEvaluationOutcome,
  CriterionReasonCode,
  LoanCriterion,
  LoanCriterionFieldSource,
  LoanCriterionType,
  PreliminaryRecommendation,
  RequirementSlot,
  RequirementSlotStatus,
} from "@/types";

/**
 * The Milestone 15E deterministic evaluation engine (see the Milestone 15E
 * migration and its architecture review, V1-V3). Pure, framework-free logic
 * only — no Supabase import, no "server-only" (unlike every other file in
 * src/lib/services/, this one touches no database and holds no secret, so
 * there is nothing to protect from browser bundling; src/lib/format.ts is
 * this codebase's existing precedent for a pure-logic file with the same
 * omission). Every function here is a plain function of its inputs: given
 * the same LoanCriterion + facts, evaluateCriterion always returns the same
 * CriterionEvaluation. This is what makes it directly unit-testable without
 * a live database — see this milestone's implementation report for how it
 * was exercised.
 *
 * ZERO lending-rule evaluation happens anywhere else in this codebase —
 * this file is the ONE place criterion_type/field_source semantics are
 * interpreted. It never makes a final lending decision (see
 * aggregateRecommendation's doc comment) and never performs a DB write of
 * any kind.
 */

// ============================================================================
// Age calculation
// ============================================================================

/**
 * Real calendar age from an ISO "YYYY-MM-DD" birth date (clients.birth_date
 * is a plain SQL `date` column — no time, no timezone component). Computed
 * from integer year/month/day components only, never from a millisecond
 * timestamp difference — that avoids both the "divide by 365" approximation
 * error and any dependence on the server process's local timezone: `asOf`'s
 * UTC calendar date is used as "today", since a timezone-less `date` column
 * has no meaningful local-time interpretation to align with.
 *
 * Returns null (never throws) for a missing, malformed, or impossible
 * (future) birth date — the caller must treat that as "fact unavailable",
 * i.e. an unknown criterion outcome, never a crash and never silently
 * treated as age 0.
 */
export function calculateAge(birthDateIso: string | undefined, asOf: Date = new Date()): number | null {
  if (!birthDateIso) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthDateIso);
  if (!match) return null;

  const birthYear = Number(match[1]);
  const birthMonth = Number(match[2]);
  const birthDay = Number(match[3]);
  if (birthMonth < 1 || birthMonth > 12 || birthDay < 1 || birthDay > 31) return null;

  const todayYear = asOf.getUTCFullYear();
  const todayMonth = asOf.getUTCMonth() + 1;
  const todayDay = asOf.getUTCDate();

  const birthIsAfterToday =
    birthYear > todayYear ||
    (birthYear === todayYear && birthMonth > todayMonth) ||
    (birthYear === todayYear && birthMonth === todayMonth && birthDay > todayDay);
  if (birthIsAfterToday) return null;

  let age = todayYear - birthYear;
  const birthdayNotYetReachedThisYear = todayMonth < birthMonth || (todayMonth === birthMonth && todayDay < birthDay);
  if (birthdayNotYetReachedThisYear) age -= 1;

  return age;
}

// ============================================================================
// Fact resolution
// ============================================================================

/** Everything evaluateCriterion needs to know about one Application/Client
 * pair, resolved once up front by buildApplicationFacts — never re-derived
 * per criterion. clientAge is the only field that can be unavailable: every
 * other Application/Client column this engine reads is NOT NULL at the
 * database level. */
export interface ApplicationFacts {
  applicationRequestedAmount: number;
  applicationRequestedTermMonths: number;
  clientMonthlySalary: number;
  /** null when the client's birth date is missing, malformed, or in the
   * future — see calculateAge. */
  clientAge: number | null;
  clientNationality: string;
  clientIdentificationType: string;
  clientRestricted: boolean;
}

/** Resolves the seven non-requirement_slot_status facts from an already-
 * loaded Application + Client. Deliberately does not touch Requirement
 * Slots at all — those are resolved separately per-criterion via
 * fieldSourceDetail, since which slot matters depends on the criterion
 * being evaluated, not on the Application alone. */
export function buildApplicationFacts(application: Application, client: Client): ApplicationFacts {
  return {
    applicationRequestedAmount: application.requestedAmount,
    applicationRequestedTermMonths: application.requestedTermMonths,
    clientMonthlySalary: client.monthlySalary,
    clientAge: calculateAge(client.birthDate),
    clientNationality: client.nationality,
    clientIdentificationType: client.identificationType,
    clientRestricted: client.restricted,
  };
}

type ScalarFact =
  | { available: true; type: "number"; value: number }
  | { available: true; type: "boolean"; value: boolean }
  | { available: true; type: "string"; value: string }
  | { available: false };

/** Resolves one of the seven scalar field sources against already-built
 * facts. Must never be called with fieldSource === "requirement_slot_
 * status" — that one requires a RequirementSlot lookup, not a scalar fact,
 * see resolveRequirementSlotFact below. */
function resolveScalarFact(fieldSource: LoanCriterionFieldSource, facts: ApplicationFacts): ScalarFact {
  switch (fieldSource) {
    case "application_requested_amount":
      return { available: true, type: "number", value: facts.applicationRequestedAmount };
    case "application_requested_term_months":
      return { available: true, type: "number", value: facts.applicationRequestedTermMonths };
    case "client_monthly_salary":
      return { available: true, type: "number", value: facts.clientMonthlySalary };
    case "client_age":
      return facts.clientAge === null ? { available: false } : { available: true, type: "number", value: facts.clientAge };
    case "client_nationality":
      return { available: true, type: "string", value: facts.clientNationality };
    case "client_identification_type":
      return { available: true, type: "string", value: facts.clientIdentificationType };
    case "client_restricted":
      return { available: true, type: "boolean", value: facts.clientRestricted };
    case "requirement_slot_status":
      return { available: false };
  }
}

/** Resolves the one Requirement Slot a requirement_slot_status criterion
 * targets, by its fieldSourceDetail (the frozen RequirementSlot.code
 * snapshot key — see requirement-slot.ts's own doc comment on `code`).
 * Deliberately looks up the Application's own Requirement Slot snapshot,
 * never the live/current RequirementTemplate: a slot's code, once created,
 * is frozen forever, which is exactly the historically-accurate source of
 * truth this criterion needs — a later edit to the live template must
 * never retroactively change what a past (or even in-progress) Application
 * is evaluated against. */
function resolveRequirementSlotFact(
  fieldSourceDetail: string | undefined,
  slotsByCode: ReadonlyMap<string, RequirementSlot>
): { found: false } | { found: true; status: RequirementSlotStatus } {
  if (!fieldSourceDetail) return { found: false };
  const slot = slotsByCode.get(fieldSourceDetail);
  return slot ? { found: true, status: slot.status } : { found: false };
}

// ============================================================================
// Configuration validation
// ============================================================================

/** Mirrors loan_criteria_field_source_criterion_type_check exactly — the
 * database is the final defense, but this lets analyzeApplication() reject
 * a malformed criterion with a clear internal error BEFORE ever attempting
 * to evaluate it, rather than producing a nonsensical result. */
const FIELD_SOURCE_CRITERION_TYPE_COMPAT: Record<LoanCriterionFieldSource, LoanCriterionType[]> = {
  application_requested_amount: ["numeric_minimum", "numeric_maximum", "required_field_present"],
  application_requested_term_months: ["numeric_minimum", "numeric_maximum", "required_field_present"],
  client_monthly_salary: ["numeric_minimum", "numeric_maximum", "required_field_present"],
  client_age: ["numeric_minimum", "numeric_maximum"],
  client_nationality: ["allowed_value_set", "required_field_present"],
  client_identification_type: ["allowed_value_set", "required_field_present"],
  client_restricted: ["boolean_equals"],
  requirement_slot_status: ["requirement_slot_status"],
};

export type LoanCriterionConfigurationValidation = { valid: true } | { valid: false; reason: string };

/**
 * Defense-in-depth mirror of this migration's own CHECK constraints
 * (loan_criteria_field_source_criterion_type_check and loan_criteria_
 * expected_value_shape_check). A row that fails this can only ever reach
 * evaluateCriterion via a corrupted read or a manually-inserted row that
 * bypassed application code entirely — the database itself cannot produce
 * one. Per this milestone's explicit design decision: a criterion that
 * fails this check must never be silently evaluated, silently skipped, or
 * folded into "missing_configuration" — it is a distinct internal
 * configuration error the caller (analyzeApplication) must surface as
 * such, not a business outcome. See this milestone's implementation
 * report, "Invalid configuration behavior" section, for the full
 * reasoning.
 */
export function validateLoanCriterionConfiguration(criterion: LoanCriterion): LoanCriterionConfigurationValidation {
  const allowedTypes = FIELD_SOURCE_CRITERION_TYPE_COMPAT[criterion.fieldSource];
  if (!allowedTypes.includes(criterion.criterionType)) {
    return {
      valid: false,
      reason: `fieldSource "${criterion.fieldSource}" is not compatible with criterionType "${criterion.criterionType}"`,
    };
  }

  if (criterion.fieldSource === "requirement_slot_status" && !criterion.fieldSourceDetail?.trim()) {
    return { valid: false, reason: "requirement_slot_status criteria must have a non-empty fieldSourceDetail" };
  }
  if (criterion.fieldSource !== "requirement_slot_status" && criterion.fieldSourceDetail) {
    return { valid: false, reason: `fieldSourceDetail must be absent for fieldSource "${criterion.fieldSource}"` };
  }

  switch (criterion.criterionType) {
    case "numeric_minimum":
    case "numeric_maximum":
      if (typeof criterion.expectedValue !== "number") {
        return { valid: false, reason: `expectedValue for "${criterion.criterionType}" must be a number` };
      }
      return { valid: true };
    case "boolean_equals":
      if (typeof criterion.expectedValue !== "boolean") {
        return { valid: false, reason: 'expectedValue for "boolean_equals" must be a boolean' };
      }
      return { valid: true };
    case "required_field_present":
      if (criterion.expectedValue !== true) {
        return { valid: false, reason: 'expectedValue for "required_field_present" must be true' };
      }
      return { valid: true };
    case "allowed_value_set":
      if (
        !Array.isArray(criterion.expectedValue) ||
        criterion.expectedValue.length === 0 ||
        !criterion.expectedValue.every((value) => typeof value === "string")
      ) {
        return { valid: false, reason: 'expectedValue for "allowed_value_set" must be a non-empty string array' };
      }
      return { valid: true };
    case "requirement_slot_status":
      if (
        !Array.isArray(criterion.expectedValue) ||
        criterion.expectedValue.length === 0 ||
        !criterion.expectedValue.every((value) => REQUIREMENT_SLOT_STATUS_ORDER.includes(value as RequirementSlotStatus))
      ) {
        return {
          valid: false,
          reason: 'expectedValue for "requirement_slot_status" must be a non-empty array of valid RequirementSlotStatus values',
        };
      }
      return { valid: true };
  }
}

// ============================================================================
// Criterion evaluation
// ============================================================================

interface EvaluationBase {
  loanCriteriaId: string;
  criterionCode: string;
  criterionName: CriterionEvaluation["criterionName"];
  criterionDescription: CriterionEvaluation["criterionDescription"];
  criterionType: LoanCriterionType;
  fieldSource: LoanCriterionFieldSource;
  fieldSourceDetail: string | undefined;
  severity: CriterionEvaluation["severity"];
  expectedValue: CriterionEvaluation["expectedValue"];
  displayOrder: number;
}

function unknownResult(base: EvaluationBase, reasonCode: CriterionReasonCode): CriterionEvaluation {
  return { ...base, outcome: "unknown", actualValue: null, reasonCode };
}

function outcomeResult(
  base: EvaluationBase,
  pass: boolean,
  actualValue: CriterionEvaluation["actualValue"],
  failReasonCode: CriterionReasonCode
): CriterionEvaluation {
  const outcome: CriterionEvaluationOutcome = pass ? "pass" : "fail";
  return { ...base, outcome, actualValue, reasonCode: pass ? undefined : failReasonCode };
}

/**
 * Evaluates exactly one LoanCriterion against already-resolved facts. Pure:
 * no DB access, no side effects, always returns one CriterionEvaluation.
 * Callers MUST call validateLoanCriterionConfiguration first — this
 * function assumes a valid criterion and does not re-validate.
 *
 * FAIL vs UNKNOWN, maintained strictly throughout: fail means the fact is
 * known and does not satisfy the rule; unknown means the fact could not be
 * determined at all. See this file's header comment and the Milestone 15E
 * migration's header comment — unknown must never collapse into fail.
 */
export function evaluateCriterion(
  criterion: LoanCriterion,
  facts: ApplicationFacts,
  slotsByCode: ReadonlyMap<string, RequirementSlot>
): CriterionEvaluation {
  const base: EvaluationBase = {
    loanCriteriaId: criterion.id,
    criterionCode: criterion.code,
    criterionName: criterion.name,
    criterionDescription: criterion.description,
    criterionType: criterion.criterionType,
    fieldSource: criterion.fieldSource,
    fieldSourceDetail: criterion.fieldSourceDetail,
    severity: criterion.severity,
    expectedValue: criterion.expectedValue,
    displayOrder: criterion.displayOrder,
  };

  switch (criterion.criterionType) {
    case "numeric_minimum":
    case "numeric_maximum": {
      const fact = resolveScalarFact(criterion.fieldSource, facts);
      if (!fact.available || fact.type !== "number") return unknownResult(base, "field_missing");
      const expected = criterion.expectedValue as number;
      const pass = criterion.criterionType === "numeric_minimum" ? fact.value >= expected : fact.value <= expected;
      const failReason: CriterionReasonCode = criterion.criterionType === "numeric_minimum" ? "below_minimum" : "above_maximum";
      return outcomeResult(base, pass, fact.value, failReason);
    }

    case "boolean_equals": {
      const fact = resolveScalarFact(criterion.fieldSource, facts);
      if (!fact.available) return unknownResult(base, "field_missing");
      const expected = criterion.expectedValue as boolean;
      const pass = fact.value === expected;
      return outcomeResult(base, pass, fact.value, "boolean_mismatch");
    }

    case "allowed_value_set": {
      const fact = resolveScalarFact(criterion.fieldSource, facts);
      if (!fact.available) return unknownResult(base, "field_missing");
      // Exact, case-sensitive membership check — no normalization. Silently
      // lowercasing/trimming here could change a canonical stored business
      // value (e.g. an identificationType/nationality code) into a match it
      // shouldn't be; this repo's existing services never normalize these
      // fields either (see clients.ts#createClient — stored verbatim).
      const allowed = criterion.expectedValue as string[];
      const actual = String(fact.value);
      const pass = allowed.includes(actual);
      return outcomeResult(base, pass, actual, "value_not_in_allowed_set");
    }

    case "required_field_present": {
      // Presence, not truthiness: today every field_source this criterion
      // type may pair with is a NOT NULL database column (see
      // FIELD_SOURCE_CRITERION_TYPE_COMPAT), so `fact.available` is always
      // true in practice — this criterion type exists for forward
      // compatibility with a future nullable field_source, not because
      // any current fact can actually be absent. Deliberately never
      // "unknown" — presence-or-absence IS the fact this criterion tests.
      const fact = resolveScalarFact(criterion.fieldSource, facts);
      return outcomeResult(base, fact.available, fact.available, "field_missing");
    }

    case "requirement_slot_status": {
      const slotFact = resolveRequirementSlotFact(criterion.fieldSourceDetail, slotsByCode);
      if (!slotFact.found) return unknownResult(base, "requirement_slot_unknown");
      const accepted = criterion.expectedValue as RequirementSlotStatus[];
      const pass = accepted.includes(slotFact.status);
      return outcomeResult(base, pass, slotFact.status, "requirement_slot_not_satisfied");
    }
  }
}

// ============================================================================
// Snapshot RPC payload shaping
// ============================================================================

/**
 * Converts one in-memory CriterionEvaluation into the exact JSON shape
 * create_application_analysis_snapshot's p_criterion_results expects, for
 * ONE specific reason: a confirmed PostgreSQL jsonb contract mismatch,
 * verified live against the real database (`'{"a": null}'::jsonb -> 'a' is
 * null` evaluates to false). The RPC's actual_value column extraction uses
 * `elem->'actualValue'` (the jsonb-returning arrow) — when the JSON key is
 * PRESENT with value `null`, this returns the jsonb 'null' literal, which
 * is NOT SQL NULL, and would violate application_analysis_criterion_
 * results_actual_value_presence_check (which requires true SQL NULL for
 * "unknown" outcomes), aborting the entire snapshot. When the key is
 * MISSING entirely, `->'` correctly returns true SQL NULL instead — so this
 * function's only job is to OMIT the actualValue key when it is null,
 * rather than sending it as an explicit JSON null.
 *
 * CriterionEvaluation.actualValue itself is untouched — it stays `null` in
 * memory for unknown-outcome results (the correct, meaningful in-memory
 * representation; unaffected by this RPC-boundary-only concern). Every
 * other optional field (criterionDescription, fieldSourceDetail,
 * reasonCode) is already `undefined`, not `null`, when absent —
 * `undefined` properties are dropped by JSON.stringify on their own, so
 * none of them need this same treatment; see this milestone's final-review
 * report for the full per-field audit. Lives here, not in application-
 * analysis.ts, specifically so it stays a pure, framework-free function
 * directly unit-testable without a live database or the "server-only"
 * import boundary — matches this file's own header comment.
 */
export function toSnapshotPayload(
  evaluation: CriterionEvaluation
): CriterionEvaluation | Omit<CriterionEvaluation, "actualValue"> {
  if (evaluation.actualValue !== null) {
    return evaluation;
  }
  const payload: Partial<CriterionEvaluation> = { ...evaluation };
  delete payload.actualValue;
  return payload as Omit<CriterionEvaluation, "actualValue">;
}

// ============================================================================
// Recommendation aggregation
// ============================================================================

/**
 * Deterministic aggregation over every criterion result for one analysis
 * run — the ONLY place a PreliminaryRecommendation is produced. NEVER
 * returns a final lending decision (approved/rejected/eligible/ineligible)
 * — see the Milestone 15E migration's CRITICAL BOUNDARY header comment.
 * does_not_meet_basic_criteria is an INTERNAL preliminary recommendation
 * for human review, not a final rejection; nothing in this codebase
 * transitions an Application's own status based on this value.
 *
 * Strict precedence, evaluated in this exact order:
 *   A. zero criterion results at all (no active criteria were configured
 *      for this Product) -> missing_configuration
 *   B. any result with outcome "unknown"          -> missing_information
 *   C. else any "fail" result with severity "hard" -> does_not_meet_basic_criteria
 *   D. else any "fail" result with severity "soft" -> manual_review_required
 *   E. else                                         -> ready_for_review
 *
 * "informational" severity failures are visible in criterionResults but
 * never independently drive B-D — they can only ever surface via ready_
 * for_review (E) unless another hard/soft/unknown result also exists.
 */
export function aggregateRecommendation(criterionResults: readonly CriterionEvaluation[]): PreliminaryRecommendation {
  if (criterionResults.length === 0) return "missing_configuration";
  if (criterionResults.some((result) => result.outcome === "unknown")) return "missing_information";
  if (criterionResults.some((result) => result.outcome === "fail" && result.severity === "hard")) {
    return "does_not_meet_basic_criteria";
  }
  if (criterionResults.some((result) => result.outcome === "fail" && result.severity === "soft")) {
    return "manual_review_required";
  }
  return "ready_for_review";
}

// ============================================================================
// Document-completeness summary (read-only, optional)
// ============================================================================

export type RequirementSlotCompletenessSummary = Record<RequirementSlotStatus, number> & { total: number };

/** A read-only tally of the Application's own Requirement Slot statuses —
 * NOT a second document-completeness model. Requirement Slot criteria
 * (criterionType "requirement_slot_status") are how Product-specific
 * document completeness enters this engine; this is purely a convenience
 * summary for a caller that wants "12 of 15 slots satisfied" without
 * re-deriving it, computed straight from the same RequirementSlot[] the
 * evaluator already received — nothing here is persisted as a second
 * representation of Slot state. */
export function summarizeRequirementSlotCompleteness(slots: readonly RequirementSlot[]): RequirementSlotCompletenessSummary {
  const summary = REQUIREMENT_SLOT_STATUS_ORDER.reduce(
    (accumulator, status) => ({ ...accumulator, [status]: 0 }),
    {} as Record<RequirementSlotStatus, number>
  );
  for (const slot of slots) {
    summary[slot.status] += 1;
  }
  return { ...summary, total: slots.length };
}
