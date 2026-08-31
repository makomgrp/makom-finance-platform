import "server-only";
import PDFDocument from "pdfkit";
import { getTranslations } from "next-intl/server";
import { formatCurrency } from "@/lib/format";
import { BUSINESS_TIME_ZONE } from "@/lib/config/business-time";
import {
  formatDeltaPercent,
  formatDurationHours,
  formatRate,
  periodIsCoveredBy,
} from "@/lib/reporting/presentation";
import {
  bullet,
  calloutBox,
  INK,
  kpiGrid,
  note,
  PAGE,
  sectionTitle,
  statRow,
  table,
} from "./layout";
import type { ReportingComparison } from "@/lib/reporting/types";
import type { MetricComparison } from "@/lib/reporting/period";
import type { Locale } from "@/i18n/config";
export { executiveReportFilename } from "./filename";

/**
 * ============================================================================
 * MILESTONE 26B-26E — EL INFORME EJECUTIVO EN PDF
 * ============================================================================
 *
 * MISMA FUENTE DE VERDAD QUE LA PANTALLA, SIN EXCEPCIÓN. Este módulo recibe el
 * `ReportingComparison` que produce `getReportingComparison` y no calcula ni
 * una sola métrica. No hay SQL propio, no hay agregación paralela, no se leen
 * valores del DOM y no se captura ninguna imagen del Dashboard.
 *
 * La consecuencia es la que ODL necesita: el mismo período da el mismo número
 * en SQL, en pantalla y en papel. Si alguna vez discrepan, el defecto está en
 * la capa de 26B-26C — que es exactamente donde se puede arreglar una vez.
 *
 * ----------------------------------------------------------------------------
 * LAS MISMAS REGLAS DE HONESTIDAD, EN PAPEL
 * ----------------------------------------------------------------------------
 * Un PDF sobrevive a la conversación que lo acompañaba. Se imprime, se reenvía
 * y se lee meses después sin nadie al lado para matizarlo, así que las
 * salvedades tienen que estar DENTRO del documento:
 *
 *   * `null` nunca se convierte en cero — «Sin decisiones», no «0%»;
 *   * los cortes de medición se declaran donde afectan;
 *   * lo que es fotografía del presente se etiqueta como tal;
 *   * el monto aprobado no es dinero entregado, y lo dice el propio informe.
 *
 * La última sección resume la metodología completa, para que el documento sea
 * auditable por sí solo.
 */

export interface ExecutiveReportInput {
  data: ReportingComparison;
  locale: Locale;
  /**
   * Nombres del personal, resueltos por el llamador contra el directorio que ya
   * puede leer.
   *
   * LA CAPA AGREGADA NO LOS LLEVA, y no debe. Un perfil sin nombre resuelto se
   * OMITE de la tabla en lugar de imprimir su identificador: un UUID en un
   * documento que se reenvía no informa a nadie y expone un dato interno.
   */
  nameByProfileId: Record<string, string>;
}

/** Nombre de producto legible. Nunca un UUID en un documento que se reenvía. */
function productLabel(code: string, applicationCode: string | null): string {
  const readable = code
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  return applicationCode ? `${readable} (${applicationCode})` : readable;
}

function intlLocale(locale: Locale): string {
  return locale === "en" ? "en-US" : "es-PA";
}

/**
 * Genera el PDF completo y devuelve sus bytes.
 *
 * Se acumula en memoria en vez de transmitirse: un informe de dirección son
 * decenas de kilobytes, y tenerlo entero permite responder con un
 * `Content-Length` exacto y —lo que importa— fallar ANTES de haber enviado
 * medio archivo. Un PDF truncado es peor que un error.
 */
export async function renderExecutiveReport(input: ExecutiveReportInput): Promise<Buffer> {
  const { data, locale, nameByProfileId } = input;
  const { current, comparisons } = data;
  const { coverage } = current;

  const t = await getTranslations({ locale, namespace: "dashboard.analytics" });
  const tPdf = await getTranslations({ locale, namespace: "dashboard.analytics.pdf" });

  const dateFormatter = new Intl.DateTimeFormat(intlLocale(locale), {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: BUSINESS_TIME_ZONE,
  });
  const stampFormatter = new Intl.DateTimeFormat(intlLocale(locale), {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: BUSINESS_TIME_ZONE,
  });

  const periodLabel = `${dateFormatter.format(coverage.period.from)} – ${dateFormatter.format(
    // El fin almacenado es EXCLUSIVO; se resta un instante para nombrar el
    // último día que el informe cubre de verdad.
    new Date(coverage.period.to.getTime() - 1)
  )}`;

  const doc = new PDFDocument({
    size: PAGE.size,
    margin: PAGE.margin,
    bufferPages: true,
    info: {
      Title: tPdf("documentTitle"),
      Author: "ODL Financial Corporation",
      Subject: periodLabel,
      // Sin nombre de usuario: el documento circula y no debe cargar con quién
      // lo pidió.
      Creator: "ODL LoanFlow CRM",
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const finished = new Promise<void>((resolve) => doc.on("end", () => resolve()));

  // --------------------------------------------------------------------------
  // PORTADA / ENCABEZADO
  // --------------------------------------------------------------------------
  doc
    .font("Helvetica-Bold")
    .fontSize(20)
    .fillColor(INK.accent)
    .text("ODL Financial Corporation", PAGE.margin, PAGE.margin);
  doc
    .font("Helvetica")
    .fontSize(13)
    .fillColor(INK.body)
    .text(tPdf("documentTitle"), { width: PAGE.contentWidth });
  doc.moveDown(0.8);

  doc
    .font("Helvetica-Bold")
    .fontSize(9.5)
    .fillColor(INK.body)
    .text(`${tPdf("periodLabel")}: `, { continued: true })
    .font("Helvetica")
    .text(periodLabel);
  doc
    .font("Helvetica-Bold")
    .fontSize(9.5)
    .text(`${tPdf("generatedLabel")}: `, { continued: true })
    .font("Helvetica")
    // SIEMPRE en hora de Panamá. Vercel corre en UTC y un informe fechado en
    // UTC diría una hora que nadie en ODL reconoce.
    .text(`${stampFormatter.format(new Date())} (${BUSINESS_TIME_ZONE})`);
  doc
    .font("Helvetica")
    .fontSize(8)
    .fillColor(INK.muted)
    .text(tPdf("internalUse"));
  doc.moveDown(1);
  doc.fillColor(INK.body);

  if (coverage.period.isPartial) {
    calloutBox(doc, t("period.partialNotice"));
  }

  // --------------------------------------------------------------------------
  // RESUMEN EJECUTIVO — las mismas seis cifras de la pantalla
  // --------------------------------------------------------------------------
  const noComparison = t("comparison.none");
  const vs = t("comparison.vsPrevious");
  const caption = (comparison: MetricComparison): string => {
    const percent = formatDeltaPercent(comparison);
    return percent === null ? noComparison : `${percent} ${vs}`;
  };

  const approvalRate = formatRate(current.applications.approvalRate);

  sectionTitle(doc, tPdf("summaryTitle"), 140);
  kpiGrid(doc, [
    {
      label: t("kpis.leads"),
      value: String(current.leads.leads),
      caption: caption(comparisons.leads),
      footnote: t("kpis.leadsFootnote", { people: current.leads.uniquePeople }),
    },
    {
      label: t("kpis.formalized"),
      value: String(current.applications.formalized),
      caption: caption(comparisons.applicationsFormalized),
      footnote: t("kpis.formalizedFootnote", { created: current.applications.created }),
    },
    {
      label: t("kpis.requested"),
      value: formatCurrency(current.financial.requestedTotal),
      caption: caption(comparisons.requestedTotal),
    },
    {
      label: t("kpis.approved"),
      value:
        current.financial.approvedCount === 0
          ? t("kpis.approvedEmpty")
          : formatCurrency(current.financial.approvedTotal),
      caption: caption(comparisons.approvedTotal),
    },
    {
      // Cero aprobaciones entre cero decisiones NO es un 0%: es una pregunta
      // sin denominador, y en papel esa distinción no la puede aclarar nadie
      // después.
      label: t("kpis.approvalRate"),
      value: approvalRate ?? t("kpis.approvalRateEmpty"),
      caption: approvalRate
        ? t("kpis.approvalRateFootnote", { decisions: current.applications.decisions })
        : undefined,
    },
    {
      label: t("kpis.documentsToReview"),
      value: String(current.documents.documentsAwaitingReviewNow),
      caption: t("kpis.documentsFootnote"),
    },
  ]);

  // Comparación explícita: actual, anterior y variación en una tabla, para que
  // el lector no dependa solo del pie de cada tarjeta.
  sectionTitle(doc, tPdf("comparisonTitle"), 120);
  const comparisonRows: [string, MetricComparison][] = [
    [t("kpis.leads"), comparisons.leads],
    [t("kpis.formalized"), comparisons.applicationsFormalized],
    [t("kpis.requested"), comparisons.requestedTotal],
    [t("kpis.approved"), comparisons.approvedTotal],
  ];
  const money = new Set([t("kpis.requested"), t("kpis.approved")]);
  table(
    doc,
    [
      { header: tPdf("metric"), width: 190 },
      { header: tPdf("currentPeriod"), width: 100, align: "right" },
      { header: tPdf("previousPeriod"), width: 100, align: "right" },
      { header: tPdf("change"), width: 109, align: "right" },
    ],
    comparisonRows.map(([label, comparison]) => [
      label,
      money.has(label) ? formatCurrency(comparison.current) : String(comparison.current),
      money.has(label) ? formatCurrency(comparison.previous) : String(comparison.previous),
      formatDeltaPercent(comparison) ?? noComparison,
    ])
  );
  note(doc, tPdf("comparisonNote"));

  // --------------------------------------------------------------------------
  // REQUIERE ATENCIÓN
  // --------------------------------------------------------------------------
  const attention = [
    { key: "documentsToReview", count: current.documents.documentsAwaitingReviewNow },
    { key: "overdueFollowUps", count: current.followUps.overdueNow },
    { key: "stalledLeads", count: current.leads.stalledNow },
    { key: "abandonedLeads", count: current.leads.abandonedNow },
  ].filter((item) => item.count > 0);

  sectionTitle(doc, t("attention.title"), 40);
  if (attention.length === 0) {
    note(doc, t("attention.allClear"));
  } else {
    attention.forEach((item) => bullet(doc, t(`attention.${item.key}`, { count: item.count })));
    doc.moveDown(0.4);
  }

  // --------------------------------------------------------------------------
  // ESTADO ACTUAL DE LAS OPORTUNIDADES
  // --------------------------------------------------------------------------
  sectionTitle(doc, t("leadHealth.title"), 60);
  note(doc, t("leadHealth.description"));
  statRow(doc, [
    { label: t("leadHealth.active"), value: String(current.leads.activeNow) },
    { label: t("leadHealth.stalled"), value: String(current.leads.stalledNow) },
    { label: t("leadHealth.abandoned"), value: String(current.leads.abandonedNow) },
    { label: t("leadHealth.converted"), value: String(current.leads.converted) },
  ]);

  // --------------------------------------------------------------------------
  // PRODUCTOS
  // --------------------------------------------------------------------------
  sectionTitle(doc, t("products.title"), 110);
  table(
    doc,
    [
      { header: t("products.product"), width: 149 },
      { header: t("products.created"), width: 52, align: "right" },
      { header: t("products.formalized"), width: 62, align: "right" },
      { header: t("products.approved"), width: 56, align: "right" },
      { header: t("products.declined"), width: 56, align: "right" },
      { header: t("products.requested"), width: 62, align: "right" },
      { header: t("products.approvedAmount"), width: 62, align: "right" },
    ],
    // Los productos sin actividad se quedan: «el producto E no vendió nada» es
    // un dato, y una fila ausente se lee como si el producto no existiera.
    current.products.map((row) => [
      productLabel(row.productCode, row.applicationCode),
      String(row.created),
      String(row.formalized),
      String(row.approved),
      String(row.declined),
      formatCurrency(row.requestedTotal),
      formatCurrency(row.approvedTotal),
    ])
  );

  // --------------------------------------------------------------------------
  // MONTOS
  // --------------------------------------------------------------------------
  sectionTitle(doc, t("financial.title"), 100);
  statRow(doc, [
    { label: t("financial.requestedTotal"), value: formatCurrency(current.financial.requestedTotal) },
    {
      label: t("financial.requestedMedian"),
      value:
        current.financial.requestedMedian === null
          ? t("financial.noData")
          : formatCurrency(current.financial.requestedMedian),
    },
    {
      label: t("financial.approvedTotal"),
      value:
        current.financial.approvedCount === 0
          ? t("financial.noApprovals")
          : formatCurrency(current.financial.approvedTotal),
    },
    {
      label: t("financial.approvedMedian"),
      value:
        current.financial.approvedMedian === null
          ? t("financial.noData")
          : formatCurrency(current.financial.approvedMedian),
    },
  ]);
  // La salvedad más importante del documento, y va donde se lee el número.
  note(doc, t("financial.notDisbursedNote"));

  // --------------------------------------------------------------------------
  // DOCUMENTOS
  // --------------------------------------------------------------------------
  const d = current.documents;
  sectionTitle(doc, t("documents.title"), 110);
  statRow(doc, [
    { label: t("documents.uploadedInPeriod"), value: String(d.uploadedInPeriod) },
    { label: t("documents.awaitingReviewNow"), value: String(d.documentsAwaitingReviewNow) },
  ]);
  note(doc, t("documents.slotsNowLabel"));
  table(
    doc,
    [
      { header: t("documents.slots.pending"), width: 71, align: "right" },
      { header: t("documents.slots.submitted"), width: 71, align: "right" },
      { header: t("documents.slots.underReview"), width: 71, align: "right" },
      { header: t("documents.slots.satisfied"), width: 71, align: "right" },
      { header: t("documents.slots.rejected"), width: 71, align: "right" },
      { header: t("documents.slots.waived"), width: 71, align: "right" },
      { header: t("documents.slots.missing"), width: 73, align: "right" },
    ],
    [
      [
        String(d.slotsPendingNow),
        String(d.slotsSubmittedNow),
        String(d.slotsUnderReviewNow),
        String(d.slotsSatisfiedNow),
        String(d.slotsRejectedNow),
        String(d.slotsWaivedNow),
        String(d.slotsMissingNow),
      ],
    ]
  );

  // --------------------------------------------------------------------------
  // TIEMPOS DE PROCESO
  // --------------------------------------------------------------------------
  const tUnits = await getTranslations({ locale, namespace: "dashboard.analytics.units" });
  const duration = (hours: number | null): string => {
    const formatted = formatDurationHours(hours);
    return formatted ? tUnits(formatted.unit, { value: formatted.value }) : "—";
  };

  sectionTitle(doc, t("speed.title"), 110);
  table(
    doc,
    [
      { header: tPdf("process"), width: 235 },
      { header: tPdf("cases"), width: 88, align: "right" },
      { header: tPdf("median"), width: 88, align: "right" },
      { header: tPdf("p90"), width: 88, align: "right" },
    ],
    current.processDurations.map((row) =>
      row.sampleCount === 0
        ? [t(`speed.metrics.${row.metric}`), "0", t("speed.noSamples"), "—"]
        : [
            t(`speed.metrics.${row.metric}`),
            String(row.sampleCount),
            duration(row.medianHours),
            duration(row.p90Hours),
          ]
    )
  );

  // --------------------------------------------------------------------------
  // EMBUDO
  // --------------------------------------------------------------------------
  const funnelCovered = periodIsCoveredBy(coverage.period, coverage.funnelTrackingStartedAt);
  sectionTitle(doc, t("funnel.title"), 120);
  if (!funnelCovered && coverage.funnelTrackingStartedAt) {
    // Sin esto, cinco ceros harían creer que nadie recorrió el formulario. La
    // ausencia de eventos es ausencia de MEDICIÓN, no de gente.
    calloutBox(
      doc,
      t("funnel.coverageNotice", {
        date: dateFormatter.format(new Date(coverage.funnelTrackingStartedAt)),
      })
    );
  }
  const funnelHasData = current.funnel.some((step) => step.reached > 0 || step.completed > 0);
  if (!funnelHasData) {
    note(doc, funnelCovered ? t("funnel.emptyCovered") : t("funnel.emptyUncovered"));
  } else {
    table(
      doc,
      [
        { header: tPdf("step"), width: 235 },
        { header: tPdf("reached"), width: 88, align: "right" },
        { header: tPdf("completed"), width: 88, align: "right" },
        { header: tPdf("conversion"), width: 88, align: "right" },
      ],
      current.funnel.map((step) => [
        t(`funnel.steps.${step.step}`),
        String(step.reached),
        String(step.completed),
        formatRate(step.completionRate) ?? "—",
      ])
    );
  }

  // --------------------------------------------------------------------------
  // ADQUISICIÓN
  // --------------------------------------------------------------------------
  const attributionCovered = periodIsCoveredBy(
    coverage.period,
    coverage.attributionTrackingStartedAt
  );
  sectionTitle(doc, t("acquisition.title"), 110);
  if (!attributionCovered && coverage.attributionTrackingStartedAt) {
    calloutBox(
      doc,
      t("acquisition.coverageNotice", {
        date: dateFormatter.format(new Date(coverage.attributionTrackingStartedAt)),
      })
    );
  }
  // TRES poblaciones, nunca dos: fundir «sin medir» con «directas» convertiría
  // una ausencia de medición en una medición.
  statRow(doc, [
    { label: t("acquisition.unmeasured"), value: String(current.attributionCoverage.unmeasured) },
    {
      label: t("acquisition.measuredWithoutUtm"),
      value: String(current.attributionCoverage.measuredWithoutUtm),
    },
    {
      label: t("acquisition.measuredWithUtm"),
      value: String(current.attributionCoverage.measuredWithUtm),
    },
  ]);
  if (current.attribution.length === 0) {
    note(doc, t("acquisition.noCampaigns"));
  } else {
    table(
      doc,
      [
        { header: tPdf("source"), width: 130 },
        { header: tPdf("campaign"), width: 143 },
        { header: t("products.created"), width: 55, align: "right" },
        { header: t("products.formalized"), width: 65, align: "right" },
        { header: t("products.requested"), width: 66, align: "right" },
        { header: t("products.approvedAmount"), width: 40, align: "right" },
      ],
      current.attribution.slice(0, 12).map((row) => [
        row.utmSource ?? row.referrerHost ?? t("acquisition.directArrival"),
        row.utmCampaign ?? "—",
        String(row.leads),
        String(row.formalized),
        formatCurrency(row.requestedTotal),
        formatCurrency(row.approvedTotal),
      ])
    );
  }

  // --------------------------------------------------------------------------
  // EQUIPO — sin clasificación, sin tasa por persona
  // --------------------------------------------------------------------------
  const teamRows = current.team.filter(
    (row) =>
      nameByProfileId[row.profileId] &&
      (row.assignedOpenNow > 0 || row.formalizedInPeriod > 0 || row.followUpsOpenNow > 0)
  );
  sectionTitle(doc, t("team.title"), 60);
  if (teamRows.length === 0) {
    // Sin actividad no se imprime una tabla de nombres: un listado de personas
    // con ceros no informa de nada y sí expone al equipo sin motivo.
    note(doc, t("team.noAssignments"));
  } else {
    note(doc, t("team.description"));
    table(
      doc,
      [
        { header: t("team.person"), width: 199 },
        { header: t("team.assignedOpen"), width: 75, align: "right" },
        { header: t("team.formalized"), width: 75, align: "right" },
        { header: t("team.decisions"), width: 75, align: "right" },
        { header: t("team.followUpsOpen"), width: 75, align: "right" },
      ],
      teamRows.map((row) => [
        // El identificador técnico NO llega al papel. El filtro de arriba ya
        // descartó cualquier fila sin nombre resuelto.
        nameByProfileId[row.profileId],
        String(row.assignedOpenNow),
        String(row.formalizedInPeriod),
        String(row.approvedInPeriod + row.declinedInPeriod),
        String(row.followUpsOpenNow),
      ])
    );
  }

  // --------------------------------------------------------------------------
  // SEGUIMIENTOS Y CORREO
  // --------------------------------------------------------------------------
  sectionTitle(doc, t("followUps.title"), 55);
  statRow(doc, [
    { label: t("followUps.openNow"), value: String(current.followUps.openNow) },
    { label: t("followUps.overdueNow"), value: String(current.followUps.overdueNow) },
    { label: t("followUps.created"), value: String(current.followUps.createdInPeriod) },
    { label: t("followUps.completed"), value: String(current.followUps.completedInPeriod) },
  ]);

  sectionTitle(doc, t("communications.title"), 55);
  statRow(doc, [
    { label: t("communications.sent"), value: String(current.communications.emailsSent) },
    { label: t("communications.received"), value: String(current.communications.emailsReceived) },
    { label: t("communications.linked"), value: String(current.communications.emailsLinked) },
    { label: t("communications.unlinked"), value: String(current.communications.emailsUnlinked) },
  ]);
  note(doc, tPdf("communicationsNote"));

  // --------------------------------------------------------------------------
  // COBERTURA Y METODOLOGÍA — lo que hace el documento auditable por sí solo
  // --------------------------------------------------------------------------
  sectionTitle(doc, tPdf("methodologyTitle"), 150);
  const methodology = [
    tPdf("methodTimezone", { zone: BUSINESS_TIME_ZONE }),
    tPdf("methodPeriod"),
    tPdf("methodApprovalRate"),
    coverage.funnelTrackingStartedAt
      ? tPdf("methodFunnel", { date: dateFormatter.format(new Date(coverage.funnelTrackingStartedAt)) })
      : tPdf("methodFunnelNone"),
    coverage.attributionTrackingStartedAt
      ? tPdf("methodAttribution", {
          date: dateFormatter.format(new Date(coverage.attributionTrackingStartedAt)),
        })
      : tPdf("methodAttributionNone"),
    tPdf("methodApprovedNotDisbursed"),
    tPdf("methodSnapshotVsPeriod"),
    tPdf("methodUnavailable"),
  ];
  methodology.forEach((line) => bullet(doc, line));

  // --------------------------------------------------------------------------
  // PIE DE PÁGINA EN TODAS LAS PÁGINAS
  // --------------------------------------------------------------------------
  // Se escribe al final, cuando ya se sabe cuántas páginas hay: «Página 3 de 7»
  // no se puede escribir mientras se dibuja la 3.
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);

    // EL MARGEN INFERIOR SE ANULA ANTES DE ESCRIBIR EL PIE, y no es un detalle
    // cosmético: pdfkit pagina solo en cuanto un texto rebasa ese margen. El pie
    // va deliberadamente por debajo de él, así que sin esto CADA llamada de
    // texto del pie añadía una página nueva — que a su vez recibía pie, y así.
    // El primer PDF salió con seis páginas vacías por exactamente esto.
    doc.page.margins.bottom = 0;

    const y = 841.89 - PAGE.margin + 6;
    doc
      .moveTo(PAGE.margin, y - 8)
      .lineTo(PAGE.margin + PAGE.contentWidth, y - 8)
      .lineWidth(0.4)
      .strokeColor(INK.hairline)
      .stroke();
    doc
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor(INK.muted)
      .text("ODL Financial Corporation", PAGE.margin, y, {
        width: PAGE.contentWidth / 2,
        lineBreak: false,
      });
    doc.text(
      tPdf("pageOf", { page: i + 1, total: range.count }),
      PAGE.margin + PAGE.contentWidth / 2,
      y,
      { width: PAGE.contentWidth / 2, align: "right", lineBreak: false }
    );
  }

  doc.end();
  await finished;
  return Buffer.concat(chunks);
}
