// Import RELATIVO Y CON EXTENSIÓN, no por el alias `@/`: este módulo se
// ejercita con `node --test`, que resuelve ficheros reales y no conoce los
// paths del bundler. Es la única dependencia que tiene, y mantenerla así es lo
// que permite probar las fronteras de fecha —donde de verdad se equivocan los
// informes— sin montar un entorno. Turbopack resuelve la extensión sin
// problema; está verificado en el build.
import { BUSINESS_TIME_ZONE } from "../config/business-time.ts";

/**
 * ============================================================================
 * MILESTONE 26B-26C — QUÉ ES "AGOSTO" PARA ODL
 * ============================================================================
 *
 * Un informe gerencial vive o muere en sus fronteras. «Solicitudes de agosto»
 * significa las de agosto EN PANAMÁ, y el servidor corre en UTC: una solicitud
 * enviada a las 8 de la tarde del 31 de agosto en Panamá ya es 1 de septiembre
 * en UTC. Sin esta capa, esa solicitud desaparecería del informe de agosto y
 * aparecería en el de septiembre — y nadie lo notaría hasta que dos documentos
 * no cuadraran.
 *
 * ----------------------------------------------------------------------------
 * EL CALENDARIO VIVE AQUÍ; SQL SOLO AGREGA
 * ----------------------------------------------------------------------------
 * Ninguna función de la base sabe qué es agosto ni dónde está Panamá. Todas
 * reciben dos instantes UTC ya resueltos. La alternativa —`at time zone
 * 'America/Panama'` repetido en trece funciones— serían trece copias de una
 * regla, y la primera que alguien olvidara cambiar produciría un informe que
 * discrepa del resto sin que nada falle.
 *
 * ----------------------------------------------------------------------------
 * [INICIO, FIN) SIEMPRE
 * ----------------------------------------------------------------------------
 * El fin es EXCLUSIVO, sin excepciones. Un `between` cuenta dos veces la fila
 * que cae exactamente en la medianoche que separa dos meses. Con un intervalo
 * semiabierto, agosto y septiembre no pueden solaparse ni dejar un hueco: el
 * fin de uno ES el inicio del otro.
 */

/**
 * Los componentes de una fecha/hora tal como se ven EN Panamá.
 *
 * `Intl` es la única fuente: lee la base IANA, así que la regla vive con la
 * plataforma. Restar cinco horas sería correcto hoy y se convertiría en un
 * error silencioso el día que eso cambiara — ver `business-time.ts`, que tomó
 * la misma decisión por el mismo motivo.
 */
const PARTS_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsInBusinessZone(instant: Date): ZonedParts {
  const parts = PARTS_FORMATTER.formatToParts(instant);
  const pick = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return {
    year: pick("year"),
    month: pick("month"),
    day: pick("day"),
    hour: pick("hour"),
    minute: pick("minute"),
    second: pick("second"),
  };
}

/**
 * Una hora de pared panameña → el instante UTC que le corresponde.
 *
 * DOS PASADAS, y no por superstición. La primera trata la hora de pared como si
 * fuera UTC y mide cuánto se desvía al mirarla desde Panamá; la segunda corrige
 * con ese desfase. Para una zona de desfase fijo —Panamá lo es— la primera
 * corrección ya es exacta y la segunda confirma. Para una zona con horario de
 * verano, la segunda es la que resuelve los saltos, y dejarla escrita significa
 * que el día que ODL abra en un sitio con DST esto sigue siendo correcto en vez
 * de fallar una vez al año.
 */
function businessWallTimeToInstant(parts: ZonedParts): Date {
  const asIfUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );

  let instant = asIfUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    const seen = partsInBusinessZone(new Date(instant));
    const seenAsUtc = Date.UTC(
      seen.year,
      seen.month - 1,
      seen.day,
      seen.hour,
      seen.minute,
      seen.second
    );
    const drift = seenAsUtc - asIfUtc;
    if (drift === 0) break;
    instant -= drift;
  }

  return new Date(instant);
}

/** El instante UTC en que empieza esa fecha del calendario panameño. */
export function startOfBusinessDay(year: number, month: number, day: number): Date {
  return businessWallTimeToInstant({ year, month, day, hour: 0, minute: 0, second: 0 });
}

export type ReportingPeriodKind =
  | "today"
  | "yesterday"
  | "this_week"
  | "this_month"
  | "this_quarter"
  | "this_year"
  | "custom";

export interface ReportingPeriod {
  /** Instante UTC. INCLUSIVO. */
  from: Date;
  /** Instante UTC. EXCLUSIVO — ver la cabecera. */
  to: Date;
  /** Siempre America/Panama. Viaja en la respuesta para que el informe lo diga. */
  timeZone: string;
  kind: ReportingPeriodKind;
  /**
   * ¿El periodo se extiende más allá de este instante?
   *
   * Existe porque «este mes» es el mes ENTERO —del 1 al 1— y compararlo con el
   * mes anterior completo es comparar quince días con treinta. Sin esta marca,
   * el PDF diría «agosto cayó un 48%» cuando agosto simplemente no ha
   * terminado. Con ella puede decir «agosto hasta hoy».
   */
  isPartial: boolean;
}

/** Un lunes empieza la semana. Panamá, como España, no usa la semana en domingo. */
function startOfBusinessWeek(parts: ZonedParts): { year: number; month: number; day: number } {
  const noon = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 12));
  // getUTCDay: 0 = domingo. Se traslada a 0 = lunes.
  const offset = (noon.getUTCDay() + 6) % 7;
  noon.setUTCDate(noon.getUTCDate() - offset);
  return {
    year: noon.getUTCFullYear(),
    month: noon.getUTCMonth() + 1,
    day: noon.getUTCDate(),
  };
}

/**
 * El periodo que corresponde a un nombre, resuelto contra el calendario
 * panameño en el instante `now`.
 *
 * Los periodos con nombre son VENTANAS DE CALENDARIO COMPLETAS: «este mes» es
 * del día 1 al día 1 del siguiente, no «del 1 hasta ahora». Es lo que hace que
 * la comparación con el mes anterior sea una comparación entre iguales, y la
 * marca `isPartial` es la que impide leerla mal mientras el mes está en curso.
 */
export function resolveNamedPeriod(kind: ReportingPeriodKind, now: Date = new Date()): ReportingPeriod {
  if (kind === "custom") {
    throw new Error("A custom period must be built with buildCustomPeriod().");
  }

  const today = partsInBusinessZone(now);
  let from: Date;
  let to: Date;

  switch (kind) {
    case "today":
      from = startOfBusinessDay(today.year, today.month, today.day);
      to = startOfBusinessDay(today.year, today.month, today.day + 1);
      break;
    case "yesterday":
      from = startOfBusinessDay(today.year, today.month, today.day - 1);
      to = startOfBusinessDay(today.year, today.month, today.day);
      break;
    case "this_week": {
      const monday = startOfBusinessWeek(today);
      from = startOfBusinessDay(monday.year, monday.month, monday.day);
      to = startOfBusinessDay(monday.year, monday.month, monday.day + 7);
      break;
    }
    case "this_month":
      from = startOfBusinessDay(today.year, today.month, 1);
      to = startOfBusinessDay(today.year, today.month + 1, 1);
      break;
    case "this_quarter": {
      const firstMonth = Math.floor((today.month - 1) / 3) * 3 + 1;
      from = startOfBusinessDay(today.year, firstMonth, 1);
      to = startOfBusinessDay(today.year, firstMonth + 3, 1);
      break;
    }
    case "this_year":
      from = startOfBusinessDay(today.year, 1, 1);
      to = startOfBusinessDay(today.year + 1, 1, 1);
      break;
  }

  return { from, to, timeZone: BUSINESS_TIME_ZONE, kind, isPartial: to.getTime() > now.getTime() };
}

/**
 * Un rango explícito, en fechas del calendario panameño, ambas INCLUSIVAS para
 * quien lo pide.
 *
 * «Del 1 al 31 de agosto» significa el 31 entero, así que el fin exclusivo que
 * se guarda es el 1 de septiembre. Traducirlo aquí evita que cada llamador
 * tenga que acordarse de sumar un día — y que uno se olvide y pierda el último
 * día del informe sin que nadie lo note.
 */
export function buildCustomPeriod(
  fromDate: { year: number; month: number; day: number },
  toDateInclusive: { year: number; month: number; day: number },
  now: Date = new Date()
): ReportingPeriod {
  const from = startOfBusinessDay(fromDate.year, fromDate.month, fromDate.day);
  const to = startOfBusinessDay(
    toDateInclusive.year,
    toDateInclusive.month,
    toDateInclusive.day + 1
  );
  return {
    from,
    to,
    timeZone: BUSINESS_TIME_ZONE,
    kind: "custom",
    isPartial: to.getTime() > now.getTime(),
  };
}

/**
 * El periodo anterior equivalente.
 *
 * DOS REGLAS DISTINTAS, porque «anterior» significa dos cosas distintas:
 *
 *   * Con nombre → el MISMO periodo del calendario, un paso atrás. Agosto se
 *     compara con julio entero, aunque julio tenga 31 días y junio 30. Restar
 *     «31 días» daría un rango que empieza el 1 de julio y acaba el 31, lo cual
 *     funciona por casualidad en agosto y falla en marzo.
 *   * Custom → la MISMA duración, inmediatamente antes. Diez días se comparan
 *     con los diez anteriores, que es lo que alguien espera al elegir un rango
 *     suelto.
 */
export function previousPeriod(period: ReportingPeriod): ReportingPeriod {
  if (period.kind === "custom") {
    const durationMs = period.to.getTime() - period.from.getTime();
    return {
      from: new Date(period.from.getTime() - durationMs),
      to: new Date(period.from.getTime()),
      timeZone: period.timeZone,
      kind: "custom",
      isPartial: false,
    };
  }

  const start = partsInBusinessZone(period.from);
  let from: Date;

  switch (period.kind) {
    case "today":
    case "yesterday":
      from = startOfBusinessDay(start.year, start.month, start.day - 1);
      break;
    case "this_week":
      from = startOfBusinessDay(start.year, start.month, start.day - 7);
      break;
    case "this_month":
      from = startOfBusinessDay(start.year, start.month - 1, 1);
      break;
    case "this_quarter":
      from = startOfBusinessDay(start.year, start.month - 3, 1);
      break;
    case "this_year":
      from = startOfBusinessDay(start.year - 1, 1, 1);
      break;
    default:
      from = period.from;
  }

  // El fin del anterior ES el inicio del actual. No hay hueco ni solape que
  // calcular, porque las ventanas son semiabiertas y encajan por construcción.
  return {
    from,
    to: new Date(period.from.getTime()),
    timeZone: period.timeZone,
    kind: period.kind,
    isPartial: false,
  };
}

/** Una cifra con su comparación contra el periodo anterior. */
export interface MetricComparison {
  current: number;
  previous: number;
  deltaAbsolute: number;
  /**
   * NULL cuando el periodo anterior fue 0.
   *
   * Pasar de 0 a 7 no es «+700%» ni «+100%»: es un cambio sin base sobre la que
   * calcular un porcentaje. Devolver `null` obliga a la UI a escribir «nuevo»,
   * que es lo único cierto. Nunca Infinity, nunca NaN.
   */
  deltaPercent: number | null;
}

export function compareMetric(current: number, previous: number): MetricComparison {
  return {
    current,
    previous,
    deltaAbsolute: current - previous,
    deltaPercent: previous > 0 ? ((current - previous) / previous) * 100 : null,
  };
}
