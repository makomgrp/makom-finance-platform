import {
  buildCustomPeriod,
  resolveNamedPeriod,
  type ReportingPeriod,
  type ReportingPeriodKind,
} from "./period.ts";

/**
 * ============================================================================
 * MILESTONE 26B-26D — EL PERÍODO VIAJA EN LA URL
 * ============================================================================
 *
 * `/dashboard?periodo=este_mes` en vez de estado en el cliente, por tres
 * razones prácticas: recargar no pierde lo que estabas mirando, el enlace se
 * puede pegar en un chat a un compañero, y un Server Component puede resolverlo
 * sin esperar a que el navegador le cuente nada.
 *
 * ----------------------------------------------------------------------------
 * TODO LO QUE ENTRA ES BASURA HASTA QUE SE DEMUESTRE LO CONTRARIO
 * ----------------------------------------------------------------------------
 * Un query param lo escribe cualquiera. Aquí no se valida "por si acaso": se
 * valida porque `?periodo=<script>` y `?desde=99999-99-99` van a llegar. Nada
 * sale de este módulo que no sea un `ReportingPeriod` construido por el modelo
 * de 26B-26C, y un valor irreconocible cae al mes en curso en lugar de romper
 * la pantalla o —peor— consultar un rango absurdo.
 *
 * LOS NOMBRES DE PARÁMETRO VAN EN ESPAÑOL porque el CRM ya usa `?sucursal=` en
 * esta misma página. Mezclar `?sucursal=` con `?period=` en una URL sería una
 * incoherencia visible para quien la lea.
 */

/** El valor por defecto: la vista gerencial natural es el mes en curso. */
export const DEFAULT_PERIOD_KIND: ReportingPeriodKind = "this_month";

/**
 * Vocabulario público ↔ interno.
 *
 * Se mantiene una tabla explícita en vez de aceptar el nombre interno
 * directamente: la URL es una superficie pública y su vocabulario no tiene por
 * qué quedar atado al de la capa de datos. Cambiar uno no arrastra al otro.
 */
const PERIOD_PARAM_TO_KIND: Record<string, ReportingPeriodKind> = {
  hoy: "today",
  ayer: "yesterday",
  esta_semana: "this_week",
  este_mes: "this_month",
  este_trimestre: "this_quarter",
  este_ano: "this_year",
  personalizado: "custom",
};

const KIND_TO_PERIOD_PARAM: Record<ReportingPeriodKind, string> = {
  today: "hoy",
  yesterday: "ayer",
  this_week: "esta_semana",
  this_month: "este_mes",
  this_quarter: "este_trimestre",
  this_year: "este_ano",
  custom: "personalizado",
};

/** El orden en que se ofrecen, de más corto a más largo. */
export const SELECTABLE_PERIOD_KINDS: ReportingPeriodKind[] = [
  "today",
  "yesterday",
  "this_week",
  "this_month",
  "this_quarter",
  "this_year",
];

export function periodParamFor(kind: ReportingPeriodKind): string {
  return KIND_TO_PERIOD_PARAM[kind];
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * `YYYY-MM-DD` → componentes de fecha, o `undefined`.
 *
 * COMPRUEBA QUE LA FECHA EXISTE, no solo que tenga la forma. `2026-02-31`
 * encaja con el patrón y no es un día: sin esta vuelta, `startOfBusinessDay`
 * lo normalizaría en silencio al 3 de marzo y el informe cubriría un rango que
 * nadie pidió.
 */
function parseIsoDate(raw: string | undefined): { year: number; month: number; day: number } | undefined {
  if (typeof raw !== "string") return undefined;
  const match = ISO_DATE.exec(raw.trim());
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return undefined;

  // Vuelta de comprobación: si los componentes no sobreviven al calendario, la
  // fecha no existía.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() + 1 !== month ||
    probe.getUTCDate() !== day
  ) {
    return undefined;
  }

  // Un rango razonable para un CRM de préstamos. Fuera de esto es un error de
  // tecleo o alguien probando, y en ninguno de los dos casos hay un informe que
  // devolver.
  if (year < 2000 || year > 2200) return undefined;

  return { year, month, day };
}

export interface PeriodParams {
  periodo?: string | string[];
  desde?: string | string[];
  hasta?: string | string[];
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export interface ResolvedPeriodSelection {
  period: ReportingPeriod;
  /** Lo que el selector debe mostrar marcado. */
  kind: ReportingPeriodKind;
  /**
   * `true` cuando lo que llegó en la URL no era utilizable y se cayó al valor
   * por defecto. La pantalla no monta un error por esto —un enlace viejo sigue
   * abriendo algo útil— pero saberlo permite no marcar «Personalizado» cuando
   * las fechas eran inválidas.
   */
  fellBack: boolean;
}

/**
 * Resuelve el período a partir de la URL.
 *
 * `personalizado` exige AMBAS fechas y que `desde <= hasta`. Un rango invertido
 * no se «arregla» dándole la vuelta: quien escribió `desde=31&hasta=01` no ha
 * dicho lo que quiere, y adivinarlo produciría un informe que nadie pidió.
 */
export function resolvePeriodFromParams(
  params: PeriodParams,
  now: Date = new Date()
): ResolvedPeriodSelection {
  const raw = first(params.periodo)?.trim().toLowerCase();
  const kind = raw ? PERIOD_PARAM_TO_KIND[raw] : undefined;

  if (kind === "custom") {
    const from = parseIsoDate(first(params.desde));
    const to = parseIsoDate(first(params.hasta));
    if (from && to) {
      const fromMs = Date.UTC(from.year, from.month - 1, from.day);
      const toMs = Date.UTC(to.year, to.month - 1, to.day);
      if (fromMs <= toMs) {
        return { period: buildCustomPeriod(from, to, now), kind: "custom", fellBack: false };
      }
    }
    return {
      period: resolveNamedPeriod(DEFAULT_PERIOD_KIND, now),
      kind: DEFAULT_PERIOD_KIND,
      fellBack: true,
    };
  }

  if (kind) {
    return { period: resolveNamedPeriod(kind, now), kind, fellBack: false };
  }

  return {
    period: resolveNamedPeriod(DEFAULT_PERIOD_KIND, now),
    kind: DEFAULT_PERIOD_KIND,
    // Sin parámetro no hay nada de lo que caerse: es el estado normal.
    fellBack: Boolean(raw),
  };
}
