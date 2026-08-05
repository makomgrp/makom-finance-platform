import type { AlertLevel, AlertType } from "@/types";

export const ALERT_TYPE_VALUES: AlertType[] = [
  "documento_inconsistente",
  "informacion_pendiente",
  "solicitud_duplicada",
  "incumplimiento_previo",
  "comportamiento_inapropiado",
  "posible_fraude",
  "revision_especial",
  "restriccion_interna",
];

export const ALERT_LEVEL_BADGE_CLASS: Record<AlertLevel, string> = {
  bajo: "bg-secondary text-secondary-foreground border-border",
  medio: "bg-warning/10 text-warning border-warning/20",
  alto: "bg-destructive/10 text-destructive border-destructive/20",
  critico: "bg-destructive text-white border-destructive",
};

export const ALERT_LEVEL_VALUES: AlertLevel[] = ["bajo", "medio", "alto", "critico"];
