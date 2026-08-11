import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { AutomationEvent, AutomationEventType } from "@/types";

/**
 * Server-only service for the append-only automation audit trail
 * (Milestone 15B — see the Milestone 15A architecture review's
 * "Automation Audit-Trail Design" section). Deliberately exposes a
 * single write function and no update/delete function at all — every
 * row is an immutable fact about something the automated pipeline did,
 * matching the table's own grant posture
 * (supabase/migrations/20260811000200_create_automation_events_table.sql
 * grants select+insert to service_role only, never update or delete).
 *
 * SECURITY CONTRACT — payload: same discipline as
 * ApplicationIntake.rawPayload (see application-intakes.ts). Callers
 * MUST NEVER pass secrets, API keys, webhook signatures, or
 * authorization headers into it.
 */

interface AutomationEventRow {
  id: string;
  event_type: string;
  intake_id: string | null;
  client_id: string | null;
  application_id: string | null;
  task_id: string | null;
  payload: Record<string, unknown>;
  actor: string;
  created_at: string;
}

const AUTOMATION_EVENT_SELECT =
  "id, event_type, intake_id, client_id, application_id, task_id, payload, actor, created_at";

function toAutomationEvent(row: AutomationEventRow): AutomationEvent {
  return {
    id: row.id,
    eventType: row.event_type as AutomationEventType,
    intakeId: row.intake_id ?? undefined,
    clientId: row.client_id ?? undefined,
    applicationId: row.application_id ?? undefined,
    taskId: row.task_id ?? undefined,
    payload: row.payload ?? {},
    actor: row.actor,
    createdAt: row.created_at,
  };
}

export interface RecordAutomationEventInput {
  eventType: AutomationEventType;
  intakeId?: string;
  clientId?: string;
  applicationId?: string;
  /** Event-specific structured detail. MUST NEVER contain secrets, API
   * keys, webhook signatures, or authorization headers — see this
   * module's doc comment. */
  payload?: Record<string, unknown>;
  /** "system" for every event Milestone 15B's automated pipeline
   * writes — see AutomationEvent.actor. */
  actor: string;
}

export type RecordAutomationEventResult =
  | { status: "ok"; event: AutomationEvent }
  | { status: "error" };

/**
 * Appends one immutable automation-event row. Never throws on its own
 * failure to write — logs and returns an error result instead, so a
 * failure to record an audit-trail entry never aborts the pipeline
 * action it was documenting (the pipeline's own success/failure is
 * governed entirely by application_intakes'/applications' own state,
 * not by this table).
 */
export async function recordAutomationEvent(
  input: RecordAutomationEventInput
): Promise<RecordAutomationEventResult> {
  try {
    const supabase = getSupabaseServerClient();

    const { data, error } = await supabase
      .from("automation_events")
      .insert({
        event_type: input.eventType,
        intake_id: input.intakeId ?? null,
        client_id: input.clientId ?? null,
        application_id: input.applicationId ?? null,
        payload: input.payload ?? {},
        actor: input.actor,
      })
      .select(AUTOMATION_EVENT_SELECT)
      .single<AutomationEventRow>();

    if (error || !data) {
      console.error(
        "[automation-events service] Failed to record event:",
        error?.message ?? "no row returned"
      );
      return { status: "error" };
    }

    return { status: "ok", event: toAutomationEvent(data) };
  } catch (error) {
    console.error(
      "[automation-events service] Unexpected failure recording event:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

export type GetAutomationEventsForIntakeResult =
  | { status: "ok"; events: AutomationEvent[] }
  | { status: "error" };

/** Loads every event for one intake, oldest first — the shape a future
 * staff-facing "what did automation do to this intake" view will need.
 * No general-purpose listing/filtering beyond this: nothing in this
 * milestone consumes one, and this table has no UI yet. */
export async function getAutomationEventsForIntake(
  intakeId: string
): Promise<GetAutomationEventsForIntakeResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("automation_events")
      .select(AUTOMATION_EVENT_SELECT)
      .eq("intake_id", intakeId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[automation-events service] Failed to load events for intake:", error.message);
      return { status: "error" };
    }

    const rows = (data ?? []) as unknown as AutomationEventRow[];
    return { status: "ok", events: rows.map(toAutomationEvent) };
  } catch (error) {
    console.error(
      "[automation-events service] Unexpected failure loading events for intake:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}
