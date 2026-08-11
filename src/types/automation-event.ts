/**
 * The append-only automation audit trail's own event vocabulary
 * (Milestone 15B — see the Milestone 15A architecture review's
 * "Automation Audit-Trail Design" section). Foundation-scoped: only the
 * five event types the Application Intake pipeline itself produces are
 * enabled today. Future milestones (Task Engine, Notifications,
 * Document Analysis) will widen this additively — see the
 * automation_events table migration's own comment.
 */
export type AutomationEventType =
  | "intake_received"
  | "client_matched"
  | "client_created"
  | "application_created"
  | "intake_needs_review";

/**
 * One immutable fact about an automated action the system took. Never
 * updated or deleted after creation — see
 * src/lib/services/automation-events.ts, which exposes no update/delete
 * function for exactly this reason.
 */
export interface AutomationEvent {
  id: string;
  eventType: AutomationEventType;
  intakeId?: string;
  clientId?: string;
  applicationId?: string;
  /** No corresponding Task Engine exists yet (Milestone 15B) — always
   * undefined today. */
  taskId?: string;
  /** Event-specific structured detail. Same security discipline as
   * ApplicationIntake.rawPayload: MUST NEVER contain secrets, API keys,
   * webhook signatures, or authorization headers. */
  payload: Record<string, unknown>;
  /** "system" for every event this milestone's automated pipeline
   * writes. A future manual-reprocessing action may eventually identify
   * a real profile here — not designed in this milestone. */
  actor: string;
  createdAt: string;
}
