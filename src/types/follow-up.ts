/**
 * ============================================================================
 * OPERATIONAL FOLLOW-UP (26B-6)
 * ============================================================================
 *
 * What ODL is DOING about a customer — kept strictly apart from how far that
 * customer has got in the portal.
 *
 * The two answer different questions and must never be conflated: calling Juan
 * does not move him to Paso 3, and reaching Paso 3 does not mean anyone has
 * spoken to him. Only the customer's own portal actions move the pipeline; only
 * staff actions appear here.
 */

/** How the contact was made. Recorded after the fact — nothing is sent. */
export type ContactMethod = "call" | "whatsapp" | "email" | "other";

/**
 * What happened.
 *
 * A deliberately short list of CONTACT OUTCOMES, not pipeline stages. It says
 * how the conversation went, and has no bearing on the customer's progress.
 */
export type ContactOutcome =
  | "contacted"
  | "no_answer"
  | "customer_responded"
  | "waiting_customer"
  | "follow_up_scheduled"
  | "other";

/** One recorded contact attempt, and optionally the next one promised. */
export interface ApplicationFollowUp {
  id: string;
  applicationId: string;
  authorProfileId: string;
  /** Resolved server-side from profiles — never guessed client-side. */
  authorFullName?: string;
  /** When the contact happened, which is not when it was typed in. */
  contactedAt: string;
  contactMethod: ContactMethod;
  outcome: ContactOutcome;
  note?: string;

  /** Both present or both absent — enforced by a CHECK constraint. */
  nextAction?: string;
  nextActionAt?: string;

  completedAt?: string;
  completedByProfileId?: string;
  completedByFullName?: string;
  createdAt: string;
}

/**
 * Where a pending action stands against the reader's clock.
 *
 * DERIVED AT READ TIME, never stored. A stored "overdue" flag is wrong from the
 * moment it is written — the row does not change when midnight passes, but the
 * answer does.
 */
export type NextActionUrgency = "overdue" | "today" | "upcoming";

/** The follow-up state of one process, as the board and dossier need it. */
export interface FollowUpSummary {
  applicationId: string;
  /** The most recent contact, whatever its outcome. Absent if never contacted. */
  lastContactAt?: string;
  lastContactMethod?: ContactMethod;
  lastContactOutcome?: ContactOutcome;

  /**
   * The oldest still-outstanding commitment.
   *
   * Oldest rather than newest: if two actions are pending, the one that came
   * due first is the one someone is late on, and that is what a work queue must
   * surface.
   */
  nextAction?: string;
  nextActionAt?: string;
  nextActionFollowUpId?: string;
  nextActionUrgency?: NextActionUrgency;
}
