import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deltaDirection,
  formatDeltaPercent,
  formatDurationHours,
  formatRate,
  periodIsCoveredBy,
  shareOf,
} from "./presentation.ts";
import { buildCustomPeriod, compareMetric } from "./period.ts";

/**
 * ============================================================================
 * MILESTONE 26B-26D — QUE UN CERO NUNCA SIGNIFIQUE «NO SE SABE»
 * ============================================================================
 *
 * La tentación en toda pantalla es pintar un 0 donde el contrato dice `null`,
 * porque encaja mejor en la tarjeta. Un 0% de aprobación cuando no ha habido
 * ninguna decisión no es prudente: acusa a ODL de haberlo rechazado todo.
 * Todo lo de abajo defiende esa frontera.
 */

// ---------------------------------------------------------------------------
// VARIACIÓN
// ---------------------------------------------------------------------------

test("«sin comparación» y «sin cambio» son estados DISTINTOS", () => {
  // flat = se mantuvo igual, que es informacion.
  assert.equal(deltaDirection(compareMetric(10, 10)), "flat");
  // none = no hay con que comparar, que es la ausencia de informacion.
  assert.equal(deltaDirection(compareMetric(10, 0)), "none");
  assert.equal(deltaDirection(compareMetric(0, 0)), "none");
});

test("la dirección distingue subida y bajada", () => {
  assert.equal(deltaDirection(compareMetric(15, 10)), "up");
  assert.equal(deltaDirection(compareMetric(5, 10)), "down");
});

test("el porcentaje lleva signo y un solo decimal", () => {
  assert.equal(formatDeltaPercent(compareMetric(150, 100)), "+50%");
  assert.equal(formatDeltaPercent(compareMetric(50, 100)), "-50%");
  assert.equal(formatDeltaPercent(compareMetric(100, 100)), "0%");
  assert.equal(formatDeltaPercent(compareMetric(1234, 1000)), "+23.4%");
});

test("sin base de comparación el porcentaje es null, nunca +∞ ni +100%", () => {
  const shown = formatDeltaPercent(compareMetric(7, 0));
  assert.equal(shown, null);
  assert.ok(shown === null || !/Infinity|NaN/.test(shown));
});

// ---------------------------------------------------------------------------
// TASAS
// ---------------------------------------------------------------------------

test("una tasa nula NO se convierte en 0%", () => {
  assert.equal(formatRate(null), null);
});

test("una tasa real se redondea a un decimal", () => {
  assert.equal(formatRate(66.6666), "66.7%");
  assert.equal(formatRate(100), "100%");
  assert.equal(formatRate(0), "0%", "cero decisiones aprobadas SOBRE decisiones reales si es 0%");
});

test("una tasa no finita se trata como ausencia", () => {
  assert.equal(formatRate(Number.POSITIVE_INFINITY), null);
  assert.equal(formatRate(Number.NaN), null);
});

// ---------------------------------------------------------------------------
// DURACIONES
// ---------------------------------------------------------------------------

test("la unidad cambia con la magnitud: nadie lee «0.53 horas»", () => {
  assert.deepEqual(formatDurationHours(0.53), { value: 32, unit: "minutes" });
  assert.deepEqual(formatDurationHours(5.25), { value: 5.3, unit: "hours" });
  assert.deepEqual(formatDurationHours(72), { value: 3, unit: "days" });
});

test("sin muestras no hay duración cero: hay ausencia", () => {
  assert.equal(formatDurationHours(null), null);
  assert.equal(formatDurationHours(Number.NaN), null);
  assert.equal(formatDurationHours(-1), null, "una duracion negativa es un dato corrupto");
});

// ---------------------------------------------------------------------------
// COBERTURA — el aviso que impide leer «no medido» como «no ocurrio»
// ---------------------------------------------------------------------------

const FUNNEL_CUTOFF = "2026-08-31T18:38:57.939760+00:00";

test("un período anterior al corte NO está cubierto", () => {
  const agosto = buildCustomPeriod({ year: 2026, month: 8, day: 1 }, { year: 2026, month: 8, day: 31 });
  assert.equal(periodIsCoveredBy(agosto, FUNNEL_CUTOFF), false);
});

test("un período posterior al corte SÍ está cubierto", () => {
  const septiembre = buildCustomPeriod(
    { year: 2026, month: 9, day: 1 },
    { year: 2026, month: 9, day: 30 }
  );
  assert.equal(periodIsCoveredBy(septiembre, FUNNEL_CUTOFF), true);
});

test("un período que solo se solapa parcialmente NO cuenta como cubierto", () => {
  // Contiene un tramo sin medir; presentarlo como cobertura completa es lo que
  // haria parecer que dieciseis solicitantes reales nunca llegaron a ningun paso.
  const aCaballo = buildCustomPeriod(
    { year: 2026, month: 8, day: 25 },
    { year: 2026, month: 9, day: 5 }
  );
  assert.equal(periodIsCoveredBy(aCaballo, FUNNEL_CUTOFF), false);
});

test("sin corte registrado, nada está cubierto", () => {
  const p = buildCustomPeriod({ year: 2026, month: 9, day: 1 }, { year: 2026, month: 9, day: 30 });
  assert.equal(periodIsCoveredBy(p, null), false);
  assert.equal(periodIsCoveredBy(p, "no-es-una-fecha"), false);
});

// ---------------------------------------------------------------------------
// PROPORCIONES
// ---------------------------------------------------------------------------

test("un conjunto vacío no dibuja una barra llena de nada", () => {
  assert.deepEqual(shareOf([0, 0, 0, 0]), [0, 0, 0, 0]);
  assert.deepEqual(shareOf([]), []);
});

test("las proporciones suman 100 cuando hay algo que repartir", () => {
  const shares = shareOf([12, 0, 0, 4]);
  assert.equal(Math.round(shares.reduce((a, b) => a + b, 0)), 100);
  assert.equal(shares[0], 75);
  assert.equal(shares[3], 25);
});

test("ningún reparto produce NaN ni Infinity", () => {
  for (const input of [[0], [1], [0, 0, 5], [-3, 4], [1e9, 1]]) {
    for (const share of shareOf(input)) {
      assert.ok(Number.isFinite(share), `${input} produjo ${share}`);
    }
  }
});
