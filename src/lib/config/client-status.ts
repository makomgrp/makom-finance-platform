import type { ClientStatus } from "@/types";

/**
 * Milestone 14B — added ahead of the UI that will consume it (mirrors
 * src/lib/config/application.ts's APPLICATION_STATUS_ORDER precedent).
 * The sole legal-value list for Client.status, used by setClientStatus's
 * server-side validation. Milestone 14C is its first UI consumer (the
 * Clientes table's status filter and status-change menu).
 */
export const CLIENT_STATUS_VALUES: ClientStatus[] = ["prospecto", "activo", "inactivo"];

export const CLIENT_STATUS_BADGE_CLASS: Record<ClientStatus, string> = {
  prospecto: "bg-secondary text-secondary-foreground border-border",
  activo: "bg-success/10 text-success border-success/20",
  inactivo: "bg-muted text-muted-foreground border-border",
};
