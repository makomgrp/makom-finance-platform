import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ApplicationSource,
  CrmActorKind,
  CrmEntityType,
  CrmEvent,
  CrmEventType,
} from "@/types";

/**
 * Server-only READER for the CRM audit trail (Milestone 20).
 *
 * READ-ONLY BY CONSTRUCTION, not by convention. This module exposes no
 * create/update/delete function and never will: `crm_events` grants
 * service_role SELECT and nothing else — not even INSERT — so a write from
 * here would fail at the database anyway. Events are appended exclusively by
 * the five SECURITY DEFINER functions, inside the same transaction as the
 * business mutation they describe (see the migration's header for why an
 * application-layer append could not be atomic over PostgREST).
 *
 * If you are here to add a write, the answer is a new RPC, not a new function
 * in this file.
 */

interface CrmEventRow {
  id: string;
  event_type: string;
  entity_type: string;
  entity_id: string;
  client_id: string | null;
  application_id: string | null;
  actor_profile_id: string | null;
  actor_kind: string;
  source: string;
  previous_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  occurred_at: string;
  actor: { full_name: string } | null;
}

// Same !constraint embed idiom used throughout this app — actor_profile_id is
// independently nullable, so the embed resolves to null for system events
// rather than failing.
const CRM_EVENT_SELECT =
  "id, event_type, entity_type, entity_id, client_id, application_id, actor_profile_id, actor_kind, source, previous_value, new_value, occurred_at, " +
  "actor:profiles!crm_events_actor_profile_id_fkey(full_name)";

function toCrmEvent(row: CrmEventRow): CrmEvent {
  return {
    id: row.id,
    eventType: row.event_type as CrmEventType,
    entityType: row.entity_type as CrmEntityType,
    entityId: row.entity_id,
    clientId: row.client_id ?? undefined,
    applicationId: row.application_id ?? undefined,
    actorProfileId: row.actor_profile_id ?? undefined,
    actorFullName: row.actor?.full_name ?? undefined,
    actorKind: row.actor_kind as CrmActorKind,
    source: row.source as ApplicationSource,
    previousValue: row.previous_value ?? undefined,
    newValue: row.new_value ?? undefined,
    occurredAt: row.occurred_at,
  };
}

export type GetClientCrmEventsResult = { status: "ok"; events: CrmEvent[] } | { status: "error" };

/**
 * Every audit event for one client, newest first — the Dossier Activity feed's
 * only audit-trail read.
 *
 * ONE QUERY, NO N+1. Events for the client's applications, requirement slots
 * and alerts all carry a denormalised client_id precisely so this never has to
 * fan out per application. Served by crm_events_client_id_occurred_at_idx.
 *
 * Milestone 20 accepts that this is the FIRST additional dossier query since
 * Milestone 19 — the Activity feed's "zero extra queries" property could not
 * survive events living in their own table, and pretending otherwise would
 * have meant not having an audit trail.
 */
export async function getClientCrmEvents(clientId: string): Promise<GetClientCrmEventsResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("crm_events")
      .select(CRM_EVENT_SELECT)
      .eq("client_id", clientId)
      .order("occurred_at", { ascending: false });

    if (error) {
      console.error("[crm-events service] Failed to load client CRM events:", error.message);
      return { status: "error" };
    }

    const rows = (data ?? []) as unknown as CrmEventRow[];
    return { status: "ok", events: rows.map(toCrmEvent) };
  } catch (error) {
    console.error(
      "[crm-events service] Unexpected failure loading client CRM events:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}
