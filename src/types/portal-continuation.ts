/**
 * ============================================================================
 * RESUMING AN APPLICATION FROM OUTSIDE THE CRM (26A-4)
 * ============================================================================
 *
 * The types behind "here is a link, come back and finish your application when
 * you have your pay slips". Everything here describes a PUBLIC, UNAUTHENTICATED
 * applicant — never a member of ODL staff — and is deliberately kept away from
 * the internal `BranchScope` / role / capability vocabulary. A continuation
 * token is not a login and must never grow into one.
 */

/**
 * Where the customer stands in the approved portal flow.
 *
 * NAMED FOR THE DOMAIN, NOT FOR SCREENS. "step2" would bind the database to
 * whatever the UI happens to number things next quarter; `financial_data` still
 * means the same thing after a redesign. The mapping to the approved flow:
 *
 *   Step 1  -> "applicant_data" then "loan_selection"
 *   Step 2  -> "financial_data"
 *   Step 3  -> "documents"          (requirements AND declarations)
 *   Review  -> "review"
 *
 * `loan_selection` is its own step because it is the moment the journey stops
 * being a lead and becomes a formal Application with an official ODL number.
 */
export type PortalStep =
  | "applicant_data"
  | "loan_selection"
  | "financial_data"
  | "documents"
  | "review";

/** Flow order. The single place the sequence is written down. */
export const PORTAL_STEP_ORDER: readonly PortalStep[] = [
  "applicant_data",
  "loan_selection",
  "financial_data",
  "documents",
  "review",
] as const;

/** Currently one purpose. See `PublicApplicationToken.purpose`. */
export type PublicApplicationTokenPurpose = "continue";

export type PublicApplicationTokenRevokedReason =
  | "rotated"
  | "submitted"
  | "staff_revoked";

/**
 * A continuation token AS STORED — which is to say, without the token.
 *
 * There is no `token` field here and that is the point: the raw value exists
 * for one function call at issuance and is never persisted, so no read path can
 * return it, log it, or serialise it into a page. What remains is metadata for
 * support and audit.
 */
export interface PublicApplicationToken {
  id: string;
  applicationIntakeId: string;
  purpose: PublicApplicationTokenPurpose;
  expiresAt: string;
  revokedAt?: string;
  revokedReason?: PublicApplicationTokenRevokedReason;
  lastUsedAt?: string;
  useCount: number;
  createdAt: string;
}

/**
 * The one and only moment the raw token is visible.
 *
 * The caller must deliver `token` to the customer (a future milestone's email)
 * and then let it go. It cannot be recovered afterwards — recovering it would
 * mean it had been stored, which is exactly what this design refuses to do.
 */
export interface IssuedContinuationToken {
  /** RAW. Deliver, do not store, do not log. */
  token: string;
  tokenId: string;
  expiresAt: string;
}

/**
 * Why a token did not resolve.
 *
 * `not_found` is what token GUESSING always produces, and it says nothing. The
 * other two are only ever reachable by someone who already holds a real token,
 * for whom "expired" versus "invalid" is the difference between requesting a
 * fresh link and giving up.
 */
export type ContinuationTokenFailure = "not_found" | "expired" | "revoked";

/**
 * What a valid token resolves to: one intake, and the application it produced
 * if it has produced one yet.
 *
 * `applicationId` is legitimately undefined for a lead that has not chosen a
 * product. That is not an error state — it is Step 1 not being finished, and it
 * is exactly why the token binds to the intake rather than the application.
 */
export interface ResolvedContinuation {
  intakeId: string;
  applicationId?: string;
}

/**
 * How far along an application is, derived on every read.
 *
 * NOTHING HERE IS STORED. A cached percentage silently lies the moment a
 * conditional requirement becomes relevant or a reviewer rejects a file; this
 * is recomputed from the requirement slots and declarations that actually
 * exist, so it cannot drift.
 */
export interface PortalProgress {
  /** Steps whose rules are fully satisfied right now. */
  completedSteps: PortalStep[];
  /**
   * Where the customer should be sent. The EARLIEST incomplete step, so a
   * customer whose earlier answer stopped being valid is taken back to fix it
   * rather than forward past it.
   *
   * `undefined` means everything is complete and the application is ready to
   * submit — the submit transition itself belongs to a later milestone.
   */
  firstPendingStep?: PortalStep;
  /** Derived, never stored. 0–100, rounded. */
  percentComplete: number;
}
