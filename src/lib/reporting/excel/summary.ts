import type { CellKind } from "./sheet.ts";
import type { ReportingComparison } from "../types.ts";
import type { MetricComparison } from "../period.ts";

/**
 * ============================================================================
 * MILESTONE 26B-26F.1 — LA HOJA «RESUMEN», SEPARADA PARA PODER PROBARLA
 * ============================================================================
 *
 * Módulo PURO: sin `server-only`, sin `next-intl`, sin exceljs. Recibe los
 * agregados ya calculados y unas etiquetas ya traducidas, y devuelve filas.
 *
 * Se extrajo de `workbook.ts` en 26B-26F.1 porque la regla que motivó ese
 * parche —cuándo un importe aprobado es un número y cuándo es un estado— es
 * una decisión de negocio, y una decisión de negocio enterrada dentro de un
 * generador que solo corre bajo Next.js no se puede probar. Aquí sí.
 *
 * NO CALCULA NADA. Ni una suma, ni una tasa, ni una comparación. Todo llega
 * hecho de `getReportingComparison`, la misma función que pinta el Dashboard e
 * imprime el PDF. Lo único que decide este fichero es CÓMO SE PRESENTA cada
 * cifra, que es una pregunta distinta de cuánto vale.
 */

/** Los textos de la hoja, ya traducidos por quien llama. */
export interface SummaryLabels {
  leads: string;
  convertedLeads: string;
  newClients: string;
  applicationsCreated: string;
  applicationsFormalized: string;
  applicationsApproved: string;
  requestedTotal: string;
  approvedTotal: string;
  documentsUploaded: string;
  emailsSent: string;
  declined: string;
  decisions: string;
  openAtPeriodEnd: string;
  approvalRate: string;
  followUpsOpen: string;
  followUpsOverdue: string;
  /**
   * «Sin aprobaciones» / «No approvals».
   *
   * Viene de `dashboard.analytics.kpis.approvedEmpty`, la MISMA clave que ya
   * usan el Dashboard y el PDF. Se reutiliza en vez de crear una propia para
   * que la frase tenga un solo dueño: dos traducciones de la misma idea acaban
   * divergiendo, y esta es precisamente la que tiene que coincidir en las tres
   * superficies.
   */
  noApprovals: string;
  /**
   * «Sin decisiones» / «No decisions».
   *
   * De `dashboard.analytics.kpis.approvalRateEmpty`, la MISMA clave que ya usan
   * el Dashboard (`emptyLabel`) y el PDF. Igual que `noApprovals`: la frase
   * tiene un solo dueño porque es una de las que deben coincidir palabra por
   * palabra en las tres superficies.
   */
  noDecisions: string;
}

/**
 * Una fila del Resumen.
 *
 * `current` y `previous` admiten TEXTO además de número, y esa es toda la
 * corrección de 26B-26F.1. Ver `approvedAmountCell` para el porqué.
 */
export interface SummaryRow {
  label: string;
  /** El tipo de la cifra cuando la celda lleva una cifra. */
  kind: "integer" | "currency" | "percent";
  current: number | string | null;
  previous: number | string | null;
  deltaAbsolute: number | null;
  deltaPercent: number | null;
}

/**
 * ============================================================================
 * LA REGLA DE 26B-26F.1 — CERO APROBACIONES NO ES «B/. 0,00»
 * ============================================================================
 *
 * `approvedTotal` es la suma de los montos de las decisiones de aprobación del
 * período. Cuando no hubo NINGUNA aprobación, esa suma vale 0 — pero escribir
 * `B/. 0,00` en una hoja de cálculo dice algo que no es cierto: que se aprobó
 * algo y que ese algo valía cero. Son dos hechos distintos:
 *
 *   0 aprobaciones            no hubo nada que sumar
 *   aprobaciones por B/. 0,00 hubo decisiones y su importe fue nulo
 *
 * El Dashboard y el PDF ya distinguían las dos cosas —los dos escriben «Sin
 * aprobaciones» cuando `financial.approvedCount === 0`— y el Excel no. Esta
 * función cierra esa diferencia usando EL MISMO PREDICADO, no uno parecido:
 * `approvedCount`, el recuento de decisiones, y no el total.
 *
 * Cuando sí hubo aprobaciones devuelve el número tal cual, para que la celda
 * siga siendo numérica y sumable con su formato de balboa. El estado de
 * ausencia es lo único que se convierte en texto.
 */
export function approvedAmountCell(
  approvedCount: number,
  approvedTotal: number,
  noApprovalsLabel: string
): number | string {
  return approvedCount === 0 ? noApprovalsLabel : approvedTotal;
}

/**
 * ============================================================================
 * 26B-26F.2 — CERO DECISIONES NO ES «0,0 %»
 * ============================================================================
 *
 * La tasa de aprobación es aprobadas ÷ (aprobadas + no elegibles). Las
 * canceladas quedan fuera: un cierre administrativo no es un juicio sobre el
 * solicitante, y así lo define ya `reporting_application_metrics` en SQL.
 *
 * Cuando ese denominador es cero, SQL devuelve `null` — nunca 0, nunca NaN,
 * nunca Infinity — porque no hay nada que dividir. Escribir «0,0 %» ahí diría
 * que ODL miró expedientes y no aprobó ninguno, cuando lo cierto es que no
 * miró ninguno. Es la misma confusión que `approvedAmountCell` corrige para el
 * dinero, sobre la otra mitad de la misma pregunta.
 *
 * En 26B-26F la celda quedaba VACÍA. No era falso —vacío significa «no se
 * sabe»— pero el Dashboard y el PDF ya escribían «Sin decisiones», y una
 * ausencia explicada se lee mejor que un hueco, sobre todo en una hoja donde
 * un hueco también puede ser un fallo de datos.
 *
 * El `Number.isFinite` no es paranoia decorativa: es lo que garantiza que un
 * Infinity o un NaN llegado de cualquier futuro cambio en la capa de datos se
 * convierta en la frase honesta en vez de imprimirse en el informe.
 */
export function approvalRateCell(
  /** La tasa en 0–100, tal como la devuelve el contrato de reporting. */
  rate: number | null,
  noDecisionsLabel: string
): number | string {
  return rate === null || !Number.isFinite(rate) ? noDecisionsLabel : rate;
}

/**
 * El tipo de celda de un valor del Resumen.
 *
 * Una misma columna lleva recuentos, importes, tasas y —desde 26B-26F.1— algún
 * estado en texto. El tipo lo decide el VALOR, no la columna.
 */
export function summaryCellKind(
  value: number | string | null,
  rowKind: SummaryRow["kind"]
): CellKind {
  return typeof value === "string" ? "text" : rowKind;
}

function comparisonRow(
  label: string,
  kind: SummaryRow["kind"],
  comparison: MetricComparison
): SummaryRow {
  return {
    label,
    kind,
    current: comparison.current,
    previous: comparison.previous,
    deltaAbsolute: comparison.deltaAbsolute,
    // `null` cuando el período anterior fue 0. Ver MetricComparison: pasar de 0
    // a 7 no es «+700%», es un cambio sin base. La celda se queda vacía y la
    // hoja Metodología explica por qué, en vez de inventar un porcentaje.
    deltaPercent: comparison.deltaPercent,
  };
}

/** Una métrica que solo tiene lectura actual: sin comparación, y se ve. */
function currentOnlyRow(
  label: string,
  kind: SummaryRow["kind"],
  current: number | null
): SummaryRow {
  return { label, kind, current, previous: null, deltaAbsolute: null, deltaPercent: null };
}

/** Las dieciséis filas del Resumen, en el orden en que se leen. */
export function buildSummaryRows(
  reporting: ReportingComparison,
  labels: SummaryLabels
): SummaryRow[] {
  const { current, previous, comparisons } = reporting;

  // El monto aprobado se construye a mano porque sus dos celdas dependen del
  // recuento de aprobaciones DE SU PROPIO PERÍODO, no de una sola bandera.
  const approvedRow: SummaryRow = {
    label: labels.approvedTotal,
    kind: "currency",
    current: approvedAmountCell(
      current.financial.approvedCount,
      comparisons.approvedTotal.current,
      labels.noApprovals
    ),
    previous: approvedAmountCell(
      previous.financial.approvedCount,
      comparisons.approvedTotal.previous,
      labels.noApprovals
    ),
    // SIN VARIACIÓN CUANDO NO HUBO NADA QUE VARIAR. Con cero aprobaciones a los
    // dos lados, la diferencia es 0 y escribir `B/. 0,00` reintroduciría por la
    // puerta de al lado el mismo cero que esta corrección quita.
    deltaAbsolute:
      current.financial.approvedCount === 0 && previous.financial.approvedCount === 0
        ? null
        : comparisons.approvedTotal.deltaAbsolute,
    deltaPercent: comparisons.approvedTotal.deltaPercent,
  };

  // La tasa de aprobación compara con el período anterior, pero SOLO cuando los
  // dos lados tienen decisiones. El contrato agregado no publica una comparación
  // para esta métrica, así que se construye aquí a partir de dos cifras que sí
  // publica — una resta, no una segunda agregación.
  const currentRate = current.applications.approvalRate;
  const previousRate = previous.applications.approvalRate;
  const bothDecided =
    currentRate !== null &&
    Number.isFinite(currentRate) &&
    previousRate !== null &&
    Number.isFinite(previousRate);

  const approvalRateRow: SummaryRow = {
    label: labels.approvalRate,
    kind: "percent",
    current: approvalRateCell(currentRate, labels.noDecisions),
    previous: approvalRateCell(previousRate, labels.noDecisions),
    // EN PUNTOS PORCENTUALES, y solo si hay dos tasas que restar. Sin decisiones
    // a un lado no existe comparación: un «+40 %» contra la nada sería inventar
    // una mejora que nadie midió.
    deltaAbsolute: bothDecided ? currentRate - previousRate : null,
    // NUNCA una variación relativa de una tasa. Pasar del 20 % al 40 % es «+20
    // puntos»; llamarlo «+100 %» es cierto en aritmética y engañoso en un
    // informe de dirección, y el contrato no publica esa cifra por algo.
    deltaPercent: null,
  };

  return [
    comparisonRow(labels.leads, "integer", comparisons.leads),
    comparisonRow(labels.convertedLeads, "integer", comparisons.convertedLeads),
    comparisonRow(labels.newClients, "integer", comparisons.newClients),
    comparisonRow(labels.applicationsCreated, "integer", comparisons.applicationsCreated),
    comparisonRow(labels.applicationsFormalized, "integer", comparisons.applicationsFormalized),
    comparisonRow(labels.applicationsApproved, "integer", comparisons.applicationsApproved),
    comparisonRow(labels.requestedTotal, "currency", comparisons.requestedTotal),
    approvedRow,
    comparisonRow(labels.documentsUploaded, "integer", comparisons.documentsUploaded),
    comparisonRow(labels.emailsSent, "integer", comparisons.emailsSent),

    // Sin comparación en el contrato agregado: se muestran solas, con las
    // columnas de variación vacías, en vez de fabricarles un período anterior.
    currentOnlyRow(labels.declined, "integer", current.applications.declined),
    currentOnlyRow(labels.decisions, "integer", current.applications.decisions),
    currentOnlyRow(labels.openAtPeriodEnd, "integer", current.applications.openAtPeriodEnd),
    // `null` cuando no hubo ni una decisión. La celda queda vacía: un 0% diría
    // que ODL rechazó todo lo que miró, y no miró nada.
    approvalRateRow,
    currentOnlyRow(labels.followUpsOpen, "integer", current.followUps.openNow),
    currentOnlyRow(labels.followUpsOverdue, "integer", current.followUps.overdueNow),
  ];
}
