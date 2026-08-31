import type { MetricComparison, ReportingPeriod } from "./period";

/**
 * ============================================================================
 * MILESTONE 26B-26C — EL CONTRATO QUE FIRMAN DASHBOARD, PDF Y EXCEL
 * ============================================================================
 *
 * Las tres superficies futuras van a preguntar lo mismo. Si cada una calcula
 * por su cuenta, la primera divergencia aparece el día que alguien compare dos
 * documentos y no cuadren — y desde entonces ninguno de los tres es creíble.
 *
 * Estos tipos son la forma en que esa respuesta única viaja. Nada aguas arriba
 * vuelve a agregar: leen estos campos y los dibujan.
 *
 * ----------------------------------------------------------------------------
 * SIN DATOS PERSONALES, POR CONSTRUCCIÓN
 * ----------------------------------------------------------------------------
 * Ninguna interfaz de aquí tiene nombre, correo, teléfono, cédula, dirección ni
 * contenido de documento. No es una omisión que haya que recordar: los campos
 * no existen, así que un informe gerencial no puede filtrar datos personales
 * aunque alguien lo intente. La exportación detallada con PII es 26B-26F y
 * llevará su propia capability.
 *
 * `TeamMetricRow` lleva `profileId` porque una cifra por asesor necesita saber
 * de quién es — pero no su nombre: quien lo dibuje ya tiene el directorio de
 * personal y puede resolverlo bajo sus propios permisos.
 *
 * ----------------------------------------------------------------------------
 * `null` SIGNIFICA "NO SE PUEDE SABER"
 * ----------------------------------------------------------------------------
 * Y nunca cero. Un promedio sin muestras es `null`, no 0. Una tasa sin
 * denominador es `null`, no 0%. Una mediana de importes sin importes es `null`.
 * Cero es una respuesta —«no pasó nada»— y confundirla con «no se puede
 * calcular» es exactamente cómo un informe empieza a mentir sin que nadie lo
 * note.
 */

/** Cuánto abarca este informe y qué NO puede afirmar. */
export interface CoverageMetadata {
  period: ReportingPeriod;
  generatedAt: string;
  /** Desde cuándo hay historia de pasos del embudo. Antes, no existe. */
  funnelTrackingStartedAt: string | null;
  /** Desde cuándo se captura atribución de captación. */
  attributionTrackingStartedAt: string | null;
  /** El evento de auditoría más antiguo: el límite de las fechas de decisión. */
  auditEventsStartedAt: string | null;

  /** ¿El periodo solicitado cae entero dentro del tramo con embudo medido? */
  historicalFunnelAvailable: boolean;
  /** ¿Y dentro del tramo con atribución medida? */
  attributionAvailable: boolean;
  /** ¿Y dentro del tramo con auditoría, del que salen las fechas de decisión? */
  decisionHistoryAvailable: boolean;

  /**
   * Todas false hoy, y cada una por una razón distinta que el informe debe
   * poder explicar en vez de mostrar un cero.
   */
  disbursementMetricsAvailable: boolean;
  whatsappMetricsAvailable: boolean;
  emailDeliveryMetricsAvailable: boolean;
  complianceMetricsAvailable: boolean;
}

/** Leads del portal público. Nunca borradores creados a mano en el CRM. */
export interface LeadMetrics {
  leads: number;
  /**
   * PARCIAL POR DISEÑO. Cuenta identidades resueltas (`matched_client_id`), que
   * es la regla de identidad oficial de este sistema. Un intake que el motor no
   * pudo emparejar no cuenta como persona — contarlo afirmaría que es alguien
   * distinto sin saberlo — y viaja aparte en `unresolvedIntakes`.
   */
  uniquePeople: number;
  unresolvedIntakes: number;
  converted: number;
  /** Estado ACTUAL de esos leads. No dice cuándo se abandonaron. */
  activeNow: number;
  stalledNow: number;
  abandonedNow: number;
  /** Reanudaciones ocurridas DENTRO del periodo, vengan de leads de cuando sea. */
  resumedEvents: number;
}

export interface NewClientMetrics {
  total: number;
  /** Por `clients.created_source`, una columna almacenada. Nunca por etapa. */
  fromPortal: number;
  manual: number;
  otherChannels: number;
}

export interface ApplicationMetrics {
  created: number;
  formalized: number;
  approved: number;
  declined: number;
  cancelled: number;
  /**
   * Solo decisiones de crédito: aprobadas + no elegibles. `cancelled` queda
   * fuera porque es un cierre administrativo sin juicio sobre el solicitante, y
   * meterlo bajaría la tasa por papeleo en vez de por criterio.
   */
  decisions: number;
  /** Un CORTE, no un rango: cuántas seguían abiertas al cerrar el periodo. */
  openAtPeriodEnd: number;
  /** `approved / decisions`. `null` cuando no hubo ninguna decisión. */
  approvalRate: number | null;
}

/**
 * SOLICITADO Y APROBADO. NO HAY MÁS, Y NO POR OLVIDO.
 *
 * No existe importe desembolsado, ni fecha de desembolso, ni saldo, ni cartera,
 * ni pagos, ni intereses: no hay tabla que los guarde. `approvedTotal` es la
 * suma de lo que ODL DECIDIÓ prestar, no de lo que entregó, y llamarlo
 * «prestado» o «cartera» sería el error más caro que este informe podría
 * cometer.
 */
export interface FinancialMetrics {
  requestedCount: number;
  requestedTotal: number;
  requestedAverage: number | null;
  /** Mediana discreta: un importe realmente pedido, no uno interpolado. */
  requestedMedian: number | null;
  approvedCount: number;
  approvedTotal: number;
  approvedAverage: number | null;
  approvedMedian: number | null;
}

export interface ProductMetricRow {
  productId: string;
  productCode: string;
  applicationCode: string | null;
  created: number;
  formalized: number;
  approved: number;
  declined: number;
  requestedTotal: number;
  approvedTotal: number;
  approvalRate: number | null;
}

/** Un paso del embudo. Solo tiene sentido desde `funnelTrackingStartedAt`. */
export interface FunnelStepMetrics {
  step: string;
  /** Personas únicas que vieron la pantalla. Jamás renders. */
  reached: number;
  completed: number;
  /** `completed / reached`. `null` si nadie llegó: no es un 0%. */
  completionRate: number | null;
}

export interface DocumentMetrics {
  /** De PERIODO. */
  uploadedInPeriod: number;
  applicationsWithUploads: number;
  reviewedInPeriod: number;
  /**
   * Del PRESENTE. `requirement_slots.status_changed_at` es un solo campo
   * sobrescribible, así que «cuántos estaban pendientes en julio» no tiene
   * respuesta. Los nombres lo dicen para que ningún informe los mezcle.
   */
  slotsPendingNow: number;
  slotsSubmittedNow: number;
  slotsUnderReviewNow: number;
  slotsSatisfiedNow: number;
  slotsRejectedNow: number;
  slotsWaivedNow: number;
  slotsMissingNow: number;
  documentsAwaitingReviewNow: number;
}

export interface ProcessDurationMetrics {
  metric: string;
  sampleCount: number;
  averageHours: number | null;
  medianHours: number | null;
  p90Hours: number | null;
}

/**
 * Volumen y carga por persona. NO lleva tasa de aprobación, y es deliberado:
 * esa cifra depende del perfil de los clientes que a cada uno le tocaron, no de
 * su criterio, y publicarla como rendimiento empuja a aprobar de más.
 */
export interface TeamMetricRow {
  profileId: string;
  role: string;
  assignedOpenNow: number;
  formalizedInPeriod: number;
  approvedInPeriod: number;
  declinedInPeriod: number;
  requestedTotal: number;
  approvedTotal: number;
  followUpsOpenNow: number;
}

export interface FollowUpMetrics {
  createdInPeriod: number;
  completedInPeriod: number;
  /** Del PRESENTE. «Vencidos durante agosto» no tiene respuesta en el modelo. */
  openNow: number;
  overdueNow: number;
}

export interface AttributionRow {
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  referrerHost: string | null;
  landingPath: string | null;
  leads: number;
  formalized: number;
  approved: number;
  requestedTotal: number;
  approvedTotal: number;
}

/**
 * TRES POBLACIONES, NO DOS.
 *
 * `unmeasured` son leads anteriores al corte de atribución: no se miró.
 * `measuredWithoutUtm` son llegadas directas u orgánicas: se miró y no había
 * campaña. Fundirlas presentaría una ausencia de medición como una medición.
 */
export interface AttributionCoverage {
  unmeasured: number;
  measuredWithoutUtm: number;
  measuredWithUtm: number;
}

/**
 * Enviados, recibidos y vinculación. Sin tasa de entrega, rebote ni apertura:
 * `email_messages` no tiene columna de estado de entrega, y devolver un cero en
 * su lugar sería peor que no devolver nada.
 */
export interface CommunicationMetrics {
  emailsSent: number;
  emailsReceived: number;
  emailsLinked: number;
  emailsUnlinked: number;
}

/** El informe completo de un periodo. */
export interface ReportingSnapshot {
  coverage: CoverageMetadata;
  leads: LeadMetrics;
  newClients: NewClientMetrics;
  applications: ApplicationMetrics;
  financial: FinancialMetrics;
  products: ProductMetricRow[];
  funnel: FunnelStepMetrics[];
  documents: DocumentMetrics;
  processDurations: ProcessDurationMetrics[];
  team: TeamMetricRow[];
  followUps: FollowUpMetrics;
  attribution: AttributionRow[];
  attributionCoverage: AttributionCoverage;
  communications: CommunicationMetrics;
}

/**
 * Un periodo frente al anterior.
 *
 * `comparisons` solo lleva las cifras cuya comparación tiene sentido de verdad.
 * Un estado del presente —«estancados ahora», «pendientes ahora»— no se compara
 * contra el pasado: es el mismo número mirado dos veces, y ponerlo aquí
 * invitaría a leer una variación donde no hay ninguna.
 */
export interface ReportingComparison {
  current: ReportingSnapshot;
  previous: ReportingSnapshot;
  comparisons: {
    leads: MetricComparison;
    convertedLeads: MetricComparison;
    newClients: MetricComparison;
    applicationsCreated: MetricComparison;
    applicationsFormalized: MetricComparison;
    applicationsApproved: MetricComparison;
    requestedTotal: MetricComparison;
    approvedTotal: MetricComparison;
    documentsUploaded: MetricComparison;
    emailsSent: MetricComparison;
  };
}
