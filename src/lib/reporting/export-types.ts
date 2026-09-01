import type { PortalFunnelState } from "../config/portal-funnel.ts";

/**
 * ============================================================================
 * MILESTONE 26B-26F — EL CONTRATO DEL DETALLE
 * ============================================================================
 *
 * Separado del contrato agregado de 26B-26C (`reporting/types.ts`) a propósito,
 * y la diferencia entre los dos es la razón de ser de este milestone:
 *
 *   reporting/types.ts    CIFRAS. Sin un solo campo que identifique a nadie.
 *                         Lo protege `analytics:view`.
 *   export-types.ts       PERSONAS. Nombre, cédula, teléfono, correo, patrono,
 *                         salario. Lo protege `reports:export_sensitive`.
 *
 * Que sean dos ficheros no es orden: es que un campo de PII añadido por
 * descuido al contrato agregado se lee mal aquí y bien allí, y quien revise
 * esto tiene que poder ver de un vistazo en cuál de los dos mundos está.
 *
 * ----------------------------------------------------------------------------
 * LO QUE NO PUEDE APARECER EN ESTE FICHERO, NUNCA
 * ----------------------------------------------------------------------------
 * Contraseñas, tokens, claves de API, identificadores de sesión, URLs firmadas,
 * contenido o binario de documentos, rutas del almacenamiento privado y
 * cualquier secreto bancario. No están omitidos por ahora: están prohibidos.
 * Un extracto que los llevara convertiría cada descarga en una filtración con
 * formato de hoja de cálculo.
 *
 * TAMPOCO UUIDs. Ningún identificador interno viaja al libro. Un `uuid` en una
 * celda no le dice nada a quien lee el informe y sí le dice bastante a quien
 * reciba el archivo por error sobre cómo está construido el sistema por dentro.
 * Los identificadores se usan para CRUZAR datos dentro del servidor y se quedan
 * allí; lo que sale es el número de solicitud, que es el identificador que ODL
 * ya usa en voz alta.
 */

/** Texto de una columna `jsonb` localizada, tal como lo guarda la base. */
export type LocalizedCell = Record<string, string>;

/**
 * Una solicitud creada dentro del período, con su cliente.
 *
 * `approvedAmount` es el MONTO DE UNA DECISIÓN, no dinero entregado. ODL no
 * registra desembolsos —no hay tabla, ni fecha, ni saldo— y la hoja lo dice en
 * su encabezado y en Metodología, porque una columna de dinero en un Excel se
 * suma sin leer la nota.
 */
export interface ApplicationExportRow {
  applicationNumber: string;
  createdAt: string;
  createdSource: string;
  status: string;
  statusChangedAt: string | null;
  productName: LocalizedCell | null;
  requestedAmount: number | null;
  approvedAmount: number | null;
  requestedTermMonths: number | null;
  clientFullName: string | null;
  clientIdentificationType: string | null;
  clientIdentificationNumber: string | null;
  clientPhone: string | null;
  clientEmail: string | null;
  clientEmployerName: string | null;
  clientMonthlySalary: number | null;
  clientStatus: string | null;
  advisorName: string | null;
  createdByName: string | null;
  branchName: string | null;
}

/** Un envío del formulario público recibido dentro del período. */
export interface LeadExportRow {
  receivedAt: string;
  status: string;
  channel: string;
  applicantFullName: string | null;
  applicantIdentificationType: string | null;
  applicantIdentificationNumber: string | null;
  applicantEmail: string | null;
  applicantPhone: string | null;
  employerName: string | null;
  monthlySalary: number | null;
  requestedProductCode: string | null;
  requestedAmount: number | null;
  requestedTermMonths: number | null;
  locale: string | null;
  currentStep: number | null;
  lastActivityAt: string | null;
  submittedAt: string | null;
  /** Se resolvió contra un cliente ya existente. Booleano, nunca el id. */
  matchedExistingClient: boolean;
  /** Llegó a convertirse en solicitud formal. Booleano, nunca el id. */
  becameApplication: boolean;
  /** El mismo clasificador que alimenta el embudo del Dashboard. */
  portalState: PortalFunnelState;
  attributionUtmSource: string | null;
  attributionUtmMedium: string | null;
  attributionUtmCampaign: string | null;
  attributionUtmContent: string | null;
  attributionUtmTerm: string | null;
  attributionReferrerHost: string | null;
  attributionLandingPath: string | null;
}

/**
 * Un requisito de una de las solicitudes de la hoja «Solicitudes».
 *
 * SIN NOMBRE DE ARCHIVO, SIN RUTA, SIN HASH Y SIN CONTENIDO. Solo el estado del
 * requisito, cuántos archivos tiene y cuándo se movió. El nombre de un archivo
 * subido por un solicitante suele llevar su propio nombre o su cédula, y no
 * aporta nada que el estado no diga ya.
 */
export interface DocumentExportRow {
  applicationNumber: string;
  clientFullName: string | null;
  code: string;
  name: LocalizedCell | null;
  requirementKind: string;
  required: boolean;
  applicantVisible: boolean;
  status: string;
  statusChangedAt: string | null;
  fileCount: number;
  lastUploadedAt: string | null;
  lastReviewedAt: string | null;
  reviewerName: string | null;
}

/**
 * Un seguimiento registrado dentro del período.
 *
 * SIN LA NOTA. `application_follow_ups.note` es texto libre que un asesor
 * escribe para sus compañeros — impresiones sobre una persona, detalles de una
 * conversación privada. Es exactamente el tipo de contenido que no debería
 * salir del CRM dentro de un archivo que se reenvía. Lo que sí sale es lo
 * estructurado: método, resultado, acción siguiente y fechas.
 */
export interface FollowUpExportRow {
  contactedAt: string;
  applicationNumber: string | null;
  clientFullName: string | null;
  contactMethod: string;
  outcome: string;
  nextAction: string | null;
  nextActionAt: string | null;
  completedAt: string | null;
  authorName: string | null;
  completedByName: string | null;
}

/**
 * Todo el detalle del período, ya resuelto en el servidor.
 *
 * El navegador nunca ve esta estructura. Se construye, se convierte en bytes
 * .xlsx y se descarta dentro de la misma petición — porque mandar la PII al
 * cliente para que él arme el libro sería exponerla a todo lo que corre en esa
 * pestaña a cambio de nada.
 */
export interface DetailedExportData {
  applications: ApplicationExportRow[];
  leads: LeadExportRow[];
  documents: DocumentExportRow[];
  followUps: FollowUpExportRow[];
}

/** Recuentos por hoja — lo único del extracto que llega al evento de auditoría. */
export function exportRowCounts(data: DetailedExportData): Record<string, number> {
  return {
    applications: data.applications.length,
    leads: data.leads.length,
    documents: data.documents.length,
    follow_ups: data.followUps.length,
  };
}
