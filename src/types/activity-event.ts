export type ActivityType =
  | "cliente_creado"
  | "solicitud_iniciada"
  | "documento_recibido"
  | "nota_agregada"
  | "estado_modificado"
  | "alerta_registrada"
  | "documento_verificado"
  | "solicitud_aprobada";

export interface ActivityEvent {
  id: string;
  clientId: string;
  applicationId?: string;
  type: ActivityType;
  descriptionKey: string;
  params?: Record<string, string>;
  date: string;
  userId?: string;
}
