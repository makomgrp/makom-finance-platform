import type { MetricComparison, ReportingPeriod } from "./period.ts";

/**
 * ============================================================================
 * MILESTONE 26B-26D — CÓMO SE LEE UNA CIFRA QUE NO EXISTE
 * ============================================================================
 *
 * Funciones puras entre el contrato de 26B-26C y la pantalla. Aquí no se
 * calcula ninguna métrica: se decide cómo se PRESENTA una respuesta que puede
 * ser «no se puede saber».
 *
 * Es el punto donde un informe honesto se distingue de uno que miente sin
 * querer. `null` en el contrato significa «no hay base para responder», y la
 * tentación en la UI es siempre pintar un 0 porque encaja mejor en la tarjeta.
 * Un 0% de aprobación cuando no ha habido ninguna decisión no es un dato
 * conservador: es una afirmación falsa sobre el trabajo de ODL.
 */

export type DeltaDirection = "up" | "down" | "flat" | "none";

/**
 * `none` cuando no hay comparación posible, y es distinto de `flat`.
 *
 * `flat` dice «se mantuvo igual», que es información. `none` dice «no hay con
 * qué comparar», que es la ausencia de información. Pintar las dos con la misma
 * rayita horizontal las volvería indistinguibles.
 */
export function deltaDirection(comparison: MetricComparison): DeltaDirection {
  if (comparison.deltaPercent === null) return "none";
  if (comparison.deltaAbsolute > 0) return "up";
  if (comparison.deltaAbsolute < 0) return "down";
  return "flat";
}

/**
 * El porcentaje con signo, redondeado a un decimal, o `null`.
 *
 * UN SOLO DECIMAL a propósito: «+12.3%» se lee de un vistazo y «+12.347%»
 * sugiere una precisión que estos volúmenes no tienen. Con quince solicitudes,
 * el tercer decimal es ruido presentado como exactitud.
 */
export function formatDeltaPercent(comparison: MetricComparison): string | null {
  if (comparison.deltaPercent === null) return null;
  const rounded = Math.round(comparison.deltaPercent * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded}%`;
}

/**
 * Una tasa (0–100) redondeada a un decimal, o `null` si no existe.
 *
 * NO CONVIERTE `null` EN 0. Una tasa de aprobación nula significa que no hubo
 * ninguna decisión, y ODL debe leer «Sin decisiones», no «0%».
 */
export function formatRate(rate: number | null): string | null {
  if (rate === null || !Number.isFinite(rate)) return null;
  return `${Math.round(rate * 10) / 10}%`;
}

/**
 * Horas → una duración legible.
 *
 * Cambia de unidad según la magnitud porque «0.53 horas» no es una respuesta
 * que nadie use: por debajo de una hora manda los minutos, por encima de dos
 * días mandan los días. `null` sigue siendo `null` — una duración sin muestras
 * no es cero, es una pregunta sin datos.
 */
export function formatDurationHours(hours: number | null): { value: number; unit: "minutes" | "hours" | "days" } | null {
  if (hours === null || !Number.isFinite(hours) || hours < 0) return null;
  if (hours < 1) return { value: Math.round(hours * 60), unit: "minutes" };
  if (hours < 48) return { value: Math.round(hours * 10) / 10, unit: "hours" };
  return { value: Math.round((hours / 24) * 10) / 10, unit: "days" };
}

/**
 * ¿Cubre el período medido lo que este informe va a afirmar?
 *
 * La regla es estricta a propósito: el período debe EMPEZAR en o después del
 * corte. Un período que arranca antes contiene un tramo sin medir, y
 * presentarlo como cobertura completa es lo que haría que un informe de agosto
 * mostrara un embudo vacío y pareciera que nadie usó el formulario — cuando lo
 * cierto es que todavía no se medía.
 *
 * Es la misma regla que aplica el servicio; se repite aquí como función pura
 * para poder probarla y para que la UI pueda razonar sin volver a consultar.
 */
export function periodIsCoveredBy(period: ReportingPeriod, startedAt: string | null): boolean {
  if (!startedAt) return false;
  const cutoff = new Date(startedAt).getTime();
  if (!Number.isFinite(cutoff)) return false;
  return period.from.getTime() >= cutoff;
}

/**
 * Reparto de un total en porcentajes de anchura para una barra apilada.
 *
 * Devuelve ceros cuando el total es cero en vez de dividir: una barra de un
 * conjunto vacío no es una barra llena de nada, es una barra que no se dibuja.
 */
export function shareOf(values: number[]): number[] {
  const total = values.reduce((sum, value) => sum + Math.max(0, value), 0);
  if (total <= 0) return values.map(() => 0);
  return values.map((value) => (Math.max(0, value) / total) * 100);
}
