import type { ClientAlert } from "@/types";

export const ALERTS: ClientAlert[] = [
  {
    id: "alert-001",
    clientId: "cl-005",
    type: "incumplimiento_previo",
    level: "alto",
    reason: "Incumplimiento reportado en una entidad relacionada",
    observation:
      "Se identificó un atraso prolongado en un compromiso anterior. Se solicita revisión antes de continuar con la solicitud.",
    date: "2026-07-20T10:35:00-05:00",
    responsibleUserId: "u-005",
    active: true,
  },
  {
    id: "alert-002",
    clientId: "cl-013",
    type: "restriccion_interna",
    level: "critico",
    reason: "Reincidencia de atrasos con otra entidad financiera",
    observation: "Verificar referencias adicionales antes de reactivar cualquier trámite con este cliente.",
    date: "2026-03-11T09:00:00-05:00",
    responsibleUserId: "u-006",
    active: true,
  },
  {
    id: "alert-003",
    clientId: "cl-003",
    type: "informacion_pendiente",
    level: "bajo",
    reason: "Datos de contacto sin confirmar",
    observation: "El número de teléfono secundario no ha sido validado.",
    date: "2026-07-05T09:30:00-05:00",
    responsibleUserId: "u-004",
    active: true,
  },
  {
    id: "alert-004",
    clientId: "cl-010",
    type: "informacion_pendiente",
    level: "medio",
    reason: "Cliente sin respuesta a contactos recientes",
    observation: "Dos intentos de contacto sin respuesta. Se mantiene en observación.",
    date: "2026-06-01T10:05:00-05:00",
    responsibleUserId: "u-006",
    active: true,
  },
  {
    id: "alert-005",
    clientId: "cl-007",
    type: "documento_inconsistente",
    level: "medio",
    reason: "Carta de trabajo con fecha ilegible",
    observation: "Se solicitó una copia más clara del documento; quedó resuelto al recibir el reemplazo.",
    date: "2026-06-28T09:20:00-05:00",
    responsibleUserId: "u-006",
    active: false,
  },
  {
    id: "alert-006",
    clientId: "cl-016",
    type: "documento_inconsistente",
    level: "medio",
    reason: "Recibo de servicios a nombre de un tercero",
    observation: "Se solicitó documento actualizado a nombre del solicitante.",
    date: "2026-07-31T14:10:00-05:00",
    responsibleUserId: "u-006",
    active: true,
  },
  {
    id: "alert-007",
    clientId: "cl-012",
    type: "revision_especial",
    level: "bajo",
    reason: "Ingresos variables reportados",
    observation: "Cliente recibe comisiones variables; se solicitó promedio de los últimos 6 meses.",
    date: "2026-07-10T08:40:00-05:00",
    responsibleUserId: "u-004",
    active: false,
  },
  {
    id: "alert-008",
    clientId: "cl-011",
    type: "solicitud_duplicada",
    level: "bajo",
    reason: "Posible solicitud previa con datos similares",
    observation: "Se verificó que corresponde a una solicitud distinta; no requiere acción adicional.",
    date: "2026-07-22T09:15:00-05:00",
    responsibleUserId: "u-005",
    active: false,
  },
];

export function getAlertsByClientId(clientId: string): ClientAlert[] {
  return ALERTS.filter((alert) => alert.clientId === clientId).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

export function getActiveAlerts(): ClientAlert[] {
  return ALERTS.filter((alert) => alert.active);
}
