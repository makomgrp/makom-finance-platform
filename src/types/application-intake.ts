import type { ApplicationSource } from "./application";
import type { IdentificationType } from "./client";
import type { PortalStep } from "./portal-continuation";

/**
 * The Application Intake pipeline's own lifecycle (Milestone 15B — see
 * the Milestone 15A architecture review's "Proposed Canonical Intake
 * Pipeline" section). Deliberately the smallest correct model for this
 * milestone: `documents_pending` (Milestone 15D's concern) and
 * `rejected` (requires a staff-review UI this milestone does not build)
 * are both intentionally absent — see the application_intakes table
 * migration's header comment for the full reasoning. Legal transitions:
 *   received       -> client_matched | needs_review
 *   client_matched -> processed | needs_review
 * (processed and needs_review are terminal within this milestone's scope)
 */
export type ApplicationIntakeStatus = "received" | "client_matched" | "needs_review" | "processed";

/**
 * Closed, machine-readable vocabulary explaining exactly why an intake
 * could not proceed automatically — populated only when status =
 * 'needs_review'. See src/lib/services/client-matching.ts (the
 * conflicting/low-confidence reasons) and
 * src/lib/services/application-intake-processing.ts (every other
 * reason) for which code path produces which value.
 */
export type ApplicationIntakeReviewReason =
  | "conflicting_client_identity"
  | "low_confidence_client_match"
  | "insufficient_client_data"
  | "product_not_found"
  | "product_inactive"
  | "missing_product_code"
  | "missing_requested_amount"
  | "missing_requested_term_months";

/**
 * One inbound application-intake signal, from any channel (Milestone
 * 15B, extended by its correction to carry every field
 * src/lib/services/clients.ts#createClient requires). Every
 * applicant/request field is nullable — a channel may supply only a
 * subset (e.g. an initial WhatsApp contact with no identity information
 * yet), and nothing here is ever fabricated to fill a gap. When every
 * field createClient requires is present and valid, the processing
 * pipeline creates a real Client automatically; when any is missing, it
 * routes the intake to needs_review(insufficient_client_data) instead —
 * see src/lib/services/application-intake-processing.ts.
 */
export interface ApplicationIntake {
  id: string;
  /** The exact same vocabulary as ApplicationSource — deliberately
   * reused, not redefined. */
  channel: ApplicationSource;
  /** Channel-supplied idempotency key. Undefined for CRM-manual/internal
   * intake, which has no external identifier to preserve. */
  submissionId?: string;
  status: ApplicationIntakeStatus;
  /** Exactly what the originating channel supplied, for audit/replay.
   * MUST NEVER contain secrets, API keys, webhook signatures, or
   * authorization headers — see src/lib/services/application-intakes.ts. */
  rawPayload: Record<string, unknown>;
  applicantFullName?: string;
  applicantIdentificationType?: IdentificationType;
  applicantIdentificationNumber?: string;
  applicantEmail?: string;
  applicantPhone?: string;
  /** Same field as Client.birthDate. Required (with every other
   * applicant* field below plus identification/email/phone above) for
   * processApplicationIntake to auto-create a new Client — see
   * src/lib/services/application-intake-processing.ts. */
  applicantBirthDate?: string;
  /** Same field as Client.nationality. */
  applicantNationality?: string;
  /** Same field as Client.address. */
  applicantAddress?: string;
  /** Same field as Client.position. */
  applicantPosition?: string;
  requestedProductCode?: string;
  requestedAmount?: number;
  requestedTermMonths?: number;
  employerName?: string;
  monthlySalary?: number;
  /** The real Client this intake was resolved to, once matching
   * succeeds. Undefined until then. */
  matchedClientId?: string;
  /** The real Application this intake produced, once processing
   * succeeds. Undefined until status === "processed". */
  createdApplicationId?: string;
  /** Populated only when status === "needs_review". */
  reviewReason?: ApplicationIntakeReviewReason;
  receivedAt: string;
  processedAt?: string;

  /**
   * MILESTONE 26A-4 — THE DRAFT LIFECYCLE.
   *
   * These describe the CUSTOMER's journey through the portal and are
   * deliberately separate from `status`, which describes what the intake
   * ENGINE did with this lead. A lead can be `needs_review` for the engine
   * while the customer is happily working through Step 2; merging the two
   * would force one of those facts to overwrite the other.
   */

  /**
   * Where the customer last was. A BOOKMARK, NOT AUTHORITY — resume routing
   * derives the real target from actual completion state
   * (src/lib/services/portal-progress.ts), so a customer whose earlier answer
   * stopped being valid is sent back to fix it rather than forward past it.
   */
  currentStep: PortalStep;
  /**
   * Last time the customer CHANGED something. Reads never touch it, so it
   * means "progress happened" rather than "a link was opened" — the token's
   * own `lastUsedAt` records the latter.
   */
  lastActivityAt: string;
  /** Set on final submission. Undefined means still a draft. */
  submittedAt?: string;
}
