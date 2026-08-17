import type { ApplicationSource } from "@/types/application";

/**
 * ============================================================================
 * THE CRM AUDIT TRAIL (Milestone 20)
 * ============================================================================
 *
 * One row per state transition whose history the business tables themselves
 * overwrite. See supabase/migrations/20260817120000_milestone_20_crm_audit_
 * trail.sql for the full reasoning; the essentials:
 *
 *   - `crm_events` is APPEND-ONLY. service_role holds SELECT and nothing else
 *     — not even INSERT. The only writers are five SECURITY DEFINER functions
 *     that perform the business mutation and the event append in ONE
 *     transaction, so an event can never be lost after the state already
 *     changed. There is deliberately no createCrmEvent(), updateCrmEvent() or
 *     deleteCrmEvent() anywhere in this codebase.
 *
 *   - Facts that already have their own immutable row are NOT recorded here:
 *     client/application creation, notes, alerts raised, evidence uploaded /
 *     replaced / reviewed, analyses, chat messages. Duplicating them would
 *     create a second source of truth and render each occurrence twice in the
 *     Dossier Activity feed.
 *
 *   - NEVER BACKFILLED. History starts at deployment. Transitions that were
 *     overwritten before then are gone and must not be reconstructed.
 *
 *   - This is NOT automation_events, which stays intake-pipeline telemetry.
 */

/**
 * Closed vocabulary, mirrored exactly by crm_events_event_type_check.
 *
 * The last two are RESERVED, not written: `assignApplicationAdvisor` and
 * `setClientRestricted` have no Server Action and no UI caller today, and
 * auditing an unreachable function would be premature. They live in the CHECK
 * so wiring them later needs no constraint change.
 */
export type CrmEventType =
  | "application_status_changed"
  | "requirement_status_changed"
  | "alert_resolved"
  | "alert_reactivated"
  | "client_status_changed"
  | "client_profile_updated"
  /** Reserved — not written in Milestone 20. */
  | "application_advisor_assigned"
  /** Reserved — not written in Milestone 20. */
  | "client_restriction_changed";

/** Which table the event is about. */
export type CrmEntityType = "application" | "requirement_slot" | "dossier_alert" | "client";

/**
 * Two values, because the architecture supports exactly two. `automation` and
 * `public_intake` are deliberately absent — nothing writes them, and the
 * inbound channel is already fully described by `source`.
 */
export type CrmActorKind = "human" | "system";

export interface CrmEvent {
  id: string;
  eventType: CrmEventType;
  entityType: CrmEntityType;
  /** The subject row. Deliberately unconstrained at the database level so an
   * event outlives its subject. */
  entityId: string;
  /** Nulled if the client is ever deleted — the event itself survives. */
  clientId?: string;
  applicationId?: string;
  actorProfileId?: string;
  /** Resolved server-side (joined from profiles) — never guessed
   * client-side. Undefined exactly when actorProfileId is. */
  actorFullName?: string;
  actorKind: CrmActorKind;
  source: ApplicationSource;
  /**
   * MINIMAL transition value only — `{ status: "in_review" }` — never a full
   * row snapshot.
   *
   * For `client_profile_updated` this is `{ fields: [...] }`: the NAMES of the
   * changed fields and nothing else. Client PII is never written to this
   * table, because it is append-only with no delete path — a personal value
   * copied in could never be corrected or erased.
   */
  previousValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  occurredAt: string;
}
