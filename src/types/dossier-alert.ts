import type { AlertLevel, AlertType } from "./client-alert";

/**
 * The real, Supabase-backed alert shown in the dossier Alerts tab —
 * separate from ClientAlert, which stays the demo-data shape still used
 * by the standalone /alertas module and the Topbar badge until Milestone
 * 7B migrates those too. Keeping them separate means this migration
 * never has to touch alerts-table.tsx, alerts-summary.tsx, or topbar.tsx.
 */
export interface DossierAlert {
  id: string;
  /** The real Client this alert is attached to (a real clients.id uuid as
   * of Milestone 14E). */
  clientId: string;
  type: AlertType;
  level: AlertLevel;
  reason: string;
  observation?: string;
  createdAt: string;
  createdByProfileId: string;
  /** Resolved server-side (joined from profiles) — never guessed client-side. */
  createdByFullName: string;
  active: boolean;
  /** Describes the CURRENT resolution episode — cleared on reactivation, not a permanent history. */
  resolvedAt?: string;
  resolvedByProfileId?: string;
  resolvedByFullName?: string;
}

/**
 * `DossierAlert` plus its resolved Client name (Milestone 14E — the
 * standalone /alertas table's data source; see src/lib/services/alerts.ts
 * #getAllAlerts). A thin, additive extension, not a separate read model —
 * mirrors ApplicationListItem's exact relationship to Application.
 */
export interface DossierAlertListItem extends DossierAlert {
  /** Resolved server-side (joined from clients) — never guessed
   * client-side. Always populated: clientId is NOT NULL. */
  clientFullName: string;
}
