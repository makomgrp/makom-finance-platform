/**
 * ============================================================================
 * MILESTONE 26B-10 — WHAT A REVIEWER IS ASKED TO CHECK
 * ============================================================================
 *
 * The checklist catalogue. Sections and item CODES live here; their wording
 * lives in the message files, because the same item has to read correctly in
 * Spanish and English and a label is not an identity.
 *
 * ----------------------------------------------------------------------------
 * A CONSTANT, NOT A TEMPLATE TABLE
 * ----------------------------------------------------------------------------
 * The project already has a template architecture — `requirement_templates` —
 * but it models DOCUMENTS a customer must supply, per product, with file counts
 * and evidence. A review item is a different thing: a question staff answer
 * about work they did. Bending that table to carry both would give every
 * checklist item a `min_files` and an `applicant_visible` flag that mean
 * nothing, and would put reviewer questions in the customer's document
 * requirements.
 *
 * Building a SECOND configurable template engine for twenty fixed questions
 * would be the other mistake. ODL's review questions are not per-product and
 * nobody has asked to edit them at runtime; a constant is the smallest thing
 * that works, and promoting it to a table later is a migration, not a rewrite.
 *
 * ----------------------------------------------------------------------------
 * CODES ARE PERMANENT, ORDER AND WORDING ARE NOT
 * ----------------------------------------------------------------------------
 * Stored rows reference `code`. Reordering this array, rewording a label or
 * adding an item leaves every conclusion a reviewer already recorded intact.
 * Renaming a code would not — so codes are append-only in practice, and an
 * item that stops being relevant is removed from this list while its historical
 * rows keep their meaning.
 *
 * ----------------------------------------------------------------------------
 * `requiredForCompletion` IS NOT A WEIGHT
 * ----------------------------------------------------------------------------
 * It marks items that must not still be `pending` when somebody clicks Complete
 * — nothing more. There is no score, no threshold and no arithmetic anywhere in
 * this milestone: an item marked `not_applicable` satisfies completion exactly
 * as `verified` does, because "this product has no payroll deduction" is a real
 * answer and forcing a false tick would be worse than leaving it out.
 */

export const REVIEW_SECTIONS = [
  "identification",
  "employment",
  "income",
  "documentation",
  "compliance",
] as const;

export type ReviewSection = (typeof REVIEW_SECTIONS)[number];

export type ReviewItemState = "pending" | "verified" | "issue" | "not_applicable";

export const REVIEW_ITEM_STATES = [
  "pending",
  "verified",
  "issue",
  "not_applicable",
] as const satisfies readonly ReviewItemState[];

export interface ReviewItemDefinition {
  code: string;
  section: ReviewSection;
  /** Must not be left `pending` to complete the review. See the header. */
  requiredForCompletion: boolean;
}

export const REVIEW_ITEMS: readonly ReviewItemDefinition[] = [
  // --- Identification -----------------------------------------------------
  { code: "identity_document_received", section: "identification", requiredForCompletion: true },
  { code: "identity_document_reviewed", section: "identification", requiredForCompletion: true },
  { code: "identity_matches_application", section: "identification", requiredForCompletion: true },
  { code: "identity_manually_verified", section: "identification", requiredForCompletion: true },

  // --- Employment ---------------------------------------------------------
  { code: "employment_information_provided", section: "employment", requiredForCompletion: true },
  { code: "employer_reviewed", section: "employment", requiredForCompletion: true },
  { code: "job_title_reviewed", section: "employment", requiredForCompletion: true },
  // "when required" / "when applicable" in the brief — these are the items a
  // reviewer legitimately marks not_applicable rather than verifying.
  { code: "employment_letter_reviewed", section: "employment", requiredForCompletion: false },
  { code: "direct_deduction_reviewed", section: "employment", requiredForCompletion: false },

  // --- Income -------------------------------------------------------------
  { code: "income_information_provided", section: "income", requiredForCompletion: true },
  { code: "proof_of_income_received", section: "income", requiredForCompletion: true },
  { code: "proof_of_income_reviewed", section: "income", requiredForCompletion: true },
  { code: "declared_income_consistent", section: "income", requiredForCompletion: true },

  // --- Documentation ------------------------------------------------------
  { code: "required_documents_complete", section: "documentation", requiredForCompletion: true },
  { code: "required_documents_reviewed", section: "documentation", requiredForCompletion: true },
  { code: "no_unresolved_document_observations", section: "documentation", requiredForCompletion: true },

  // --- Compliance ---------------------------------------------------------
  // MANUAL ONLY. Each of these records that a PERSON did something. None of
  // them is produced by a lookup, and nothing in this codebase screens anyone
  // against any list — a ticked box here is a staff member's statement, not a
  // claim that ODL ran regulatory screening.
  { code: "compliance_review_performed", section: "compliance", requiredForCompletion: true },
  { code: "pep_status_manually_reviewed", section: "compliance", requiredForCompletion: false },
  { code: "compliance_observations_recorded", section: "compliance", requiredForCompletion: false },
  { code: "additional_verification_required", section: "compliance", requiredForCompletion: false },
] as const;

export const REVIEW_OBSERVATION_CATEGORIES = [
  "general",
  "identity",
  "employment",
  "income",
  "documents",
  "compliance",
] as const;

export type ReviewObservationCategory = (typeof REVIEW_OBSERVATION_CATEGORIES)[number];

export type ReviewRecommendation =
  | "pending"
  | "recommend_approval"
  | "recommend_rejection"
  | "needs_more_information"
  | "escalate";

export const REVIEW_RECOMMENDATIONS = [
  "pending",
  "recommend_approval",
  "recommend_rejection",
  "needs_more_information",
  "escalate",
] as const satisfies readonly ReviewRecommendation[];

/**
 * The three that cannot be recorded without an explanation.
 *
 * Each one hands work or a refusal to somebody else, and an unexplained one is
 * an instruction with no reason attached. Mirrored by a CHECK constraint, so
 * this list is the UI's copy of the rule rather than the rule itself.
 */
export const RECOMMENDATIONS_REQUIRING_NOTE: readonly ReviewRecommendation[] = [
  "recommend_rejection",
  "needs_more_information",
  "escalate",
] as const;

export function recommendationRequiresNote(value: ReviewRecommendation): boolean {
  return RECOMMENDATIONS_REQUIRING_NOTE.includes(value);
}

/** Item codes that must not be `pending` before a review can be completed. */
export const REQUIRED_ITEM_CODES: readonly string[] = REVIEW_ITEMS.filter(
  (item) => item.requiredForCompletion
).map((item) => item.code);
