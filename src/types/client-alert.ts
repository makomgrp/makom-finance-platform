export type AlertType =
  | "documento_inconsistente"
  | "informacion_pendiente"
  | "solicitud_duplicada"
  | "incumplimiento_previo"
  | "comportamiento_inapropiado"
  | "posible_fraude"
  | "revision_especial"
  | "restriccion_interna";

export type AlertLevel = "bajo" | "medio" | "alto" | "critico";

export interface ClientAlert {
  id: string;
  clientId: string;
  type: AlertType;
  level: AlertLevel;
  reason: string;
  observation?: string;
  date: string;
  responsibleUserId: string;
  active: boolean;
}
