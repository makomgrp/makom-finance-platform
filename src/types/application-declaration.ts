/**
 * ============================================================================
 * DECLARATIONS — WHAT THE APPLICANT ATTESTS TO (26A-4)
 * ============================================================================
 *
 * PEP status, source of funds, and consent to a credit consultation. Three
 * things ODL must be able to prove someone answered, and answered a SPECIFIC
 * WORDING of, on a SPECIFIC DATE.
 *
 * A DECLARATION IS NOT A DOCUMENT. It is structured, queryable data plus an
 * acceptance event. Compliance needs "list every applicant who declared
 * themselves a PEP", which a folder of PDFs cannot answer. These may later
 * GENERATE a signed PDF as supporting evidence; the structured answer stays the
 * source of truth. Nothing here touches the 26A-3 requirement/document model.
 *
 * EVERY RECORD IS IMMUTABLE. A revised answer is a NEW revision, never an edit
 * — enforced in the database by granting service_role SELECT and nothing else,
 * the same way `crm_events` is kept append-only. Changing next year's consent
 * wording therefore cannot rewrite what somebody agreed to this year.
 */

export type DeclarationType =
  | "pep"
  | "source_of_funds"
  | "credit_consultation_consent";

/**
 * Where the acceptance physically happened.
 *
 * A declaration the applicant clicked themselves and one an advisor recorded
 * during a phone call are different evidentiary objects. Collapsing them would
 * destroy the distinction precisely where it matters most.
 */
export type DeclarationAcceptedVia = "portal" | "crm_manual";

/**
 * ⚠️ NOT CONFIRMED ODL COMPLIANCE POLICY.
 *
 * ODL has not supplied an AML source-of-funds category list. This is a
 * deliberately small, generic set chosen so the answer stays QUERYABLE (free
 * text is not), with `other` plus a mandatory description so nobody is forced
 * into a wrong bucket. Widening it later is a one-line forward migration.
 * Treat this list as a placeholder awaiting ODL confirmation, not as approved
 * policy.
 */
export type SourceOfFundsCategory =
  | "salary"
  | "business_income"
  | "savings"
  | "sale_of_asset"
  | "other";

/**
 * One accepted declaration, exactly as it was accepted.
 *
 * `version` records the wording the applicant actually saw. It is the reason
 * this table can be append-only and still make sense years later: the answer
 * and the question it answered travel together.
 */
export interface ApplicationDeclaration {
  id: string;
  applicationId: string;
  declarationType: DeclarationType;
  /** e.g. "pep.v1" — the wording/schema the applicant was shown. */
  version: string;
  /** 1-based, monotonic per (application, type). Highest = current. */
  revision: number;

  /** PEP only. */
  isPep?: boolean;
  /** PEP only, and required when `isPep` is true. */
  pepDetails?: string;

  /** Source of funds only. */
  sourceOfFundsCategory?: SourceOfFundsCategory;
  /** Source of funds only; required when the category is `other`. */
  sourceOfFundsDescription?: string;

  /**
   * Credit consent only.
   *
   * FALSE IS A REAL ANSWER. A customer who declines has answered the question
   * — Step 3 simply does not complete. Recording the refusal is also the only
   * way ODL can later show it never ran a check without permission.
   */
  consentGranted?: boolean;

  /** Supplemental detail with no compliance meaning. If it matters, it earns a column. */
  payload: Record<string, unknown>;

  acceptedAt: string;
  acceptedVia: DeclarationAcceptedVia;
  createdAt: string;
}

/**
 * The current revision of each declaration type for one application.
 *
 * Each is optional because a declaration legitimately does not exist until the
 * applicant reaches it. Absence means "not answered yet", never "declined" —
 * a decline is `consentGranted: false`, which is a stored fact.
 */
export interface ApplicationDeclarationSet {
  applicationId: string;
  pep?: ApplicationDeclaration;
  sourceOfFunds?: ApplicationDeclaration;
  creditConsent?: ApplicationDeclaration;
}

/** The wording versions currently in force. Bump when the text changes. */
export const CURRENT_DECLARATION_VERSIONS: Record<DeclarationType, string> = {
  pep: "pep.v1",
  source_of_funds: "source_of_funds.v1",
  credit_consultation_consent: "credit_consultation_consent.v1",
};
