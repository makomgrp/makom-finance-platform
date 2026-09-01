import { compareMetric } from "../period.ts";
import { CURRENT_STATE_FIELDS } from "./types.ts";
import type { MetricComparison } from "../period.ts";
import type { MonthlyClosure } from "./types.ts";

/**
 * ============================================================================
 * MILESTONE 26B-26G — COMPARAR DOS MESES YA CERRADOS
 * ============================================================================
 *
 * Módulo PURO. Compara PAYLOAD contra PAYLOAD: dos fotografías que ya están
 * guardadas. NO vuelve a consultar `applications`, ni `clients`, ni ninguna
 * tabla operativa, y no llama a `getReportingComparison`.
 *
 * Esa distinción es el milestone entero. Recalcular agosto en noviembre daría
 * otro número —los datos siguen vivos— y la comparación dejaría de ser
 * histórica para volverse una consulta más. Un cierre se compara con lo que
 * decía, no con lo que hoy diríamos de él.
 *
 * ----------------------------------------------------------------------------
 * LO QUE NO ENTRA EN UN DELTA OFICIAL
 * ----------------------------------------------------------------------------
 * Las métricas de estado actual —`activeNow`, `slotsPendingNow`, `openNow`…—
 * no se miden al final de su mes, sino en el instante en que se generó cada
 * cierre. Restar «activas de agosto» menos «activas de septiembre» produciría
 * un número con aspecto de tendencia que en realidad compara dos momentos
 * arbitrarios.
 *
 * Se excluyen APOYÁNDOSE EN EL MANIFIESTO del cierre, no en una convención de
 * nombres: si mañana aparece una métrica «now» que no acaba en `Now`, seguirá
 * quedando fuera porque el manifiesto la nombra. Su valor sigue accesible en
 * el payload para quien lo pida a sabiendas; lo que no hace es colarse en los
 * deltas.
 */

/** Las rutas escalares que SÍ son comparables entre meses. */
const COMPARABLE_PATHS = [
  "leads.leads",
  "leads.uniquePeople",
  "leads.unresolvedIntakes",
  "leads.converted",
  "leads.resumedEvents",
  "newClients.total",
  "newClients.fromPortal",
  "newClients.manual",
  "newClients.otherChannels",
  "applications.created",
  "applications.formalized",
  "applications.approved",
  "applications.declined",
  "applications.cancelled",
  "applications.decisions",
  // Genuinamente as-of: se calcula al final del período, no contra `now()`.
  "applications.openAtPeriodEnd",
  "applications.approvalRate",
  "financial.requestedCount",
  "financial.requestedTotal",
  "financial.requestedAverage",
  "financial.requestedMedian",
  "financial.approvedCount",
  "financial.approvedTotal",
  "financial.approvedAverage",
  "financial.approvedMedian",
  "documents.uploadedInPeriod",
  "documents.applicationsWithUploads",
  "documents.reviewedInPeriod",
  "followUps.createdInPeriod",
  "followUps.completedInPeriod",
  "communications.emailsSent",
  "communications.emailsReceived",
  "communications.emailsLinked",
  "communications.emailsUnlinked",
] as const;

export type ComparablePath = (typeof COMPARABLE_PATHS)[number];

/** Lee una ruta con puntos. Devuelve `null` ante cualquier cosa que no sea número. */
function readNumber(source: unknown, path: string): number | null {
  let cursor: unknown = source;
  for (const segment of path.split(".")) {
    if (!cursor || typeof cursor !== "object") return null;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return typeof cursor === "number" && Number.isFinite(cursor) ? cursor : null;
}

/**
 * La comparación de una métrica entre dos cierres.
 *
 * `null` en `current` o `previous` significa «no se sabe», y se propaga: no
 * hay delta contra lo desconocido. Es la misma regla que el resto del proyecto
 * — un `null` no se convierte en 0 para que la resta funcione.
 */
export interface ClosureMetricDelta {
  path: string;
  current: number | null;
  previous: number | null;
  comparison: MetricComparison | null;
}

export interface MonthlyClosureComparison {
  currentPeriodKey: string;
  previousPeriodKey: string;
  metrics: ClosureMetricDelta[];
  /** Nombradas, para que una superficie futura pueda explicar la ausencia. */
  excludedCurrentStateFields: readonly string[];
}

/**
 * Compara dos cierres ya persistidos.
 *
 * El orden importa: `current` es el mes más reciente y `previous` aquel contra
 * el que se mide. No se ordenan solos — quien llama sabe qué está preguntando.
 */
export function compareMonthlyClosures(
  current: MonthlyClosure,
  previous: MonthlyClosure
): MonthlyClosureComparison {
  const metrics: ClosureMetricDelta[] = COMPARABLE_PATHS.map((path) => {
    const currentValue = readNumber(current.payload.snapshot, path);
    const previousValue = readNumber(previous.payload.snapshot, path);

    return {
      path,
      current: currentValue,
      previous: previousValue,
      // Sin las dos cifras no hay comparación. `compareMetric` ya aplica la
      // regla de 26B-26C: `deltaPercent` es null cuando el anterior fue 0,
      // porque pasar de 0 a 7 no es «+700%» sino un cambio sin base.
      comparison:
        currentValue === null || previousValue === null
          ? null
          : compareMetric(currentValue, previousValue),
    };
  });

  return {
    currentPeriodKey: current.periodKey,
    previousPeriodKey: previous.periodKey,
    metrics,
    excludedCurrentStateFields: CURRENT_STATE_FIELDS,
  };
}

/** Para pruebas y para cualquier superficie que quiera explicar la exclusión. */
export function isComparablePath(path: string): boolean {
  return (COMPARABLE_PATHS as readonly string[]).includes(path);
}

export { COMPARABLE_PATHS };
