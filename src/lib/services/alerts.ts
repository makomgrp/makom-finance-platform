import "server-only";
import { cache } from "react";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { AlertLevel, AlertType, DossierAlert, DossierAlertListItem } from "@/types";

/**
 * Server-only service for dossier_alerts (see the Milestone 7 architecture
 * review). Uses the Admin Client, same posture as chat/profiles/notes V1:
 * RLS is enabled on dossier_alerts with zero policies, so this is the only
 * way to read or write it until a real per-client-alert permissions model
 * exists.
 *
 * Milestone 7B: this is now the single source of truth for every alerts
 * surface — the dossier Alerts tab (getAlertsByClientId), the standalone
 * /alertas table and summary (getAllAlerts), and the Topbar badge
 * (getActiveAlertsCount). None of them read demo alert data anymore.
 *
 * client_id is a real, FK-constrained clients.id uuid as of Milestone
 * 14E — see the Milestone 14E implementation report. The Server Action
 * layer (src/app/(app)/expedientes/actions.ts) still validates it against
 * the real Client Engine before calling createAlert, matching the same
 * "never trust client-supplied identity blindly" discipline this app has
 * always applied, just against the real clients table now instead of the
 * demo client list.
 */

interface DossierAlertRow {
  id: string;
  client_id: string;
  created_by_profile_id: string;
  type: string;
  level: string;
  reason: string;
  observation: string | null;
  active: boolean;
  created_at: string;
  resolved_at: string | null;
  resolved_by_profile_id: string | null;
  created_by: { full_name: string } | null;
  resolved_by: { full_name: string } | null;
}

// Two foreign keys to profiles on this table (created_by_profile_id and
// resolved_by_profile_id) — the !constraint_name hints below disambiguate
// which relationship each embed follows. Names are Postgres's own default
// <table>_<column>_fkey convention, not something chosen separately. Bare
// select only — no client name embed — matching src/lib/services/
// applications.ts's APPLICATION_SELECT/APPLICATION_LIST_SELECT split:
// getAlertsByClientId/createAlert/setAlertStatus are never display reads
// across multiple different clients, so none of them need it.
const ALERT_SELECT =
  "id, client_id, created_by_profile_id, type, level, reason, observation, active, created_at, resolved_at, resolved_by_profile_id, " +
  "created_by:profiles!dossier_alerts_created_by_profile_id_fkey(full_name), " +
  "resolved_by:profiles!dossier_alerts_resolved_by_profile_id_fkey(full_name)";

function toDossierAlert(row: DossierAlertRow): DossierAlert {
  return {
    id: row.id,
    clientId: row.client_id,
    type: row.type as AlertType,
    level: row.level as AlertLevel,
    reason: row.reason,
    observation: row.observation ?? undefined,
    createdAt: row.created_at,
    createdByProfileId: row.created_by_profile_id,
    createdByFullName: row.created_by?.full_name ?? "—",
    active: row.active,
    resolvedAt: row.resolved_at ?? undefined,
    resolvedByProfileId: row.resolved_by_profile_id ?? undefined,
    resolvedByFullName: row.resolved_by?.full_name ?? undefined,
  };
}

// getAllAlerts-only row shape (Milestone 14E) — DossierAlertRow plus the
// one embed the standalone /alertas table needs to display and search by
// client name without its own demo-data-style lookup (see the Milestone
// 14E implementation report's Standalone Alerts section). Not used by
// getAlertsByClientId/createAlert/setAlertStatus — none of them are
// display reads across multiple clients, same reasoning
// APPLICATION_LIST_SELECT documents.
interface DossierAlertListRow extends DossierAlertRow {
  client: { full_name: string } | null;
}

const ALERT_LIST_SELECT = `${ALERT_SELECT}, client:clients!dossier_alerts_client_id_fkey(full_name)`;

function toDossierAlertListItem(row: DossierAlertListRow): DossierAlertListItem {
  return {
    ...toDossierAlert(row),
    clientFullName: row.client?.full_name ?? "",
  };
}

export type GetDossierAlertsResult = { status: "ok"; alerts: DossierAlert[] } | { status: "error" };

/**
 * Loads every alert for a client, most recent first. No fallback to demo
 * data on failure — callers get an explicit "error" status, matching
 * src/lib/services/notes.ts's convention.
 */
export async function getAlertsByClientId(clientId: string): Promise<GetDossierAlertsResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("dossier_alerts")
      .select(ALERT_SELECT)
      .eq("client_id", clientId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[alerts service] Failed to load dossier alerts:", error.message);
      return { status: "error" };
    }

    const rows = (data ?? []) as unknown as DossierAlertRow[];
    return { status: "ok", alerts: rows.map(toDossierAlert) };
  } catch (error) {
    console.error(
      "[alerts service] Unexpected failure loading dossier alerts:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

export type GetAllDossierAlertsResult =
  | { status: "ok"; alerts: DossierAlertListItem[] }
  | { status: "error" };

/**
 * Loads every alert across every client, most recent first, with each
 * alert's client name resolved via an embedded join (Milestone 14E — see
 * ALERT_LIST_SELECT above) — the global /alertas table and summary's data
 * source. Wrapped in React's cache() so both components (rendered as
 * siblings under the same /alertas page request) share one actual
 * Supabase query instead of issuing it twice, the same reasoning already
 * applied to getCurrentProfile().
 */
export const getAllAlerts = cache(async (): Promise<GetAllDossierAlertsResult> => {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("dossier_alerts")
      .select(ALERT_LIST_SELECT)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[alerts service] Failed to load all dossier alerts:", error.message);
      return { status: "error" };
    }

    const rows = (data ?? []) as unknown as DossierAlertListRow[];
    return { status: "ok", alerts: rows.map(toDossierAlertListItem) };
  } catch (error) {
    console.error(
      "[alerts service] Unexpected failure loading all dossier alerts:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
});

export interface AlertsSummaryCounts {
  active: number;
  resolved: number;
  byLevel: Record<AlertLevel, number>;
}

export type GetAlertsSummaryResult = { status: "ok"; counts: AlertsSummaryCounts } | { status: "error" };

/**
 * KPI counts for the /alertas summary cards. Derived from the same
 * getAllAlerts() fetch (via the cache() dedup above) rather than a
 * separate query — preserves the exact semantics of the old
 * ALERTS.filter(...).length calculations, just computed over real rows.
 */
export async function getAlertsSummary(): Promise<GetAlertsSummaryResult> {
  const result = await getAllAlerts();
  if (result.status === "error") {
    return { status: "error" };
  }

  const byLevel: Record<AlertLevel, number> = { bajo: 0, medio: 0, alto: 0, critico: 0 };
  let active = 0;
  let resolved = 0;
  for (const alert of result.alerts) {
    if (alert.active) active += 1;
    else resolved += 1;
    byLevel[alert.level] += 1;
  }

  return { status: "ok", counts: { active, resolved, byLevel } };
}

/**
 * Lightweight count-only query for the Topbar badge — deliberately not
 * reusing getAllAlerts() (which fetches full rows with two profile joins);
 * the badge needs only a number. Returns null on failure, never a
 * fabricated 0 — see src/components/layout/topbar.tsx for how that's
 * surfaced (no badge rendered at all, the same visual behavior as a
 * genuine zero, rather than asserting "no active alerts" when the truth is
 * "unknown").
 */
export async function getActiveAlertsCount(): Promise<number | null> {
  try {
    const supabase = getSupabaseServerClient();
    const { count, error } = await supabase
      .from("dossier_alerts")
      .select("id", { count: "exact", head: true })
      .eq("active", true);

    if (error) {
      console.error("[alerts service] Failed to count active dossier alerts:", error.message);
      return null;
    }

    return count ?? 0;
  } catch (error) {
    console.error(
      "[alerts service] Unexpected failure counting active dossier alerts:",
      error instanceof Error ? error.message : "unknown error"
    );
    return null;
  }
}

export interface CreateDossierAlertInput {
  clientId: string;
  createdByProfileId: string;
  type: AlertType;
  level: AlertLevel;
  reason: string;
  observation?: string;
}

/**
 * Inserts one alert, always open (active = true, no resolution metadata —
 * satisfies dossier_alerts_resolution_state_check by construction). Throws
 * on failure — callers (Server Actions) catch and map to a client-facing
 * error result, matching createNote's convention.
 */
export async function createAlert(input: CreateDossierAlertInput): Promise<DossierAlert> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("dossier_alerts")
    .insert({
      client_id: input.clientId,
      created_by_profile_id: input.createdByProfileId,
      type: input.type,
      level: input.level,
      reason: input.reason,
      observation: input.observation ?? null,
    })
    .select(ALERT_SELECT)
    .single<DossierAlertRow>();

  if (error) {
    console.error("[alerts service] Failed to insert dossier alert:", error.message);
    throw new Error("Failed to create the alert.");
  }

  return toDossierAlert(data);
}

/**
 * Sets an alert's open/resolved state via a single atomic, conditional
 * UPDATE — never a blind toggle. The `.neq("active", targetActive)` guard
 * means:
 *   - If the alert is already in the requested state, the UPDATE matches
 *     zero rows (skipped entirely — resolved_at/resolved_by_profile_id are
 *     never touched), and the current row is read back and returned as a
 *     successful no-op, per the idempotency requirement.
 *   - If two concurrent calls race to change the same alert, only the
 *     first's UPDATE actually matches a row; the second sees the guard
 *     already false once the first commits, and falls into the same
 *     no-op path above. No lost update, no double-write, no application-
 *     level locking needed.
 *   - true -> false and false -> true are each written as a single
 *     statement that sets active/resolved_at/resolved_by_profile_id
 *     together, so dossier_alerts_resolution_state_check is never
 *     violated even momentarily.
 *
 * actorProfileId is always the caller's own getCurrentProfile().id — only
 * actually stored when transitioning to resolved; ignored when
 * reactivating (resolved_by_profile_id is cleared to null instead).
 */
export async function setAlertStatus(
  alertId: string,
  targetActive: boolean,
  actorProfileId: string
): Promise<DossierAlert> {
  const supabase = getSupabaseServerClient();

  const { data: updated, error: updateError } = await supabase
    .from("dossier_alerts")
    .update(
      targetActive
        ? { active: true, resolved_at: null, resolved_by_profile_id: null }
        : { active: false, resolved_at: new Date().toISOString(), resolved_by_profile_id: actorProfileId }
    )
    .eq("id", alertId)
    .neq("active", targetActive)
    .select(ALERT_SELECT)
    .maybeSingle<DossierAlertRow>();

  if (updateError) {
    console.error("[alerts service] Failed to update dossier alert status:", updateError.message);
    throw new Error("Failed to update the alert.");
  }

  if (updated) {
    return toDossierAlert(updated);
  }

  // Already in the requested state — read back and return it unchanged.
  const { data: current, error: readError } = await supabase
    .from("dossier_alerts")
    .select(ALERT_SELECT)
    .eq("id", alertId)
    .single<DossierAlertRow>();

  if (readError) {
    console.error(
      "[alerts service] Failed to read dossier alert after no-op status update:",
      readError.message
    );
    throw new Error("Failed to update the alert.");
  }

  return toDossierAlert(current);
}
