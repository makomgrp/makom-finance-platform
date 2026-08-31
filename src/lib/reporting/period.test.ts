import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCustomPeriod,
  compareMetric,
  previousPeriod,
  resolveNamedPeriod,
  startOfBusinessDay,
} from "./period.ts";

/**
 * ============================================================================
 * MILESTONE 26B-26C — LAS FRONTERAS SON LA MÉTRICA
 * ============================================================================
 *
 * Un informe gerencial se equivoca en los bordes, no en el medio. Una solicitud
 * enviada a las 8 de la tarde del 31 de agosto en Panamá es 1 de septiembre en
 * UTC: sin conversión desaparece del informe de agosto y nadie lo nota hasta
 * que dos documentos no cuadran.
 *
 * Panamá está en UTC-5 y no observa horario de verano, así que las fronteras
 * son comprobables con aritmética exacta. Que el código use `Intl` en vez de
 * restar cinco horas es lo que lo mantiene correcto si eso cambia; estas
 * pruebas verifican el resultado de hoy.
 */

const PANAMA = "America/Panama";

// ---------------------------------------------------------------------------
// FRONTERA DEL DÍA PANAMEÑO
// ---------------------------------------------------------------------------

test("la medianoche panameña son las 05:00 UTC", () => {
  assert.equal(startOfBusinessDay(2026, 8, 1).toISOString(), "2026-08-01T05:00:00.000Z");
  assert.equal(startOfBusinessDay(2026, 9, 1).toISOString(), "2026-09-01T05:00:00.000Z");
  assert.equal(startOfBusinessDay(2027, 1, 1).toISOString(), "2027-01-01T05:00:00.000Z");
});

test("el desbordamiento de mes y año se resuelve solo", () => {
  // Día 32 de agosto = 1 de septiembre.
  assert.equal(startOfBusinessDay(2026, 8, 32).toISOString(), "2026-09-01T05:00:00.000Z");
  // Mes 13 = enero del siguiente año.
  assert.equal(startOfBusinessDay(2026, 13, 1).toISOString(), "2027-01-01T05:00:00.000Z");
  // Mes 0 = diciembre del anterior.
  assert.equal(startOfBusinessDay(2026, 0, 1).toISOString(), "2025-12-01T05:00:00.000Z");
});

test("EL CASO QUE MOTIVA TODO ESTO: las 20:00 del 31 de agosto en Panamá siguen siendo agosto", () => {
  const agosto = buildCustomPeriod({ year: 2026, month: 8, day: 1 }, { year: 2026, month: 8, day: 31 });
  // 20:00 en Panamá = 01:00 UTC del 1 de septiembre.
  const envio = new Date("2026-09-01T01:00:00.000Z");
  assert.ok(envio >= agosto.from && envio < agosto.to, "deberia caer dentro de agosto");

  // Y la medianoche panameña del 1 de septiembre ya NO es agosto.
  const septiembre = new Date("2026-09-01T05:00:00.000Z");
  assert.ok(!(septiembre < agosto.to), "no deberia caer dentro de agosto");
});

// ---------------------------------------------------------------------------
// SEMIABIERTO [inicio, fin)
// ---------------------------------------------------------------------------

test("agosto y septiembre encajan sin hueco ni solape", () => {
  const now = new Date("2026-10-15T12:00:00.000Z");
  const agosto = resolveNamedPeriod("this_month", new Date("2026-08-15T12:00:00.000Z"));
  const septiembre = resolveNamedPeriod("this_month", new Date("2026-09-15T12:00:00.000Z"));
  assert.equal(agosto.to.getTime(), septiembre.from.getTime());
  assert.ok(now > septiembre.to);
});

test("el fin es exclusivo: el instante del corte pertenece al periodo siguiente", () => {
  const p = buildCustomPeriod({ year: 2026, month: 8, day: 1 }, { year: 2026, month: 8, day: 31 });
  assert.equal(p.to.toISOString(), "2026-09-01T05:00:00.000Z");
  assert.ok(!(p.to < p.to));
});

test("un rango de un solo día dura exactamente 24 horas", () => {
  const p = buildCustomPeriod({ year: 2026, month: 8, day: 15 }, { year: 2026, month: 8, day: 15 });
  assert.equal(p.to.getTime() - p.from.getTime(), 24 * 60 * 60 * 1000);
});

// ---------------------------------------------------------------------------
// PERIODOS CON NOMBRE
// ---------------------------------------------------------------------------

test("hoy y ayer son días panameños completos y contiguos", () => {
  const now = new Date("2026-08-31T19:00:00.000Z"); // 14:00 en Panamá
  const hoy = resolveNamedPeriod("today", now);
  const ayer = resolveNamedPeriod("yesterday", now);
  assert.equal(hoy.from.toISOString(), "2026-08-31T05:00:00.000Z");
  assert.equal(hoy.to.toISOString(), "2026-09-01T05:00:00.000Z");
  assert.equal(ayer.to.getTime(), hoy.from.getTime());
});

test("un instante que en UTC ya es mañana sigue siendo hoy en Panamá", () => {
  // 01:00 UTC del 1 de septiembre = 20:00 del 31 de agosto en Panamá.
  const now = new Date("2026-09-01T01:00:00.000Z");
  const hoy = resolveNamedPeriod("today", now);
  assert.equal(hoy.from.toISOString(), "2026-08-31T05:00:00.000Z");
});

test("la semana empieza en lunes", () => {
  // 2026-08-31 es lunes; 2026-09-06 es domingo.
  const desdeElLunes = resolveNamedPeriod("this_week", new Date("2026-08-31T19:00:00.000Z"));
  const desdeElDomingo = resolveNamedPeriod("this_week", new Date("2026-09-06T19:00:00.000Z"));
  assert.equal(desdeElLunes.from.toISOString(), "2026-08-31T05:00:00.000Z");
  assert.equal(desdeElDomingo.from.toISOString(), "2026-08-31T05:00:00.000Z");
  assert.equal(desdeElLunes.to.getTime() - desdeElLunes.from.getTime(), 7 * 24 * 3600 * 1000);
});

test("el trimestre agrupa de tres en tres desde enero", () => {
  for (const [mes, inicio] of [[1, "01"], [2, "01"], [3, "01"], [4, "04"], [8, "07"], [12, "10"]] as const) {
    const p = resolveNamedPeriod("this_quarter", new Date(`2026-${String(mes).padStart(2, "0")}-15T18:00:00.000Z`));
    assert.equal(p.from.toISOString(), `2026-${inicio}-01T05:00:00.000Z`, `mes ${mes}`);
  }
});

test("el año va del 1 de enero al 1 de enero, en hora de Panamá", () => {
  const p = resolveNamedPeriod("this_year", new Date("2026-06-15T12:00:00.000Z"));
  assert.equal(p.from.toISOString(), "2026-01-01T05:00:00.000Z");
  assert.equal(p.to.toISOString(), "2027-01-01T05:00:00.000Z");
});

test("un periodo con nombre no se puede pedir como custom", () => {
  assert.throws(() => resolveNamedPeriod("custom"));
});

// ---------------------------------------------------------------------------
// PARCIAL — la trampa de comparar medio mes con un mes entero
// ---------------------------------------------------------------------------

test("un mes en curso se marca como parcial", () => {
  const enCurso = resolveNamedPeriod("this_month", new Date("2026-08-15T12:00:00.000Z"));
  assert.equal(enCurso.isPartial, true);
});

test("un mes ya terminado no es parcial", () => {
  const terminado = resolveNamedPeriod("this_month", new Date("2026-08-15T12:00:00.000Z"));
  const yaPaso = { ...terminado };
  // Visto desde octubre, agosto está cerrado.
  const agostoDesdeOctubre = buildCustomPeriod(
    { year: 2026, month: 8, day: 1 },
    { year: 2026, month: 8, day: 31 },
    new Date("2026-10-01T12:00:00.000Z")
  );
  assert.equal(agostoDesdeOctubre.isPartial, false);
  assert.equal(yaPaso.timeZone, PANAMA);
});

// ---------------------------------------------------------------------------
// PERIODO ANTERIOR
// ---------------------------------------------------------------------------

test("agosto se compara con JULIO ENTERO, no con los 31 días previos", () => {
  const agosto = resolveNamedPeriod("this_month", new Date("2026-08-15T12:00:00.000Z"));
  const julio = previousPeriod(agosto);
  assert.equal(julio.from.toISOString(), "2026-07-01T05:00:00.000Z");
  assert.equal(julio.to.toISOString(), "2026-08-01T05:00:00.000Z");
  assert.equal(julio.to.getTime(), agosto.from.getTime(), "sin hueco entre ambos");
});

test("marzo se compara con febrero, que tiene 28 días", () => {
  const marzo = resolveNamedPeriod("this_month", new Date("2026-03-15T12:00:00.000Z"));
  const febrero = previousPeriod(marzo);
  assert.equal(febrero.from.toISOString(), "2026-02-01T05:00:00.000Z");
  assert.equal(febrero.to.toISOString(), "2026-03-01T05:00:00.000Z");
  assert.equal((febrero.to.getTime() - febrero.from.getTime()) / (24 * 3600 * 1000), 28);
});

test("enero se compara con diciembre del año anterior", () => {
  const enero = resolveNamedPeriod("this_month", new Date("2026-01-15T12:00:00.000Z"));
  const diciembre = previousPeriod(enero);
  assert.equal(diciembre.from.toISOString(), "2025-12-01T05:00:00.000Z");
});

test("un rango custom se compara con la MISMA duración inmediatamente anterior", () => {
  // 10 días: del 10 al 19 de agosto inclusive.
  const diez = buildCustomPeriod({ year: 2026, month: 8, day: 10 }, { year: 2026, month: 8, day: 19 });
  const anterior = previousPeriod(diez);
  assert.equal(
    anterior.to.getTime() - anterior.from.getTime(),
    diez.to.getTime() - diez.from.getTime()
  );
  assert.equal(anterior.to.getTime(), diez.from.getTime());
  assert.equal(anterior.from.toISOString(), "2026-07-31T05:00:00.000Z");
});

test("el trimestre y el año anteriores son los del calendario", () => {
  const q = previousPeriod(resolveNamedPeriod("this_quarter", new Date("2026-08-15T12:00:00.000Z")));
  assert.equal(q.from.toISOString(), "2026-04-01T05:00:00.000Z");
  const y = previousPeriod(resolveNamedPeriod("this_year", new Date("2026-08-15T12:00:00.000Z")));
  assert.equal(y.from.toISOString(), "2025-01-01T05:00:00.000Z");
});

// ---------------------------------------------------------------------------
// COMPARACIÓN — la regla del denominador cero
// ---------------------------------------------------------------------------

test("con periodo anterior en cero, el porcentaje es NULL y nunca Infinity", () => {
  const m = compareMetric(7, 0);
  assert.equal(m.current, 7);
  assert.equal(m.previous, 0);
  assert.equal(m.deltaAbsolute, 7);
  assert.equal(m.deltaPercent, null);
});

test("cero contra cero tampoco inventa un porcentaje", () => {
  const m = compareMetric(0, 0);
  assert.equal(m.deltaAbsolute, 0);
  assert.equal(m.deltaPercent, null);
  assert.ok(!Number.isNaN(m.deltaPercent as unknown as number));
});

test("con base válida el porcentaje es exacto, suba o baje", () => {
  assert.equal(compareMetric(150, 100).deltaPercent, 50);
  assert.equal(compareMetric(50, 100).deltaPercent, -50);
  assert.equal(compareMetric(100, 100).deltaPercent, 0);
});

test("ningún resultado de comparación puede ser Infinity o NaN", () => {
  for (const [c, p] of [[0, 0], [5, 0], [0, 5], [3, 7], [1e9, 1]] as const) {
    const m = compareMetric(c, p);
    assert.ok(Number.isFinite(m.deltaAbsolute));
    assert.ok(m.deltaPercent === null || Number.isFinite(m.deltaPercent));
  }
});

// ---------------------------------------------------------------------------
// CORTES DE COBERTURA
// ---------------------------------------------------------------------------

test("un periodo que empieza antes del corte NO está cubierto", () => {
  const corte = new Date("2026-08-31T18:38:57.939Z");
  const agosto = buildCustomPeriod({ year: 2026, month: 8, day: 1 }, { year: 2026, month: 8, day: 31 });
  const septiembre = buildCustomPeriod({ year: 2026, month: 9, day: 1 }, { year: 2026, month: 9, day: 30 });
  // Misma regla que `coveredBy` en el servicio: el periodo debe EMPEZAR en o
  // después del corte. Agosto contiene tramo sin medir; septiembre no.
  assert.ok(agosto.from.getTime() < corte.getTime(), "agosto empieza antes del corte");
  assert.ok(septiembre.from.getTime() >= corte.getTime(), "septiembre empieza despues");
});

test("la zona horaria del informe siempre viaja en la respuesta", () => {
  assert.equal(resolveNamedPeriod("today").timeZone, PANAMA);
  assert.equal(
    buildCustomPeriod({ year: 2026, month: 8, day: 1 }, { year: 2026, month: 8, day: 2 }).timeZone,
    PANAMA
  );
});
