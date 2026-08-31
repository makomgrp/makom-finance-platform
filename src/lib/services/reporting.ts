import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  PORTAL_ABANDONED_AFTER_MS,
  PORTAL_STALLED_AFTER_MS,
} from "@/lib/config/portal-funnel";
import { compareMetric, previousPeriod, type ReportingPeriod } from "@/lib/reporting/period";
import type {
  AttributionCoverage,
  AttributionRow,
  ApplicationMetrics,
  CommunicationMetrics,
  CoverageMetadata,
  DocumentMetrics,
  FinancialMetrics,
  FollowUpMetrics,
  FunnelStepMetrics,
  LeadMetrics,
  NewClientMetrics,
  ProcessDurationMetrics,
  ProductMetricRow,
  ReportingComparison,
  ReportingSnapshot,
  TeamMetricRow,
} from "@/lib/reporting/types";

/**
 * ============================================================================
 * MILESTONE 26B-26C — LA ÚNICA PUERTA A LAS CIFRAS DE GESTIÓN
 * ============================================================================
 *
 * Un adaptador delgado sobre las funciones de la base. Aquí NO se agrega nada:
 * cada cifra sale ya calculada de SQL, porque una segunda implementación en
 * TypeScript sería una segunda respuesta esperando a discrepar con la primera.
 *
 * Lo que sí ocurre aquí, y solo aquí:
 *
 *   * los umbrales de estancamiento y abandono viajan a SQL como parámetros,
 *     desde su único dueño en `config/portal-funnel.ts`;
 *   * los `null` de SQL se traducen a la semántica del contrato — `null`
 *     cuando algo no se puede saber, `0` cuando de verdad fue cero;
 *   * las tasas se derivan de sus dos componentes, siempre con el denominador
 *     comprobado.
 *
 * ----------------------------------------------------------------------------
 * SIN GUARDIA DE CAPACIDAD AQUÍ, Y ES LA CONVENCIÓN DEL PROYECTO
 * ----------------------------------------------------------------------------
 * En este repositorio la autorización vive en las Server Actions
 * (`requireCapability`), no en los servicios — igual que `getDashboardOperations`
 * y todos los demás. Este módulo es `server-only` y no tiene superficie
 * pública: no existe forma de llegar aquí sin pasar antes por una pantalla
 * autenticada.
 *
 * La capability `analytics:view` ya está definida para cuando 26B-26D construya
 * esa pantalla. Que exista hoy sin punto de aplicación es deliberado: quién
 * puede ver los resultados del negocio es una decisión que merece tomarse en
 * frío, no con la prisa de una UI a medio hacer.
 *
 * ----------------------------------------------------------------------------
 * NUMERIC
 * ----------------------------------------------------------------------------
 * PostgREST entrega `numeric` como número JSON, que es como el resto de este
 * proyecto ya trata `requested_amount` y `approved_amount`. Se conserva esa
 * convención; la precisión se mantiene en NUMERIC dentro de SQL, donde ocurren
 * las sumas y las medianas.
 */

export type ReportingResult<T> = { status: "ok"; data: T } | { status: "error" };

/** `null`, `undefined` o ausencia → 0. Para CONTEOS, donde la ausencia es cero. */
function count(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * `null` se conserva como `null`. Para PROMEDIOS, MEDIANAS y demás cifras donde
 * la ausencia de muestras no es un cero: un promedio de nada no vale 0, no
 * existe, y devolver 0 diría que los importes fueron nulos cuando no hubo
 * ninguno.
 */
function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Una tasa solo existe si su denominador existe. Nunca 0%, nunca Infinity. */
function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}

async function callSingle<T>(fn: string, args: Record<string, unknown>): Promise<T | undefined> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    console.error(`[reporting service] ${fn} failed:`, error.message);
    return undefined;
  }
  const rows = (data ?? []) as T[];
  return Array.isArray(rows) ? rows[0] : (rows as T);
}

async function callMany<T>(fn: string, args: Record<string, unknown>): Promise<T[] | undefined> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    console.error(`[reporting service] ${fn} failed:`, error.message);
    return undefined;
  }
  return (data ?? []) as T[];
}

function periodArgs(period: ReportingPeriod) {
  return { p_from: period.from.toISOString(), p_to: period.to.toISOString() };
}

/**
 * Un instante de corte cae dentro del periodo medido cuando el periodo EMPIEZA
 * en o después de él.
 *
 * Es deliberadamente estricto. Un periodo que empieza antes del corte contiene
 * un tramo sin medir, y presentarlo como cobertura completa es exactamente lo
 * que hace que un informe de julio muestre un embudo vacío y parezca que nadie
 * usó el formulario.
 */
function coveredBy(period: ReportingPeriod, startedAt: string | null): boolean {
  if (!startedAt) return false;
  return period.from.getTime() >= new Date(startedAt).getTime();
}

export async function getReportingSnapshot(
  period: ReportingPeriod
): Promise<ReportingResult<ReportingSnapshot>> {
  const args = periodArgs(period);

  const [
    coverageRow,
    leadRow,
    clientRow,
    applicationRow,
    financialRow,
    productRows,
    funnelRows,
    documentRow,
    durationRows,
    teamRows,
    followUpRow,
    attributionRows,
    attributionCoverageRow,
    communicationRow,
  ] = await Promise.all([
    callSingle<Record<string, unknown>>("reporting_coverage", {}),
    callSingle<Record<string, unknown>>("reporting_lead_metrics", {
      ...args,
      // Los umbrales cruzan a SQL desde su único dueño. Ninguna función de la
      // base los conoce por su cuenta.
      p_stalled_seconds: Math.round(PORTAL_STALLED_AFTER_MS / 1000),
      p_abandoned_seconds: Math.round(PORTAL_ABANDONED_AFTER_MS / 1000),
    }),
    callSingle<Record<string, unknown>>("reporting_new_clients", args),
    callSingle<Record<string, unknown>>("reporting_application_metrics", args),
    callSingle<Record<string, unknown>>("reporting_financial_metrics", args),
    callMany<Record<string, unknown>>("reporting_product_metrics", args),
    callMany<Record<string, unknown>>("reporting_funnel_metrics", args),
    callSingle<Record<string, unknown>>("reporting_document_metrics", args),
    callMany<Record<string, unknown>>("reporting_process_durations", args),
    callMany<Record<string, unknown>>("reporting_team_metrics", args),
    callSingle<Record<string, unknown>>("reporting_followup_metrics", args),
    callMany<Record<string, unknown>>("reporting_attribution_metrics", args),
    callSingle<Record<string, unknown>>("reporting_attribution_coverage", args),
    callSingle<Record<string, unknown>>("reporting_communication_metrics", args),
  ]);

  if (
    !coverageRow || !leadRow || !clientRow || !applicationRow || !financialRow ||
    !productRows || !funnelRows || !documentRow || !durationRows || !teamRows ||
    !followUpRow || !attributionRows || !attributionCoverageRow || !communicationRow
  ) {
    return { status: "error" };
  }

  const funnelStartedAt = (coverageRow.funnel_tracking_started_at as string | null) ?? null;
  const attributionStartedAt =
    (coverageRow.attribution_tracking_started_at as string | null) ?? null;
  const auditStartedAt = (coverageRow.audit_events_started_at as string | null) ?? null;

  const coverage: CoverageMetadata = {
    period,
    generatedAt: new Date().toISOString(),
    funnelTrackingStartedAt: funnelStartedAt,
    attributionTrackingStartedAt: attributionStartedAt,
    auditEventsStartedAt: auditStartedAt,
    historicalFunnelAvailable: coveredBy(period, funnelStartedAt),
    attributionAvailable: coveredBy(period, attributionStartedAt),
    decisionHistoryAvailable: coveredBy(period, auditStartedAt),
    disbursementMetricsAvailable: Boolean(coverageRow.disbursement_metrics_available),
    whatsappMetricsAvailable: Boolean(coverageRow.whatsapp_metrics_available),
    emailDeliveryMetricsAvailable: Boolean(coverageRow.email_delivery_metrics_available),
    complianceMetricsAvailable: Boolean(coverageRow.compliance_metrics_available),
  };

  const leads: LeadMetrics = {
    leads: count(leadRow.leads),
    uniquePeople: count(leadRow.unique_people),
    unresolvedIntakes: count(leadRow.unresolved_intakes),
    converted: count(leadRow.converted),
    activeNow: count(leadRow.active_now),
    stalledNow: count(leadRow.stalled_now),
    abandonedNow: count(leadRow.abandoned_now),
    resumedEvents: count(leadRow.resumed_events),
  };

  const newClients: NewClientMetrics = {
    total: count(clientRow.total),
    fromPortal: count(clientRow.from_portal),
    manual: count(clientRow.manual),
    otherChannels: count(clientRow.other_channels),
  };

  const approved = count(applicationRow.approved);
  const decisions = count(applicationRow.decisions);
  const applications: ApplicationMetrics = {
    created: count(applicationRow.created),
    formalized: count(applicationRow.formalized),
    approved,
    declined: count(applicationRow.declined),
    cancelled: count(applicationRow.cancelled),
    decisions,
    openAtPeriodEnd: count(applicationRow.open_at_period_end),
    approvalRate: rate(approved, decisions),
  };

  const financial: FinancialMetrics = {
    requestedCount: count(financialRow.requested_count),
    requestedTotal: count(financialRow.requested_total),
    requestedAverage: nullableNumber(financialRow.requested_average),
    requestedMedian: nullableNumber(financialRow.requested_median),
    approvedCount: count(financialRow.approved_count),
    approvedTotal: count(financialRow.approved_total),
    approvedAverage: nullableNumber(financialRow.approved_average),
    approvedMedian: nullableNumber(financialRow.approved_median),
  };

  const products: ProductMetricRow[] = productRows.map((row) => {
    const productApproved = count(row.approved);
    const productDecisions = productApproved + count(row.declined);
    return {
      productId: String(row.product_id),
      productCode: String(row.product_code),
      applicationCode: (row.application_code as string | null) ?? null,
      created: count(row.created),
      formalized: count(row.formalized),
      approved: productApproved,
      declined: count(row.declined),
      requestedTotal: count(row.requested_total),
      approvedTotal: count(row.approved_total),
      approvalRate: rate(productApproved, productDecisions),
    };
  });

  const funnel: FunnelStepMetrics[] = funnelRows.map((row) => {
    const reached = count(row.reached);
    const completed = count(row.completed);
    return { step: String(row.step), reached, completed, completionRate: rate(completed, reached) };
  });

  const documents: DocumentMetrics = {
    uploadedInPeriod: count(documentRow.uploaded_in_period),
    applicationsWithUploads: count(documentRow.applications_with_uploads),
    reviewedInPeriod: count(documentRow.reviewed_in_period),
    slotsPendingNow: count(documentRow.slots_pending_now),
    slotsSubmittedNow: count(documentRow.slots_submitted_now),
    slotsUnderReviewNow: count(documentRow.slots_under_review_now),
    slotsSatisfiedNow: count(documentRow.slots_satisfied_now),
    slotsRejectedNow: count(documentRow.slots_rejected_now),
    slotsWaivedNow: count(documentRow.slots_waived_now),
    slotsMissingNow: count(documentRow.slots_missing_now),
    documentsAwaitingReviewNow: count(documentRow.documents_awaiting_review_now),
  };

  const processDurations: ProcessDurationMetrics[] = durationRows.map((row) => ({
    metric: String(row.metric),
    sampleCount: count(row.sample_count),
    averageHours: nullableNumber(row.average_hours),
    medianHours: nullableNumber(row.median_hours),
    p90Hours: nullableNumber(row.p90_hours),
  }));

  const team: TeamMetricRow[] = teamRows.map((row) => ({
    profileId: String(row.profile_id),
    role: String(row.role),
    assignedOpenNow: count(row.assigned_open_now),
    formalizedInPeriod: count(row.formalized_in_period),
    approvedInPeriod: count(row.approved_in_period),
    declinedInPeriod: count(row.declined_in_period),
    requestedTotal: count(row.requested_total),
    approvedTotal: count(row.approved_total),
    followUpsOpenNow: count(row.followups_open_now),
  }));

  const followUps: FollowUpMetrics = {
    createdInPeriod: count(followUpRow.created_in_period),
    completedInPeriod: count(followUpRow.completed_in_period),
    openNow: count(followUpRow.open_now),
    overdueNow: count(followUpRow.overdue_now),
  };

  const attribution: AttributionRow[] = attributionRows.map((row) => ({
    utmSource: (row.utm_source as string | null) ?? null,
    utmMedium: (row.utm_medium as string | null) ?? null,
    utmCampaign: (row.utm_campaign as string | null) ?? null,
    utmContent: (row.utm_content as string | null) ?? null,
    utmTerm: (row.utm_term as string | null) ?? null,
    referrerHost: (row.referrer_host as string | null) ?? null,
    landingPath: (row.landing_path as string | null) ?? null,
    leads: count(row.leads),
    formalized: count(row.formalized),
    approved: count(row.approved),
    requestedTotal: count(row.requested_total),
    approvedTotal: count(row.approved_total),
  }));

  const attributionCoverage: AttributionCoverage = {
    unmeasured: count(attributionCoverageRow.unmeasured),
    measuredWithoutUtm: count(attributionCoverageRow.measured_without_utm),
    measuredWithUtm: count(attributionCoverageRow.measured_with_utm),
  };

  const communications: CommunicationMetrics = {
    emailsSent: count(communicationRow.emails_sent),
    emailsReceived: count(communicationRow.emails_received),
    emailsLinked: count(communicationRow.emails_linked),
    emailsUnlinked: count(communicationRow.emails_unlinked),
  };

  return {
    status: "ok",
    data: {
      coverage, leads, newClients, applications, financial, products, funnel,
      documents, processDurations, team, followUps, attribution,
      attributionCoverage, communications,
    },
  };
}

/**
 * El periodo frente al anterior equivalente.
 *
 * Se comparan solo las cifras DE PERIODO. Los estados del presente —estancados
 * ahora, requisitos pendientes ahora— quedan fuera a propósito: son el mismo
 * número mirado dos veces, y ponerlos aquí invitaría a leer una variación
 * donde no la hay.
 */
export async function getReportingComparison(
  period: ReportingPeriod
): Promise<ReportingResult<ReportingComparison>> {
  const [current, previous] = await Promise.all([
    getReportingSnapshot(period),
    getReportingSnapshot(previousPeriod(period)),
  ]);

  if (current.status !== "ok" || previous.status !== "ok") return { status: "error" };

  const c = current.data;
  const p = previous.data;

  return {
    status: "ok",
    data: {
      current: c,
      previous: p,
      comparisons: {
        leads: compareMetric(c.leads.leads, p.leads.leads),
        convertedLeads: compareMetric(c.leads.converted, p.leads.converted),
        newClients: compareMetric(c.newClients.total, p.newClients.total),
        applicationsCreated: compareMetric(c.applications.created, p.applications.created),
        applicationsFormalized: compareMetric(c.applications.formalized, p.applications.formalized),
        applicationsApproved: compareMetric(c.applications.approved, p.applications.approved),
        requestedTotal: compareMetric(c.financial.requestedTotal, p.financial.requestedTotal),
        approvedTotal: compareMetric(c.financial.approvedTotal, p.financial.approvedTotal),
        documentsUploaded: compareMetric(
          c.documents.uploadedInPeriod,
          p.documents.uploadedInPeriod
        ),
        emailsSent: compareMetric(c.communications.emailsSent, p.communications.emailsSent),
      },
    },
  };
}
