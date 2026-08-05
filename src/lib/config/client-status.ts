import type { ClientStatus } from "@/types";

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
