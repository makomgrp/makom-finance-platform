import type { ClientStatus, RealClientStatus } from "@/types";

export const CLIENT_STATUS_BADGE_CLASS: Record<ClientStatus, string> = {
  activo: "bg-success/10 text-success border-success/20",
  prospecto: "bg-secondary text-secondary-foreground border-border",
  en_evaluacion: "bg-warning/10 text-warning border-warning/20",
  aprobado: "bg-success/10 text-success border-success/20",
  restringido: "bg-destructive/10 text-destructive border-destructive/20",
  inactivo: "bg-muted text-muted-foreground border-border",
};

export const CLIENT_STATUS_VALUES: ClientStatus[] = [
  "activo",
  "prospecto",
  "en_evaluacion",
  "aprobado",
  "restringido",
  "inactivo",
];

/**
 * Milestone 14B — added ahead of the UI that will consume it (mirrors
 * src/lib/config/application.ts's APPLICATION_STATUS_ORDER precedent).
 * The sole legal-value list for RealClient.status, used by
 * setClientStatus's server-side validation. No UI reads this yet.
 */
export const REAL_CLIENT_STATUS_VALUES: RealClientStatus[] = ["prospecto", "activo", "inactivo"];
