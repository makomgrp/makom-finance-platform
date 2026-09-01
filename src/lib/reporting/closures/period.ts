import { startOfBusinessDay } from "../period.ts";
import { BUSINESS_TIME_ZONE } from "../../config/business-time.ts";
import type { ReportingPeriod } from "../period.ts";

/**
 * ============================================================================
 * MILESTONE 26B-26G — EL MES DE PANAMÁ
 * ============================================================================
 *
 * Un cierre gerencial es la fotografía de UN MES CALENDARIO DE PANAMÁ. Todo
 * este fichero existe para que «agosto» signifique exactamente lo mismo el día
 * que se cierra, el día que se compara con septiembre y el día de dentro de
 * tres años en que alguien lo cite en una junta.
 *
 * ----------------------------------------------------------------------------
 * SE APOYA EN `startOfBusinessDay`, NO EN ARITMÉTICA DE FECHAS PROPIA
 * ----------------------------------------------------------------------------
 * El proyecto ya tiene un resolvedor de medianoche panameña que pasa por `Intl`
 * y por la zona `America/Panama`. Aquí no se resta ningún «-5»: agosto empieza
 * cuando ese resolvedor dice que empieza. Panamá no aplica horario de verano
 * hoy, pero un desplazamiento fijo sería una decisión que nadie tomó y que
 * dejaría de ser cierta sin avisar.
 *
 * `startOfBusinessDay` NORMALIZA el mes 13 y el mes 0 igual que `Date.UTC`, así
 * que diciembre → enero y enero → diciembre del año anterior salen solos. Eso
 * se prueba explícitamente en lugar de darse por supuesto.
 *
 * ----------------------------------------------------------------------------
 * EL CONTRATO ES `[from, to)`
 * ----------------------------------------------------------------------------
 * El mismo de toda la capa de reporting. El último instante de agosto NO es
 * parte de septiembre y no se cuenta dos veces.
 */

/** La clave canónica de un mes. `YYYY-MM`, nunca dependiente del idioma. */
export function monthlyPeriodKey(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

/**
 * El período `[from, to)` de un mes calendario de Panamá.
 *
 * `kind: "this_month"` porque es la forma que el contrato de reporting tiene
 * para «un mes natural»; `isPartial: false` siempre, porque un cierre solo se
 * genera sobre meses ya terminados y esa garantía la impone el generador.
 */
export function panamaMonthPeriod(year: number, month: number): ReportingPeriod {
  return {
    from: startOfBusinessDay(year, month, 1),
    to: startOfBusinessDay(year, month + 1, 1),
    timeZone: BUSINESS_TIME_ZONE,
    kind: "this_month",
    isPartial: false,
  };
}

/** Un mes identificado por año y número, con su clave y su período. */
export interface MonthlyPeriod {
  periodKey: string;
  year: number;
  month: number;
  period: ReportingPeriod;
}

export function monthlyPeriod(year: number, month: number): MonthlyPeriod {
  return { periodKey: monthlyPeriodKey(year, month), year, month, period: panamaMonthPeriod(year, month) };
}

/**
 * El mes ANTERIOR al que corre ahora mismo en Panamá.
 *
 * Es lo que el automatismo del día 1 tiene que cerrar. La conversión a hora de
 * Panamá ocurre ANTES de mirar el mes: si se resolviera con el reloj del
 * servidor, una ejecución a las 02:00 UTC del 1 de septiembre creería que
 * estamos en septiembre cuando en Panamá siguen siendo las 21:00 del 31 de
 * agosto — y cerraría julio.
 */
export function previousPanamaMonth(now: Date = new Date()): MonthlyPeriod {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);

  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);

  // Enero retrocede a diciembre del año anterior. Se escribe explícito en vez
  // de confiar en que el normalizador lo arregle: es el caso que más veces se
  // rompe y merece verse en el código.
  return month === 1 ? monthlyPeriod(year - 1, 12) : monthlyPeriod(year, month - 1);
}

/** Interpreta una clave `YYYY-MM` recibida de fuera. `null` si no lo es. */
export function parseMonthlyPeriodKey(value: string): MonthlyPeriod | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  // Un año fuera de todo rango razonable es un error de quien llama, no un
  // período: se rechaza en vez de generar un cierre del año 0400.
  if (year < 2000 || year > 2999) return null;

  return monthlyPeriod(year, month);
}

/**
 * ¿Ha terminado ya este mes en Panamá?
 *
 * La guarda que impide cerrar un mes en curso. Un cierre de septiembre creado
 * el día 12 sería una fotografía a medias con nombre de mes completo, y nadie
 * que lo leyera después podría saberlo.
 */
export function monthHasEnded(month: MonthlyPeriod, now: Date = new Date()): boolean {
  return now.getTime() >= month.period.to.getTime();
}
