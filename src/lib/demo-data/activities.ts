import type { ActivityEvent } from "@/types";

export const ACTIVITIES: ActivityEvent[] = [
  // Juan Pérez
  { id: "act-001", clientId: "cl-001", type: "cliente_creado", descriptionKey: "act001", date: "2026-06-02T09:00:00-05:00", userId: "u-004" },
  { id: "act-002", clientId: "cl-001", applicationId: "ap-001", type: "solicitud_iniciada", descriptionKey: "act002", params: { number: "ODL-2026-000101" }, date: "2026-06-03T09:10:00-05:00", userId: "u-004" },
  { id: "act-003", clientId: "cl-001", applicationId: "ap-001", type: "documento_recibido", descriptionKey: "act003", params: { name: "Juan Pérez" }, date: "2026-08-02T14:20:00-05:00", userId: "u-004" },

  // Ana Gómez
  { id: "act-004", clientId: "cl-002", type: "cliente_creado", descriptionKey: "act004", date: "2026-06-10T09:00:00-05:00", userId: "u-005" },
  { id: "act-005", clientId: "cl-002", applicationId: "ap-002", type: "solicitud_iniciada", descriptionKey: "act005", params: { number: "ODL-2026-000102" }, date: "2026-06-11T09:20:00-05:00", userId: "u-005" },
  { id: "act-006", clientId: "cl-002", applicationId: "ap-002", type: "documento_verificado", descriptionKey: "act006", params: { name: "Ana Gómez" }, date: "2026-08-02T16:00:00-05:00", userId: "u-005" },
  { id: "act-007", clientId: "cl-002", applicationId: "ap-002", type: "estado_modificado", descriptionKey: "act007", params: { name: "Ana Gómez" }, date: "2026-08-03T09:10:00-05:00", userId: "u-005" },

  // Carlos Rodríguez
  { id: "act-008", clientId: "cl-003", type: "cliente_creado", descriptionKey: "act008", date: "2026-07-01T09:00:00-05:00", userId: "u-004" },
  { id: "act-009", clientId: "cl-003", applicationId: "ap-003", type: "solicitud_iniciada", descriptionKey: "act009", params: { number: "ODL-2026-000103" }, date: "2026-07-02T09:15:00-05:00", userId: "u-004" },
  { id: "act-010", clientId: "cl-003", applicationId: "ap-003", type: "estado_modificado", descriptionKey: "act010", params: { name: "Carlos Rodríguez" }, date: "2026-08-01T11:00:00-05:00", userId: "u-004" },

  // María López
  { id: "act-011", clientId: "cl-004", type: "cliente_creado", descriptionKey: "act011", date: "2026-05-18T09:00:00-05:00", userId: "u-006" },
  { id: "act-012", clientId: "cl-004", applicationId: "ap-004", type: "solicitud_iniciada", descriptionKey: "act012", params: { number: "ODL-2026-000104" }, date: "2026-05-19T09:20:00-05:00", userId: "u-006" },
  { id: "act-013", clientId: "cl-004", applicationId: "ap-004", type: "documento_verificado", descriptionKey: "act013", params: { name: "María López" }, date: "2026-07-20T10:00:00-05:00", userId: "u-006" },
  { id: "act-014", clientId: "cl-004", applicationId: "ap-004", type: "solicitud_aprobada", descriptionKey: "act014", params: { name: "María López" }, date: "2026-07-28T16:45:00-05:00", userId: "u-006" },

  // Pedro González
  { id: "act-015", clientId: "cl-005", type: "cliente_creado", descriptionKey: "act015", date: "2026-04-27T09:00:00-05:00", userId: "u-005" },
  { id: "act-016", clientId: "cl-005", applicationId: "ap-005", type: "solicitud_iniciada", descriptionKey: "act016", params: { number: "ODL-2026-000105" }, date: "2026-04-28T09:20:00-05:00", userId: "u-005" },
  { id: "act-017", clientId: "cl-005", type: "alerta_registrada", descriptionKey: "act017", params: { name: "Pedro González" }, date: "2026-07-20T10:35:00-05:00", userId: "u-005" },
  { id: "act-018", clientId: "cl-005", applicationId: "ap-005", type: "estado_modificado", descriptionKey: "act018", params: { name: "Pedro González" }, date: "2026-07-20T11:00:00-05:00", userId: "u-005" },

  // Katherine Solís
  { id: "act-019", clientId: "cl-006", type: "cliente_creado", descriptionKey: "act019", date: "2026-07-12T09:00:00-05:00", userId: "u-004" },
  { id: "act-020", clientId: "cl-006", applicationId: "ap-006", type: "solicitud_iniciada", descriptionKey: "act020", params: { number: "ODL-2026-000106" }, date: "2026-07-13T09:20:00-05:00", userId: "u-004" },
  { id: "act-021", clientId: "cl-006", applicationId: "ap-006", type: "documento_recibido", descriptionKey: "act021", params: { name: "Katherine Solís" }, date: "2026-08-03T13:15:00-05:00", userId: "u-004" },
  { id: "act-022", clientId: "cl-006", applicationId: "ap-006", type: "estado_modificado", descriptionKey: "act022", date: "2026-08-03T13:16:00-05:00", userId: "u-004" },

  // Luis Herrera
  { id: "act-023", clientId: "cl-007", type: "cliente_creado", descriptionKey: "act023", date: "2026-06-25T09:00:00-05:00", userId: "u-006" },
  { id: "act-024", clientId: "cl-007", applicationId: "ap-007", type: "solicitud_iniciada", descriptionKey: "act024", params: { number: "ODL-2026-000107" }, date: "2026-06-26T09:20:00-05:00", userId: "u-006" },
  { id: "act-025", clientId: "cl-007", applicationId: "ap-007", type: "documento_verificado", descriptionKey: "act025", params: { name: "Luis Herrera" }, date: "2026-08-02T08:50:00-05:00", userId: "u-006" },

  // Yariela Castillo
  { id: "act-026", clientId: "cl-008", type: "cliente_creado", descriptionKey: "act026", date: "2026-05-30T09:00:00-05:00", userId: "u-005" },
  { id: "act-027", clientId: "cl-008", applicationId: "ap-008", type: "solicitud_iniciada", descriptionKey: "act027", params: { number: "ODL-2026-000108" }, date: "2026-05-31T09:20:00-05:00", userId: "u-005" },
  { id: "act-028", clientId: "cl-008", applicationId: "ap-008", type: "solicitud_aprobada", descriptionKey: "act028", params: { name: "Yariela Castillo" }, date: "2026-07-25T15:00:00-05:00", userId: "u-005" },

  // Roberto Aizprúa
  { id: "act-029", clientId: "cl-009", type: "cliente_creado", descriptionKey: "act029", date: "2026-04-08T09:00:00-05:00", userId: "u-004" },
  { id: "act-030", clientId: "cl-009", applicationId: "ap-009", type: "solicitud_iniciada", descriptionKey: "act030", params: { number: "ODL-2026-000109" }, date: "2026-04-09T09:20:00-05:00", userId: "u-004" },
  { id: "act-031", clientId: "cl-009", applicationId: "ap-009", type: "solicitud_aprobada", descriptionKey: "act031", params: { name: "Roberto Aizprúa" }, date: "2026-07-15T12:00:00-05:00", userId: "u-004" },

  // Ivonne Delgado
  { id: "act-032", clientId: "cl-010", type: "cliente_creado", descriptionKey: "act032", date: "2026-02-14T09:00:00-05:00", userId: "u-006" },
  { id: "act-033", clientId: "cl-010", type: "estado_modificado", descriptionKey: "act033", date: "2026-06-01T10:05:00-05:00", userId: "u-006" },

  // Manuel Batista
  { id: "act-034", clientId: "cl-011", type: "cliente_creado", descriptionKey: "act034", date: "2026-07-20T09:00:00-05:00", userId: "u-005" },
  { id: "act-035", clientId: "cl-011", applicationId: "ap-010", type: "solicitud_iniciada", descriptionKey: "act035", params: { name: "Manuel Batista" }, date: "2026-07-21T09:30:00-05:00", userId: "u-005" },

  // Gabriela Núñez
  { id: "act-036", clientId: "cl-012", type: "cliente_creado", descriptionKey: "act036", date: "2026-07-05T09:00:00-05:00", userId: "u-004" },
  { id: "act-037", clientId: "cl-012", applicationId: "ap-011", type: "solicitud_iniciada", descriptionKey: "act037", params: { number: "ODL-2026-000111" }, date: "2026-07-06T09:20:00-05:00", userId: "u-004" },
  { id: "act-038", clientId: "cl-012", applicationId: "ap-011", type: "documento_recibido", descriptionKey: "act038", params: { name: "Gabriela Núñez" }, date: "2026-08-01T17:10:00-05:00", userId: "u-004" },

  // Franklin Ortega
  { id: "act-039", clientId: "cl-013", type: "cliente_creado", descriptionKey: "act039", date: "2026-03-11T09:00:00-05:00", userId: "u-006" },
  { id: "act-040", clientId: "cl-013", type: "alerta_registrada", descriptionKey: "act040", params: { name: "Franklin Ortega" }, date: "2026-03-11T09:05:00-05:00", userId: "u-006" },
  { id: "act-041", clientId: "cl-013", applicationId: "ap-012", type: "solicitud_iniciada", descriptionKey: "act041", params: { number: "ODL-2026-000112" }, date: "2026-03-12T09:20:00-05:00", userId: "u-006" },
  { id: "act-042", clientId: "cl-013", applicationId: "ap-012", type: "estado_modificado", descriptionKey: "act042", params: { name: "Franklin Ortega" }, date: "2026-04-02T10:00:00-05:00", userId: "u-006" },

  // Melissa Chen
  { id: "act-043", clientId: "cl-014", type: "cliente_creado", descriptionKey: "act043", date: "2026-05-02T09:00:00-05:00", userId: "u-005" },
  { id: "act-044", clientId: "cl-014", applicationId: "ap-013", type: "solicitud_iniciada", descriptionKey: "act044", params: { number: "ODL-2026-000113" }, date: "2026-05-03T09:20:00-05:00", userId: "u-005" },
  { id: "act-045", clientId: "cl-014", applicationId: "ap-013", type: "solicitud_aprobada", descriptionKey: "act045", params: { name: "Melissa Chen" }, date: "2026-07-22T11:40:00-05:00", userId: "u-005" },

  // Diana Espinoza
  { id: "act-046", clientId: "cl-016", type: "cliente_creado", descriptionKey: "act046", date: "2026-07-15T09:00:00-05:00", userId: "u-006" },
  { id: "act-047", clientId: "cl-016", applicationId: "ap-014", type: "solicitud_iniciada", descriptionKey: "act047", params: { number: "ODL-2026-000114" }, date: "2026-07-16T09:20:00-05:00", userId: "u-006" },
  { id: "act-048", clientId: "cl-016", applicationId: "ap-014", type: "nota_agregada", descriptionKey: "act048", params: { name: "Diana Espinoza" }, date: "2026-07-31T14:00:00-05:00", userId: "u-006" },

  // Ricardo Vega
  { id: "act-049", clientId: "cl-017", type: "cliente_creado", descriptionKey: "act049", date: "2026-06-29T09:00:00-05:00", userId: "u-005" },
  { id: "act-050", clientId: "cl-017", type: "nota_agregada", descriptionKey: "act050", date: "2026-07-01T09:00:00-05:00", userId: "u-005" },
];

export function getActivitiesByClientId(clientId: string): ActivityEvent[] {
  return ACTIVITIES.filter((activity) => activity.clientId === clientId).sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
}

export function getRecentActivities(limit = 6): ActivityEvent[] {
  return [...ACTIVITIES]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, limit);
}
