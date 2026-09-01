import "server-only";
import ExcelJS from "exceljs";
import { getTranslations } from "next-intl/server";
import { BUSINESS_TIME_ZONE } from "@/lib/config/business-time";
import { writeSheet, type ColumnSpec, type SheetOptions } from "@/lib/reporting/excel/sheet";
import {
  buildSummaryRows,
  summaryCellKind,
  type SummaryRow,
} from "@/lib/reporting/excel/summary";
import type { ReportingComparison } from "@/lib/reporting/types";
import type {
  ApplicationExportRow,
  DetailedExportData,
  DocumentExportRow,
  FollowUpExportRow,
  LeadExportRow,
  LocalizedCell,
} from "@/lib/reporting/export-types";
import type { Locale } from "@/i18n/config";

/**
 * ============================================================================
 * MILESTONE 26B-26F — EL LIBRO
 * ============================================================================
 *
 * Ocho hojas y una sola fuente para cada número.
 *
 *   Resumen        NO SE CALCULA AQUÍ. Sale entero de `getReportingComparison`,
 *                  la misma función que pinta el Dashboard e imprime el PDF. Si
 *                  este fichero sumara una sola columna por su cuenta, ODL
 *                  tendría dos respuestas para la misma pregunta y ninguna
 *                  forma de saber cuál mirar.
 *   Solicitudes    Filas. Las solicitudes creadas en el período, con su cliente.
 *   Leads          Filas. Los envíos del formulario público recibidos.
 *   Documentos     Filas. Los requisitos de esas solicitudes.
 *   Seguimientos   Filas. Los contactos registrados en el período.
 *   Adquisición    Agregado, de `snapshot.attribution`.
 *   Equipo         Agregado, de `snapshot.team`, con los nombres resueltos.
 *   Metodología    Lo que hay que saber antes de citar cualquiera de los ocho.
 *
 * ----------------------------------------------------------------------------
 * LAS DOS POBLACIONES, Y POR QUÉ NO SON LA MISMA
 * ----------------------------------------------------------------------------
 * «Solicitudes» son las CREADAS dentro del período. «Documentos» son los
 * requisitos DE ESAS solicitudes, no los archivos subidos durante el período —
 * que es lo que cuenta el Resumen. Son dos preguntas legítimas y distintas, y
 * si nadie lo dijera, la primera persona que reste una de la otra concluiría
 * que faltan documentos. La hoja Metodología lo dice, y esta nota está aquí
 * para que quien edite el código sepa que esa frase no es relleno.
 *
 * ----------------------------------------------------------------------------
 * NADA SE PERSISTE
 * ----------------------------------------------------------------------------
 * Se construye en memoria, se entrega y se descarta. Sin Storage, sin tabla de
 * exportaciones, sin copia en disco. Guardar un archivo con la cartera de
 * clientes «por si acaso» sería crear justo el depósito que este milestone se
 * cuida de no crear.
 */

export interface DetailedExportInput {
  /** Los agregados. La única fuente de las cifras del Resumen. */
  reporting: ReportingComparison;
  /** El detalle, ya resuelto en el servidor. */
  detail: DetailedExportData;
  locale: Locale;
  /** Nombres del directorio de personal. Un perfil sin nombre se omite. */
  nameByProfileId: Record<string, string>;
}

/** El texto localizado de una columna `jsonb`, con reserva al español. */
function pick(value: LocalizedCell | null, locale: Locale): string | null {
  if (!value) return null;
  return value[locale] ?? value.es ?? Object.values(value)[0] ?? null;
}

/**
 * Genera el libro completo.
 *
 * Devuelve un Buffer y no un stream, deliberadamente: permite dar un
 * `Content-Length` exacto y —lo que importa— fallar ANTES de haber empezado a
 * enviar una respuesta 200. Un archivo truncado a mitad de descarga se abre y
 * se lee como si estuviera completo.
 */
export async function renderDetailedExport(input: DetailedExportInput): Promise<Buffer> {
  const { reporting, detail, locale, nameByProfileId } = input;
  const snapshot = reporting.current;

  const t = await getTranslations({ locale, namespace: "dashboard.analytics.excel" });
  const tHead = await getTranslations({ locale, namespace: "dashboard.analytics.excel.headers" });
  const tKpis = await getTranslations({ locale, namespace: "dashboard.analytics.kpis" });
  const tStatus = await getTranslations({ locale, namespace: "statuses" });
  const tFollowUp = await getTranslations({ locale, namespace: "followUp" });

  /**
   * Traduce un código del vocabulario cerrado de la base, y si no hay
   * traducción devuelve el código.
   *
   * NUNCA una cadena vacía ni un guion. Un valor que el CRM guarda y este libro
   * no sabe nombrar sigue siendo un dato: mostrarlo tal cual permite reconocerlo
   * y añadir la traducción; ocultarlo lo convierte en una fila que parece rota.
   */
  const label = (
    translate: { (key: string): string; has: (key: string) => boolean },
    key: string,
    code: string | null | undefined
  ): string | null => {
    if (!code) return null;
    const full = `${key}.${code}`;
    return translate.has(full) ? translate(full) : code;
  };

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ODL LoanFlow CRM";
  workbook.created = new Date();

  const options = (emptyMessage: string): SheetOptions => ({
    yes: t("yes"),
    no: t("no"),
    emptyMessage,
    locale,
  });

  // =========================================================================
  // 1. RESUMEN — las cifras del Dashboard, sin recalcular ninguna
  // =========================================================================
  // Las filas se arman en `summary.ts`, que es puro y por tanto comprobable:
  // ahí vive la regla de 26B-26F.1 sobre cuándo un monto aprobado es un número
  // y cuándo es el estado «Sin aprobaciones».
  const summaryRows = buildSummaryRows(reporting, {
    leads: t("metrics.leads"),
    convertedLeads: t("metrics.convertedLeads"),
    newClients: t("metrics.newClients"),
    applicationsCreated: t("metrics.applicationsCreated"),
    applicationsFormalized: t("metrics.applicationsFormalized"),
    applicationsApproved: t("metrics.applicationsApproved"),
    requestedTotal: t("metrics.requestedTotal"),
    approvedTotal: t("metrics.approvedTotal"),
    documentsUploaded: t("metrics.documentsUploaded"),
    emailsSent: t("metrics.emailsSent"),
    declined: t("metrics.declined"),
    decisions: t("metrics.decisions"),
    openAtPeriodEnd: t("metrics.openAtPeriodEnd"),
    approvalRate: t("metrics.approvalRate"),
    followUpsOpen: t("metrics.followUpsOpen"),
    followUpsOverdue: t("metrics.followUpsOverdue"),
    // LA MISMA CLAVE QUE EL DASHBOARD Y EL PDF, no una copia con el mismo texto.
    noApprovals: tKpis("approvedEmpty"),
    noDecisions: tKpis("approvalRateEmpty"),
  });

  writeSheet<SummaryRow>(
    workbook.addWorksheet(t("sheets.summary")),
    [
      { header: tHead("metric"), kind: "text", width: 42, value: (row) => row.label },
      {
        header: tHead("current"),
        // El tipo lo decide el VALOR: «Sin aprobaciones» es texto, un importe
        // sigue siendo número con formato de balboa.
        kind: (row) => summaryCellKind(row.current, row.kind),
        width: 18,
        value: (row) => row.current,
      },
      {
        header: tHead("previous"),
        kind: (row) => summaryCellKind(row.previous, row.kind),
        width: 18,
        value: (row) => row.previous,
      },
      {
        header: tHead("delta"),
        kind: (row) => row.kind,
        width: 16,
        value: (row) => row.deltaAbsolute,
      },
      {
        header: tHead("deltaPercent"),
        kind: "percent",
        width: 16,
        value: (row) => row.deltaPercent,
      },
    ],
    summaryRows,
    options(t("empty.summary"))
  );

  // =========================================================================
  // 2. SOLICITUDES
  // =========================================================================
  const applicationColumns: ColumnSpec<ApplicationExportRow>[] = [
    { header: tHead("applicationNumber"), kind: "text", width: 16, value: (r) => r.applicationNumber },
    { header: tHead("createdAt"), kind: "datetime", width: 18, value: (r) => r.createdAt },
    {
      header: tHead("source"),
      kind: "text",
      width: 16,
      value: (r) => label(t, "source", r.createdSource),
    },
    {
      header: tHead("status"),
      kind: "text",
      width: 16,
      value: (r) => label(tStatus, "applicationStatus", r.status),
    },
    { header: tHead("statusChangedAt"), kind: "datetime", width: 18, value: (r) => r.statusChangedAt },
    {
      header: tHead("product"),
      kind: "text",
      width: 28,
      value: (r) => pick(r.productName, locale),
    },
    { header: tHead("requestedAmount"), kind: "currency", width: 16, value: (r) => r.requestedAmount },
    { header: tHead("approvedAmount"), kind: "currency", width: 16, value: (r) => r.approvedAmount },
    { header: tHead("termMonths"), kind: "integer", width: 12, value: (r) => r.requestedTermMonths },
    { header: tHead("clientName"), kind: "text", width: 32, value: (r) => r.clientFullName },
    {
      header: tHead("identificationType"),
      kind: "text",
      width: 14,
      value: (r) => r.clientIdentificationType,
    },
    {
      header: tHead("identificationNumber"),
      kind: "text",
      width: 18,
      value: (r) => r.clientIdentificationNumber,
    },
    { header: tHead("phone"), kind: "text", width: 18, value: (r) => r.clientPhone },
    { header: tHead("email"), kind: "text", width: 30, value: (r) => r.clientEmail },
    { header: tHead("employer"), kind: "text", width: 28, value: (r) => r.clientEmployerName },
    { header: tHead("monthlySalary"), kind: "currency", width: 16, value: (r) => r.clientMonthlySalary },
    {
      header: tHead("clientStatus"),
      kind: "text",
      width: 14,
      value: (r) => label(tStatus, "client", r.clientStatus),
    },
    { header: tHead("advisor"), kind: "text", width: 24, value: (r) => r.advisorName },
    { header: tHead("createdBy"), kind: "text", width: 24, value: (r) => r.createdByName },
    { header: tHead("branch"), kind: "text", width: 20, value: (r) => r.branchName },
  ];

  writeSheet(
    workbook.addWorksheet(t("sheets.applications")),
    applicationColumns,
    detail.applications,
    options(t("empty.applications"))
  );

  // =========================================================================
  // 3. LEADS
  // =========================================================================
  const leadColumns: ColumnSpec<LeadExportRow>[] = [
    { header: tHead("receivedAt"), kind: "datetime", width: 18, value: (r) => r.receivedAt },
    {
      header: tHead("intakeStatus"),
      kind: "text",
      width: 18,
      value: (r) => label(t, "intakeStatus", r.status),
    },
    { header: tHead("channel"), kind: "text", width: 16, value: (r) => label(t, "source", r.channel) },
    {
      header: tHead("portalState"),
      kind: "text",
      width: 16,
      value: (r) => label(t, "portalState", r.portalState),
    },
    { header: tHead("applicantName"), kind: "text", width: 32, value: (r) => r.applicantFullName },
    {
      header: tHead("identificationType"),
      kind: "text",
      width: 14,
      value: (r) => r.applicantIdentificationType,
    },
    {
      header: tHead("identificationNumber"),
      kind: "text",
      width: 18,
      value: (r) => r.applicantIdentificationNumber,
    },
    { header: tHead("phone"), kind: "text", width: 18, value: (r) => r.applicantPhone },
    { header: tHead("email"), kind: "text", width: 30, value: (r) => r.applicantEmail },
    { header: tHead("employer"), kind: "text", width: 28, value: (r) => r.employerName },
    { header: tHead("monthlySalary"), kind: "currency", width: 16, value: (r) => r.monthlySalary },
    { header: tHead("productCode"), kind: "text", width: 16, value: (r) => r.requestedProductCode },
    { header: tHead("requestedAmount"), kind: "currency", width: 16, value: (r) => r.requestedAmount },
    { header: tHead("termMonths"), kind: "integer", width: 12, value: (r) => r.requestedTermMonths },
    { header: tHead("currentStep"), kind: "integer", width: 12, value: (r) => r.currentStep },
    { header: tHead("lastActivityAt"), kind: "datetime", width: 18, value: (r) => r.lastActivityAt },
    { header: tHead("submittedAt"), kind: "datetime", width: 18, value: (r) => r.submittedAt },
    {
      header: tHead("matchedExistingClient"),
      kind: "boolean",
      width: 16,
      value: (r) => r.matchedExistingClient,
    },
    {
      header: tHead("becameApplication"),
      kind: "boolean",
      width: 16,
      value: (r) => r.becameApplication,
    },
    { header: tHead("language"), kind: "text", width: 10, value: (r) => r.locale },
    { header: tHead("utmSource"), kind: "text", width: 18, value: (r) => r.attributionUtmSource },
    { header: tHead("utmMedium"), kind: "text", width: 18, value: (r) => r.attributionUtmMedium },
    { header: tHead("utmCampaign"), kind: "text", width: 22, value: (r) => r.attributionUtmCampaign },
    { header: tHead("utmContent"), kind: "text", width: 18, value: (r) => r.attributionUtmContent },
    { header: tHead("utmTerm"), kind: "text", width: 18, value: (r) => r.attributionUtmTerm },
    { header: tHead("referrerHost"), kind: "text", width: 24, value: (r) => r.attributionReferrerHost },
    { header: tHead("landingPath"), kind: "text", width: 28, value: (r) => r.attributionLandingPath },
  ];

  writeSheet(
    workbook.addWorksheet(t("sheets.leads")),
    leadColumns,
    detail.leads,
    options(t("empty.leads"))
  );

  // =========================================================================
  // 4. DOCUMENTOS — requisitos, nunca archivos
  // =========================================================================
  const documentColumns: ColumnSpec<DocumentExportRow>[] = [
    { header: tHead("applicationNumber"), kind: "text", width: 16, value: (r) => r.applicationNumber },
    { header: tHead("clientName"), kind: "text", width: 32, value: (r) => r.clientFullName },
    { header: tHead("requirementCode"), kind: "text", width: 22, value: (r) => r.code },
    { header: tHead("requirement"), kind: "text", width: 34, value: (r) => pick(r.name, locale) },
    {
      header: tHead("requirementKind"),
      kind: "text",
      width: 18,
      value: (r) => label(tStatus, "requirementKind", r.requirementKind),
    },
    { header: tHead("required"), kind: "boolean", width: 12, value: (r) => r.required },
    { header: tHead("applicantVisible"), kind: "boolean", width: 14, value: (r) => r.applicantVisible },
    {
      header: tHead("status"),
      kind: "text",
      width: 16,
      value: (r) => label(tStatus, "requirementSlotStatus", r.status),
    },
    { header: tHead("statusChangedAt"), kind: "datetime", width: 18, value: (r) => r.statusChangedAt },
    { header: tHead("fileCount"), kind: "integer", width: 12, value: (r) => r.fileCount },
    { header: tHead("lastUploadedAt"), kind: "datetime", width: 18, value: (r) => r.lastUploadedAt },
    { header: tHead("lastReviewedAt"), kind: "datetime", width: 18, value: (r) => r.lastReviewedAt },
    { header: tHead("reviewer"), kind: "text", width: 24, value: (r) => r.reviewerName },
  ];

  writeSheet(
    workbook.addWorksheet(t("sheets.documents")),
    documentColumns,
    detail.documents,
    options(t("empty.documents"))
  );

  // =========================================================================
  // 5. SEGUIMIENTOS — sin la nota interna
  // =========================================================================
  const followUpColumns: ColumnSpec<FollowUpExportRow>[] = [
    { header: tHead("contactedAt"), kind: "datetime", width: 18, value: (r) => r.contactedAt },
    { header: tHead("applicationNumber"), kind: "text", width: 16, value: (r) => r.applicationNumber },
    { header: tHead("clientName"), kind: "text", width: 32, value: (r) => r.clientFullName },
    {
      header: tHead("contactMethod"),
      kind: "text",
      width: 16,
      value: (r) => label(tFollowUp, "methods", r.contactMethod),
    },
    {
      header: tHead("outcome"),
      kind: "text",
      width: 22,
      value: (r) => label(tFollowUp, "outcomes", r.outcome),
    },
    { header: tHead("nextAction"), kind: "text", width: 38, value: (r) => r.nextAction },
    { header: tHead("nextActionAt"), kind: "datetime", width: 18, value: (r) => r.nextActionAt },
    { header: tHead("completedAt"), kind: "datetime", width: 18, value: (r) => r.completedAt },
    { header: tHead("author"), kind: "text", width: 24, value: (r) => r.authorName },
    { header: tHead("completedBy"), kind: "text", width: 24, value: (r) => r.completedByName },
  ];

  writeSheet(
    workbook.addWorksheet(t("sheets.followUps")),
    followUpColumns,
    detail.followUps,
    options(t("empty.followUps"))
  );

  // =========================================================================
  // 6. ADQUISICIÓN — agregado, tal como sale del contrato
  // =========================================================================
  writeSheet(
    workbook.addWorksheet(t("sheets.acquisition")),
    [
      { header: tHead("utmSource"), kind: "text", width: 20, value: (r) => r.utmSource },
      { header: tHead("utmMedium"), kind: "text", width: 20, value: (r) => r.utmMedium },
      { header: tHead("utmCampaign"), kind: "text", width: 24, value: (r) => r.utmCampaign },
      { header: tHead("utmContent"), kind: "text", width: 20, value: (r) => r.utmContent },
      { header: tHead("utmTerm"), kind: "text", width: 20, value: (r) => r.utmTerm },
      { header: tHead("referrerHost"), kind: "text", width: 24, value: (r) => r.referrerHost },
      { header: tHead("landingPath"), kind: "text", width: 28, value: (r) => r.landingPath },
      { header: tHead("leads"), kind: "integer", width: 12, value: (r) => r.leads },
      { header: tHead("formalized"), kind: "integer", width: 14, value: (r) => r.formalized },
      { header: tHead("approved"), kind: "integer", width: 12, value: (r) => r.approved },
      { header: tHead("requestedTotal"), kind: "currency", width: 18, value: (r) => r.requestedTotal },
      { header: tHead("approvedTotal"), kind: "currency", width: 18, value: (r) => r.approvedTotal },
    ] satisfies ColumnSpec<(typeof snapshot.attribution)[number]>[],
    snapshot.attribution,
    options(
      // La atribución solo existe desde que se empezó a medir. La frase lo dice
      // en vez de dejar una hoja vacía que se lee como «no hubo campañas».
      snapshot.coverage.attributionAvailable
        ? t("empty.acquisition")
        : t("empty.acquisitionUncovered")
    )
  );

  // =========================================================================
  // 7. EQUIPO — nombres resueltos, nunca identificadores
  // =========================================================================
  // UN PERFIL SIN NOMBRE RESUELTO SE OMITE. La alternativa era imprimir su
  // `uuid`, que no le dice nada a quien lee y sí a quien reciba el archivo por
  // error. Misma regla que el Dashboard y que el PDF.
  const teamRows = snapshot.team.filter((row) => nameByProfileId[row.profileId]);

  writeSheet(
    workbook.addWorksheet(t("sheets.team")),
    [
      {
        header: tHead("person"),
        kind: "text",
        width: 28,
        value: (r) => nameByProfileId[r.profileId],
      },
      { header: tHead("role"), kind: "text", width: 16, value: (r) => r.role },
      { header: tHead("assignedOpen"), kind: "integer", width: 16, value: (r) => r.assignedOpenNow },
      { header: tHead("formalized"), kind: "integer", width: 14, value: (r) => r.formalizedInPeriod },
      { header: tHead("approved"), kind: "integer", width: 12, value: (r) => r.approvedInPeriod },
      { header: tHead("declined"), kind: "integer", width: 12, value: (r) => r.declinedInPeriod },
      { header: tHead("requestedTotal"), kind: "currency", width: 18, value: (r) => r.requestedTotal },
      { header: tHead("approvedTotal"), kind: "currency", width: 18, value: (r) => r.approvedTotal },
      {
        header: tHead("followUpsOpen"),
        kind: "integer",
        width: 16,
        value: (r) => r.followUpsOpenNow,
      },
    ] satisfies ColumnSpec<(typeof snapshot.team)[number]>[],
    teamRows,
    options(t("empty.team"))
  );

  // =========================================================================
  // 8. METODOLOGÍA — lo que hay que saber antes de citar cualquier cifra
  // =========================================================================
  const periodFormatter = new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-PA", {
    dateStyle: "long",
    timeZone: BUSINESS_TIME_ZONE,
  });
  const period = snapshot.coverage.period;
  const periodText = `${periodFormatter.format(period.from)} — ${periodFormatter.format(
    new Date(period.to.getTime() - 1)
  )}`;

  const methodology: { topic: string; detail: string }[] = [
    { topic: t("methodology.periodTopic"), detail: periodText },
    { topic: t("methodology.timezoneTopic"), detail: t("methodology.timezone") },
    { topic: t("methodology.populationsTopic"), detail: t("methodology.populations") },
    {
      topic: t("methodology.applicationNumberTopic"),
      detail: t("methodology.applicationNumber"),
    },
    { topic: t("methodology.documentsTopic"), detail: t("methodology.documents") },
    { topic: t("methodology.followUpsTopic"), detail: t("methodology.followUps") },
    { topic: t("methodology.approvedTopic"), detail: t("methodology.approved") },
    { topic: t("methodology.approvalRateTopic"), detail: t("methodology.approvalRate") },
    { topic: t("methodology.deltaTopic"), detail: t("methodology.delta") },
    { topic: t("methodology.emptyTopic"), detail: t("methodology.empty") },
    { topic: t("methodology.funnelTopic"), detail: t("methodology.funnel") },
    {
      topic: t("methodology.attributionTopic"),
      detail: snapshot.coverage.attributionAvailable
        ? t("methodology.attributionCovered")
        : t("methodology.attributionUncovered"),
    },
    { topic: t("methodology.piiTopic"), detail: t("methodology.pii") },
    { topic: t("methodology.excludedTopic"), detail: t("methodology.excluded") },
    { topic: t("methodology.auditTopic"), detail: t("methodology.audit") },
    { topic: t("methodology.sourceTopic"), detail: t("methodology.source") },
  ];

  writeSheet(
    workbook.addWorksheet(t("sheets.methodology")),
    [
      { header: tHead("topic"), kind: "text", width: 32, value: (r) => r.topic },
      { header: tHead("explanation"), kind: "text", width: 110, value: (r) => r.detail },
    ] satisfies ColumnSpec<{ topic: string; detail: string }>[],
    methodology,
    options(t("empty.methodology"))
  );

  const written = await workbook.xlsx.writeBuffer();
  return Buffer.from(written);
}
