import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { AlertTriangle, ArrowRight, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import { formatRate, periodIsCoveredBy, shareOf } from "@/lib/reporting/presentation";
import {
  CoverageNotice,
  MetricCard,
  NoData,
  SectionHeading,
  StackedBar,
} from "./analytics-primitives";
import { PeriodSelector } from "./period-selector";
import { PdfDownloadButton } from "./pdf-download-button";
import { ExcelDownloadButton } from "./excel-download-button";
import {
  AcquisitionSection,
  DocumentSection,
  FinancialSection,
  OperationsFooterSection,
  ProcessSpeedSection,
  ProductSection,
  TeamSection,
} from "./analytics-breakdown";
import type { ReportingComparison } from "@/lib/reporting/types";
import type { ReportingPeriodKind } from "@/lib/reporting/period";

/**
 * ============================================================================
 * MILESTONE 26B-26D — EL INFORME DE DIRECCIÓN
 * ============================================================================
 *
 * Un Server Component que DIBUJA. No calcula ninguna métrica: todo llega ya
 * resuelto por la capa de 26B-26C, y si una cifra de aquí no cuadra con el SQL
 * es un defecto del contrato, no de la pantalla.
 *
 * ----------------------------------------------------------------------------
 * EL ORDEN ES LA RESPUESTA
 * ----------------------------------------------------------------------------
 * Seis cifras arriba, y solo seis. Después lo que hay que hacer hoy, después el
 * embudo, después el detalle. Un tablero con veinte tarjetas iguales obliga a
 * buscar, y buscar es exactamente lo que un director no va a hacer a las ocho
 * de la mañana.
 *
 * ----------------------------------------------------------------------------
 * LO QUE ESTA PANTALLA NO DICE NUNCA
 * ----------------------------------------------------------------------------
 * No hay «prestado», «desembolsado» ni «cartera». ODL no tiene ese dato — no
 * hay tabla de desembolsos, ni fecha, ni saldo — y `approved_amount` es una
 * decisión, no dinero entregado. La sección financiera lo dice al pie, en la
 * pantalla, porque es la lectura equivocada más fácil de hacer.
 */

interface AnalyticsSectionProps {
  data: ReportingComparison;
  activeKind: ReportingPeriodKind;
  /** Nombres del personal, resueltos aparte — la capa agregada no lleva PII. */
  nameByProfileId: Record<string, string>;
  /**
   * MILESTONE 26B-26F — ¿puede esta persona descargar el detalle con PII?
   *
   * Lo resuelve la página con `requireCapability("reports:export_sensitive")`,
   * que es una capacidad DISTINTA de la que abre esta sección. Llega como un
   * booleano ya decidido en el servidor: este componente no vuelve a mirar el
   * rol, porque una segunda comprobación es una segunda oportunidad de
   * discrepar con la primera.
   */
  canExportSensitive: boolean;
}

/** Los cinco pasos del embudo, en el orden del recorrido real. */
const FUNNEL_ORDER = [
  "applicant_data",
  "loan_selection",
  "financial_data",
  "documents",
  "review",
] as const;

export async function AnalyticsSection({
  data,
  activeKind,
  nameByProfileId,
  canExportSensitive,
}: AnalyticsSectionProps) {
  const t = await getTranslations("dashboard.analytics");
  const locale = await getLocale();
  const { current, comparisons } = data;
  const { coverage } = current;

  const intlLocale = locale === "en" ? "en-US" : "es-PA";
  const rangeFormatter = new Intl.DateTimeFormat(intlLocale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: coverage.period.timeZone,
  });
  // El fin almacenado es EXCLUSIVO; se resta un instante para enseñar el último
  // día que el informe realmente cubre. Mostrar «1 sep» como fin de agosto sería
  // técnicamente cierto y humanamente falso.
  const rangeLabel = `${rangeFormatter.format(coverage.period.from)} – ${rangeFormatter.format(
    new Date(coverage.period.to.getTime() - 1)
  )}`;

  const longDate = (iso: string) =>
    new Intl.DateTimeFormat(intlLocale, {
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: coverage.period.timeZone,
    }).format(new Date(iso));

  const vsLabel = t("comparison.vsPrevious");
  const noComparison = t("comparison.none");

  const approvalRate = formatRate(current.applications.approvalRate);

  // ---------------------------------------------------------------------------
  // REQUIERE ATENCIÓN — solo lo accionable, y solo con enlace donde el destino
  // muestra de verdad eso. Un enlace a una lista sin filtrar es peor que
  // ninguno: promete contexto y entrega ruido.
  // ---------------------------------------------------------------------------
  const attention = [
    {
      key: "documentsToReview",
      count: current.documents.documentsAwaitingReviewNow,
      href: "/documentos",
    },
    { key: "overdueFollowUps", count: current.followUps.overdueNow, href: undefined },
    { key: "stalledLeads", count: current.leads.stalledNow, href: undefined },
    { key: "abandonedLeads", count: current.leads.abandonedNow, href: undefined },
  ].filter((item) => item.count > 0);

  const leadSegments = [
    { key: "active", value: current.leads.activeNow, className: "bg-primary" },
    { key: "stalled", value: current.leads.stalledNow, className: "bg-warning" },
    { key: "abandoned", value: current.leads.abandonedNow, className: "bg-destructive" },
    { key: "converted", value: current.leads.converted, className: "bg-success" },
  ];
  const shares = shareOf(leadSegments.map((segment) => segment.value));

  const funnelCovered = periodIsCoveredBy(coverage.period, coverage.funnelTrackingStartedAt);
  const funnelHasData = current.funnel.some((step) => step.reached > 0 || step.completed > 0);
  const maxFunnel = Math.max(1, ...current.funnel.map((step) => step.reached));

  return (
    <div className="space-y-8">
      {/* ---------------------------------------------------------------- */}
      {/* Encabezado: qué período, y si sigue abierto                        */}
      {/* ---------------------------------------------------------------- */}
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-foreground">{t("title")}</h2>
          {/* MILESTONE 26B-26E — el selector manda y la descarga acompaña. El
              botón va aquí, junto al período que va a exportar, y no arriba
              compitiendo con las cifras: quien abre esto por la mañana viene a
              leer, no a descargar. */}
          <div className="flex flex-wrap items-center gap-3">
            <PeriodSelector activeKind={activeKind} rangeLabel={rangeLabel} />
            <PdfDownloadButton />
            {/* 26B-26F. Junto al PDF y bajo su propio permiso: ver los totales
                y llevarse los datos de las personas no son el mismo acto. */}
            {canExportSensitive && <ExcelDownloadButton />}
          </div>
        </div>

        {/* «Este mes» comparado con el mes anterior COMPLETO compara quince días
            con treinta. Sin este aviso, el informe diría que agosto cayó un 48%
            cuando agosto simplemente no ha terminado. */}
        {coverage.period.isPartial && (
          <CoverageNotice>{t("period.partialNotice")}</CoverageNotice>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard
            label={t("kpis.leads")}
            value={String(current.leads.leads)}
            comparison={comparisons.leads}
            noComparisonLabel={noComparison}
            vsLabel={vsLabel}
            footnote={t("kpis.leadsFootnote", { people: current.leads.uniquePeople })}
          />
          <MetricCard
            label={t("kpis.formalized")}
            value={String(current.applications.formalized)}
            comparison={comparisons.applicationsFormalized}
            noComparisonLabel={noComparison}
            vsLabel={vsLabel}
            footnote={t("kpis.formalizedFootnote", { created: current.applications.created })}
          />
          <MetricCard
            label={t("kpis.requested")}
            value={formatCurrency(current.financial.requestedTotal)}
            comparison={comparisons.requestedTotal}
            noComparisonLabel={noComparison}
            vsLabel={vsLabel}
          />
          <MetricCard
            label={t("kpis.approved")}
            value={
              current.financial.approvedCount === 0
                ? null
                : formatCurrency(current.financial.approvedTotal)
            }
            emptyLabel={t("kpis.approvedEmpty")}
            comparison={comparisons.approvedTotal}
            noComparisonLabel={noComparison}
            vsLabel={vsLabel}
          />
          {/* Cero aprobaciones entre cero decisiones NO es un 0%: es una
              pregunta sin denominador. Decir «0%» acusaría a ODL de rechazarlo
              todo. */}
          <MetricCard
            label={t("kpis.approvalRate")}
            value={approvalRate}
            emptyLabel={t("kpis.approvalRateEmpty")}
            footnote={
              approvalRate === null
                ? undefined
                : t("kpis.approvalRateFootnote", { decisions: current.applications.decisions })
            }
          />
          <MetricCard
            label={t("kpis.documentsToReview")}
            value={String(current.documents.documentsAwaitingReviewNow)}
            footnote={t("kpis.documentsFootnote")}
          />
        </div>
      </div>

      {/* ---------------------------------------------------------------- */}
      {/* Requiere atención                                                  */}
      {/* ---------------------------------------------------------------- */}
      <section>
        <SectionHeading title={t("attention.title")} />
        <Card>
          <CardContent>
            {attention.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
                {t("attention.allClear")}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {attention.map((item) => {
                  const body = (
                    <>
                      <AlertTriangle
                        className="size-4 shrink-0 text-warning"
                        aria-hidden="true"
                      />
                      <span className="flex-1 text-sm text-foreground">
                        {t(`attention.${item.key}`, { count: item.count })}
                      </span>
                      {item.href && (
                        <ArrowRight
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                      )}
                    </>
                  );
                  return (
                    <li key={item.key} className="py-2.5 first:pt-0 last:pb-0">
                      {item.href ? (
                        <Link
                          href={item.href}
                          className="flex items-center gap-2.5 rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                        >
                          {body}
                        </Link>
                      ) : (
                        <span className="flex items-center gap-2.5">{body}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Estado actual de las oportunidades — del PRESENTE, no del período  */}
      {/* ---------------------------------------------------------------- */}
      <section>
        <SectionHeading title={t("leadHealth.title")} description={t("leadHealth.description")} />
        <Card>
          <CardContent>
            {current.leads.leads === 0 ? (
              <NoData>{t("leadHealth.empty")}</NoData>
            ) : (
              <StackedBar
                segments={leadSegments.map((segment, index) => ({
                  label: t(`leadHealth.${segment.key}`),
                  value: segment.value,
                  share: shares[index],
                  className: segment.className,
                }))}
              />
            )}
          </CardContent>
        </Card>
      </section>

      {/* ---------------------------------------------------------------- */}
      {/* Embudo histórico — SOLO desde que hay eventos                      */}
      {/* ---------------------------------------------------------------- */}
      <section>
        <SectionHeading title={t("funnel.title")} description={t("funnel.description")} />

        {/* Sin este aviso, dieciséis solicitantes reales aparecerían como si
            nunca hubieran llegado a ningún paso. La ausencia de eventos es
            ausencia de MEDICIÓN, no ausencia de gente. */}
        {!funnelCovered && coverage.funnelTrackingStartedAt && (
          <CoverageNotice>
            {t("funnel.coverageNotice", { date: longDate(coverage.funnelTrackingStartedAt) })}
          </CoverageNotice>
        )}

        <Card>
          <CardContent>
            {!funnelHasData ? (
              <NoData>{funnelCovered ? t("funnel.emptyCovered") : t("funnel.emptyUncovered")}</NoData>
            ) : (
              <ul className="space-y-3">
                {FUNNEL_ORDER.map((step) => {
                  const row = current.funnel.find((entry) => entry.step === step);
                  if (!row) return null;
                  const rate = formatRate(row.completionRate);
                  return (
                    <li key={step}>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                        <span className="text-sm text-foreground">{t(`funnel.steps.${step}`)}</span>
                        <span className="text-xs text-muted-foreground">
                          {t("funnel.reachedCompleted", {
                            reached: row.reached,
                            completed: row.completed,
                          })}
                          {rate ? ` · ${t("funnel.conversion", { rate })}` : ""}
                        </span>
                      </div>
                      <div className="mt-1 flex h-2 gap-0.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-primary/40"
                          style={{ width: `${(row.reached / maxFunnel) * 100}%` }}
                        />
                      </div>
                      <div className="mt-0.5 flex h-2 gap-0.5 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full bg-primary"
                          style={{ width: `${(row.completed / maxFunnel) * 100}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      <ProductSection snapshot={current} />
      <FinancialSection snapshot={current} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <DocumentSection snapshot={current} />
        <ProcessSpeedSection snapshot={current} />
      </div>

      <AcquisitionSection snapshot={current} />
      <TeamSection snapshot={current} nameByProfileId={nameByProfileId} />
      <OperationsFooterSection snapshot={current} />
    </div>
  );
}
