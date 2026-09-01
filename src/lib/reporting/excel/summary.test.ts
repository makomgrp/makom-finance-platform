import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import {
  approvalRateCell,
  approvedAmountCell,
  buildSummaryRows,
  summaryCellKind,
} from "./summary.ts";
import type { SummaryLabels, SummaryRow } from "./summary.ts";
import { writeSheet, CURRENCY_FORMAT, type ColumnSpec } from "./sheet.ts";
import type { ReportingComparison } from "../types.ts";

/**
 * ============================================================================
 * MILESTONE 26B-26F.1 — CERO APROBACIONES NO ES «B/. 0,00»
 * ============================================================================
 *
 * La diferencia que corrige este parche es de una palabra y cuesta una mala
 * decisión de dirección:
 *
 *   «Monto aprobado: B/. 0,00»    ODL aprobó cosas y valían cero
 *   «Monto aprobado: sin aprob.»  ODL no aprobó nada
 *
 * La primera lectura es falsa y la hoja de cálculo la invita: un 0 en una
 * columna de importes se suma, se grafica y se promedia con los meses
 * vecinos. El Dashboard y el PDF ya distinguían las dos cosas; el Excel no.
 *
 * Estas pruebas cubren los dos lados —el estado y el número— y la mitad final
 * genera un .xlsx de verdad y lo vuelve a abrir, porque lo que importa no es
 * qué devuelve una función sino qué acaba escrito en la celda.
 */

// ---------------------------------------------------------------------------
// LA REGLA, AISLADA
// ---------------------------------------------------------------------------

test("sin aprobaciones, la celda lleva el estado y no un importe", () => {
  assert.equal(approvedAmountCell(0, 0, "Sin aprobaciones"), "Sin aprobaciones");
  // Aunque el total viniera con algún residuo, cero decisiones sigue siendo
  // cero decisiones: manda el RECUENTO, que es el mismo predicado que usan el
  // Dashboard y el PDF (`financial.approvedCount === 0`).
  assert.equal(approvedAmountCell(0, 12345, "Sin aprobaciones"), "Sin aprobaciones");
});

test("con aprobaciones, la celda lleva el número tal cual", () => {
  assert.equal(approvedAmountCell(3, 226500, "Sin aprobaciones"), 226500);
  assert.equal(typeof approvedAmountCell(1, 0.5, "Sin aprobaciones"), "number");
  // Una única aprobación de importe cero SÍ es un importe: hubo una decisión.
  assert.equal(approvedAmountCell(1, 0, "Sin aprobaciones"), 0);
});

test("el tipo de celda lo decide el valor, no la columna", () => {
  assert.equal(summaryCellKind("Sin aprobaciones", "currency"), "text");
  assert.equal(summaryCellKind(226500, "currency"), "currency");
  assert.equal(summaryCellKind(null, "currency"), "currency");
  assert.equal(summaryCellKind(12, "integer"), "integer");
});

// ---------------------------------------------------------------------------
// LAS FILAS
// ---------------------------------------------------------------------------

const LABELS: SummaryLabels = {
  leads: "Leads recibidos",
  convertedLeads: "Leads convertidos",
  newClients: "Clientes nuevos",
  applicationsCreated: "Solicitudes creadas",
  applicationsFormalized: "Solicitudes formalizadas",
  applicationsApproved: "Solicitudes aprobadas",
  requestedTotal: "Monto solicitado",
  approvedTotal: "Monto aprobado (decisión)",
  documentsUploaded: "Documentos subidos",
  emailsSent: "Correos enviados",
  declined: "Solicitudes no elegibles",
  decisions: "Decisiones tomadas",
  openAtPeriodEnd: "Solicitudes abiertas al cierre",
  approvalRate: "Tasa de aprobación",
  followUpsOpen: "Seguimientos abiertos",
  followUpsOverdue: "Seguimientos vencidos",
  noApprovals: "Sin aprobaciones",
  noDecisions: "Sin decisiones",
};

const comparison = (current: number, previous: number) => ({
  current,
  previous,
  deltaAbsolute: current - previous,
  deltaPercent: previous === 0 ? null : ((current - previous) / previous) * 100,
});

/**
 * Un `ReportingComparison` mínimo. Solo se rellena lo que el Resumen lee; el
 * resto se deja vacío a propósito para que una fila nueva que dependa de un
 * campo no declarado falle en vez de leer un valor inventado.
 */
function fakeReporting(options: {
  approvedCount: number;
  approvedTotal: number;
  previousApprovedCount: number;
  previousApprovedTotal: number;
  /** La tasa en 0–100, como la devuelve el contrato. `null` = sin decisiones. */
  approvalRate?: number | null;
  previousApprovalRate?: number | null;
}): ReportingComparison {
  const snapshot = (approvedCount: number, approvalRate: number | null) =>
    ({
      applications: {
        created: 15,
        formalized: 4,
        approved: approvedCount,
        declined: 0,
        cancelled: 0,
        decisions: approvedCount,
        openAtPeriodEnd: 15,
        approvalRate,
      },
      financial: { approvedCount },
      followUps: { openNow: 0, overdueNow: 0 },
    }) as unknown as ReportingComparison["current"];

  return {
    current: snapshot(options.approvedCount, options.approvalRate ?? null),
    previous: snapshot(options.previousApprovedCount, options.previousApprovalRate ?? null),
    comparisons: {
      leads: comparison(16, 0),
      convertedLeads: comparison(4, 0),
      newClients: comparison(11, 0),
      applicationsCreated: comparison(15, 0),
      applicationsFormalized: comparison(4, 0),
      applicationsApproved: comparison(options.approvedCount, options.previousApprovedCount),
      requestedTotal: comparison(720000, 0),
      approvedTotal: comparison(options.approvedTotal, options.previousApprovedTotal),
      documentsUploaded: comparison(43, 0),
      emailsSent: comparison(6, 0),
    },
  } as unknown as ReportingComparison;
}

const approvedRowOf = (rows: SummaryRow[]) =>
  rows.find((row) => row.label === LABELS.approvedTotal)!;

test("con cero aprobaciones a los dos lados, ninguna celda de la fila lleva un cero", () => {
  const rows = buildSummaryRows(
    fakeReporting({
      approvedCount: 0,
      approvedTotal: 0,
      previousApprovedCount: 0,
      previousApprovedTotal: 0,
    }),
    LABELS
  );
  const row = approvedRowOf(rows);

  assert.equal(row.current, "Sin aprobaciones");
  assert.equal(row.previous, "Sin aprobaciones");
  // La variación tampoco: escribir «B/. 0,00» como cambio reintroduciría por la
  // puerta de al lado el mismo cero que este parche quita.
  assert.equal(row.deltaAbsolute, null);
  assert.equal(row.deltaPercent, null);
});

test("cuando hubo aprobaciones, vuelven los números y la variación", () => {
  const rows = buildSummaryRows(
    fakeReporting({
      approvedCount: 3,
      approvedTotal: 226500,
      previousApprovedCount: 2,
      previousApprovedTotal: 100000,
    }),
    LABELS
  );
  const row = approvedRowOf(rows);

  assert.equal(row.current, 226500);
  assert.equal(row.previous, 100000);
  assert.equal(row.deltaAbsolute, 126500);
  assert.equal(typeof row.deltaPercent, "number");
});

test("un período que estrena aprobaciones compara contra el estado, no contra un cero", () => {
  const rows = buildSummaryRows(
    fakeReporting({
      approvedCount: 2,
      approvedTotal: 50000,
      previousApprovedCount: 0,
      previousApprovedTotal: 0,
    }),
    LABELS
  );
  const row = approvedRowOf(rows);

  assert.equal(row.current, 50000);
  assert.equal(row.previous, "Sin aprobaciones");
  // La diferencia sí existe y es real: se pasó de nada a cincuenta mil.
  assert.equal(row.deltaAbsolute, 50000);
  // El porcentaje no: sin base sobre la que calcularlo. Regla de 26B-26C.
  assert.equal(row.deltaPercent, null);
});

test("la tasa de aprobación sin decisiones NUNCA es 0%", () => {
  // 26B-26F.2 cambió el vacío por la frase. Lo que no cambia —y es lo que esta
  // prueba defiende— es que jamás se escriba un cero: en 26B-26F la celda
  // quedaba vacía, ahora dice «Sin decisiones», y ninguna de las dos miente.
  const rows = buildSummaryRows(
    fakeReporting({
      approvedCount: 0,
      approvedTotal: 0,
      previousApprovedCount: 0,
      previousApprovedTotal: 0,
      approvalRate: null,
    }),
    LABELS
  );
  const rate = rows.find((row) => row.label === LABELS.approvalRate)!;
  assert.equal(rate.current, "Sin decisiones");
  assert.notEqual(rate.current, 0);
});

test("el resto de la hoja no se ve afectado por el parche", () => {
  const rows = buildSummaryRows(
    fakeReporting({
      approvedCount: 0,
      approvedTotal: 0,
      previousApprovedCount: 0,
      previousApprovedTotal: 0,
    }),
    LABELS
  );
  assert.equal(rows.length, 16);
  assert.equal(rows.find((r) => r.label === LABELS.requestedTotal)!.current, 720000);
  assert.equal(rows.find((r) => r.label === LABELS.leads)!.current, 16);
});

// ---------------------------------------------------------------------------
// Y AHORA EN EL ARCHIVO DE VERDAD
// ---------------------------------------------------------------------------

const COLUMNS: ColumnSpec<SummaryRow>[] = [
  { header: "Métrica", kind: "text", width: 40, value: (r) => r.label },
  {
    header: "Período actual",
    kind: (r) => summaryCellKind(r.current, r.kind),
    width: 18,
    value: (r) => r.current,
  },
  {
    header: "Período anterior",
    kind: (r) => summaryCellKind(r.previous, r.kind),
    width: 18,
    value: (r) => r.previous,
  },
  { header: "Variación", kind: (r) => r.kind, width: 16, value: (r) => r.deltaAbsolute },
];

async function summarySheet(rows: SummaryRow[]) {
  const book = new ExcelJS.Workbook();
  writeSheet(book.addWorksheet("Resumen"), COLUMNS, rows, {
    yes: "Sí",
    no: "No",
    emptyMessage: "Sin cifras.",
    locale: "es",
  });
  const bytes = await book.xlsx.writeBuffer();
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(bytes as ArrayBuffer);
  return reopened.getWorksheet("Resumen")!;
}

/** La fila del monto aprobado, localizada por su etiqueta en la hoja abierta. */
function findRow(sheet: ExcelJS.Worksheet, label: string) {
  let found: ExcelJS.Row | null = null;
  sheet.eachRow((row) => {
    if (row.getCell(1).value === label) found = row;
  });
  assert.ok(found, `no se encontro la fila "${label}"`);
  return found as unknown as ExcelJS.Row;
}

test("EN EL ARCHIVO: sin aprobaciones, la celda es texto y no un número con formato de balboa", async () => {
  const rows = buildSummaryRows(
    fakeReporting({
      approvedCount: 0,
      approvedTotal: 0,
      previousApprovedCount: 0,
      previousApprovedTotal: 0,
    }),
    LABELS
  );
  const sheet = await summarySheet(rows);
  const row = findRow(sheet, LABELS.approvedTotal);

  const current = row.getCell(2);
  assert.equal(current.type, ExcelJS.ValueType.String, "debe ser texto, no un importe");
  assert.equal(current.value, "Sin aprobaciones");
  assert.notEqual(current.numFmt, CURRENCY_FORMAT, "no debe llevar formato de moneda");
  assert.equal(current.formula, undefined);

  // Y la variación queda vacía en vez de escribir un cero de dinero.
  const delta = row.getCell(4);
  assert.ok(delta.value === null || delta.value === undefined, String(delta.value));

  // Ni un solo cero numérico en toda la fila del monto aprobado.
  for (const column of [2, 3, 4]) {
    assert.notEqual(row.getCell(column).value, 0, `columna ${column} escribio un cero`);
  }
});

test("EN EL ARCHIVO: con aprobaciones, la celda vuelve a ser numérica y sumable", async () => {
  const rows = buildSummaryRows(
    fakeReporting({
      approvedCount: 3,
      approvedTotal: 226500,
      previousApprovedCount: 2,
      previousApprovedTotal: 100000,
    }),
    LABELS
  );
  const sheet = await summarySheet(rows);
  const cell = findRow(sheet, LABELS.approvedTotal).getCell(2);

  assert.equal(typeof cell.value, "number", "un importe en texto no se puede sumar");
  assert.equal(cell.value, 226500);
  assert.equal(cell.numFmt, CURRENCY_FORMAT);
});

test("EN EL ARCHIVO: el monto SOLICITADO nunca se convierte en estado", async () => {
  // La corrección es del monto APROBADO, que depende de que haya decisiones.
  // Un monto solicitado de cero sería un cero medido y debe seguir siendo un
  // número: el parche no puede contagiarse a las demás columnas de dinero.
  const rows = buildSummaryRows(
    fakeReporting({
      approvedCount: 0,
      approvedTotal: 0,
      previousApprovedCount: 0,
      previousApprovedTotal: 0,
    }),
    LABELS
  );
  const requested = findRow(await summarySheet(rows), LABELS.requestedTotal).getCell(2);
  assert.equal(typeof requested.value, "number");
  assert.equal(requested.value, 720000);
  assert.equal(requested.numFmt, CURRENCY_FORMAT);
});

// ---------------------------------------------------------------------------
// LAS HOJAS DE DETALLE — ahí un aprobado desconocido se queda VACÍO
// ---------------------------------------------------------------------------

test("en el detalle, approved_amount nulo deja la celda en blanco, jamás en cero", async () => {
  // En la hoja «Solicitudes» cada fila es una solicitud concreta. Que no tenga
  // monto aprobado significa que todavía no se ha decidido — no que se le
  // aprobaran cero balboas. El estado «Sin aprobaciones» del Resumen es una
  // frase sobre el PERÍODO y no tendría sentido repetirla fila a fila.
  interface Detail {
    numero: string;
    requestedAmount: number | null;
    approvedAmount: number | null;
  }
  const columns: ColumnSpec<Detail>[] = [
    { header: "N.º", kind: "text", width: 12, value: (r) => r.numero },
    { header: "Solicitado", kind: "currency", width: 16, value: (r) => r.requestedAmount },
    { header: "Aprobado", kind: "currency", width: 16, value: (r) => r.approvedAmount },
  ];

  const book = new ExcelJS.Workbook();
  writeSheet(
    book.addWorksheet("Solicitudes"),
    columns,
    [
      { numero: "SOL-1", requestedAmount: 50000, approvedAmount: null },
      { numero: "SOL-2", requestedAmount: 30000, approvedAmount: 25000 },
    ],
    { yes: "Sí", no: "No", emptyMessage: "Sin solicitudes.", locale: "es" }
  );
  const bytes = await book.xlsx.writeBuffer();
  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(bytes as ArrayBuffer);
  const sheet = reopened.getWorksheet("Solicitudes")!;

  const sinDecidir = sheet.getRow(2).getCell(3);
  assert.ok(
    sinDecidir.value === null || sinDecidir.value === undefined,
    `esperaba celda vacia, habia ${JSON.stringify(sinDecidir.value)}`
  );
  assert.notEqual(sinDecidir.value, 0);
  // El texto del Resumen no se cuela en las filas de detalle.
  assert.notEqual(sinDecidir.value, LABELS.noApprovals);

  // Y la que sí tiene decisión sigue siendo un importe numérico.
  const decidida = sheet.getRow(3).getCell(3);
  assert.equal(decidida.value, 25000);
  assert.equal(decidida.numFmt, CURRENCY_FORMAT);
});

// ---------------------------------------------------------------------------
// 26B-26F.2 — LA TASA DE APROBACIÓN
// ---------------------------------------------------------------------------

const rateRowOf = (rows: SummaryRow[]) =>
  rows.find((row) => row.label === LABELS.approvalRate)!;

/** El caso del brief: `approved` y `not_eligible` a cero en ambos períodos. */
const noDecisionsAnywhere = () =>
  rateRowOf(
    buildSummaryRows(
      fakeReporting({
        approvedCount: 0,
        approvedTotal: 0,
        previousApprovedCount: 0,
        previousApprovedTotal: 0,
        approvalRate: null,
        previousApprovalRate: null,
      }),
      LABELS
    )
  );

test("A — sin decisiones: la frase, y ni 0%, ni NaN, ni Infinity", () => {
  const row = noDecisionsAnywhere();

  assert.equal(row.current, LABELS.noDecisions);
  assert.equal(row.previous, LABELS.noDecisions);

  for (const value of [row.current, row.previous, row.deltaAbsolute, row.deltaPercent]) {
    assert.notEqual(value, 0, "un 0% diria que se rechazo todo lo que se miro");
    // `Number.isNaN(null)` es false, así que se comprueba el caso numérico.
    assert.ok(!(typeof value === "number" && !Number.isFinite(value)), String(value));
  }
});

test("A bis — la regla rechaza NaN e Infinity aunque lleguen de la capa de datos", () => {
  // El contrato promete `null`, pero esta función es la última línea antes del
  // papel: si algún día llegara un Infinity, debe salir la frase, no el símbolo.
  assert.equal(approvalRateCell(Number.NaN, "Sin decisiones"), "Sin decisiones");
  assert.equal(approvalRateCell(Number.POSITIVE_INFINITY, "Sin decisiones"), "Sin decisiones");
  assert.equal(approvalRateCell(null, "Sin decisiones"), "Sin decisiones");
});

test("B — con decisiones, la tasa es un número: 2 aprobadas de 5 → 40", () => {
  // El denominador oficial es aprobadas + no elegibles; las canceladas quedan
  // fuera. 2 / (2 + 3) = 40 %, y el contrato entrega la tasa ya en 0–100.
  const row = rateRowOf(
    buildSummaryRows(
      fakeReporting({
        approvedCount: 2,
        approvedTotal: 50000,
        previousApprovedCount: 0,
        previousApprovedTotal: 0,
        approvalRate: 40,
      }),
      LABELS
    )
  );

  assert.equal(typeof row.current, "number");
  assert.equal(row.current, 40);
  assert.equal(row.kind, "percent");
  assert.equal(summaryCellKind(row.current, row.kind), "percent");
});

test("C — el período anterior sin decisiones no produce una variación inventada", () => {
  const row = rateRowOf(
    buildSummaryRows(
      fakeReporting({
        approvedCount: 2,
        approvedTotal: 50000,
        previousApprovedCount: 0,
        previousApprovedTotal: 0,
        approvalRate: 40,
        previousApprovalRate: null,
      }),
      LABELS
    )
  );

  assert.equal(row.current, 40);
  assert.equal(row.previous, LABELS.noDecisions);
  // Sin tasa anterior no hay resta posible. Un «+40 puntos» contra la nada
  // seria una mejora que nadie midio.
  assert.equal(row.deltaAbsolute, null);
  assert.equal(row.deltaPercent, null);
});

test("D — el período actual sin decisiones tampoco compara", () => {
  const row = rateRowOf(
    buildSummaryRows(
      fakeReporting({
        approvedCount: 0,
        approvedTotal: 0,
        previousApprovedCount: 2,
        previousApprovedTotal: 50000,
        approvalRate: null,
        previousApprovalRate: 40,
      }),
      LABELS
    )
  );

  assert.equal(row.current, LABELS.noDecisions);
  assert.equal(row.previous, 40);
  assert.equal(row.deltaAbsolute, null, "una caida al vacio no es una caida medida");
  assert.equal(row.deltaPercent, null);
});

test("con decisiones a los dos lados, la variación son PUNTOS porcentuales", () => {
  const row = rateRowOf(
    buildSummaryRows(
      fakeReporting({
        approvedCount: 4,
        approvedTotal: 80000,
        previousApprovedCount: 2,
        previousApprovedTotal: 50000,
        approvalRate: 40,
        previousApprovalRate: 25,
      }),
      LABELS
    )
  );

  assert.equal(row.current, 40);
  assert.equal(row.previous, 25);
  assert.equal(row.deltaAbsolute, 15, "40 % menos 25 % son 15 puntos");
  // NUNCA la variación relativa de una tasa: «+60 %» es cierto en aritmética y
  // engañoso en un informe. El contrato no la publica, y aquí no se inventa.
  assert.equal(row.deltaPercent, null);
});

test("EN EL ARCHIVO: sin decisiones la celda es texto; con decisiones, número con formato porcentual", async () => {
  const sinDecidir = await summarySheet([noDecisionsAnywhere()]);
  const textCell = sinDecidir.getRow(2).getCell(2);
  assert.equal(textCell.type, ExcelJS.ValueType.String);
  assert.equal(textCell.value, LABELS.noDecisions);
  assert.equal(textCell.formula, undefined);
  assert.notEqual(textCell.value, 0);

  const conDecisiones = await summarySheet([
    rateRowOf(
      buildSummaryRows(
        fakeReporting({
          approvedCount: 2,
          approvedTotal: 50000,
          previousApprovedCount: 2,
          previousApprovedTotal: 50000,
          approvalRate: 40,
          previousApprovalRate: 25,
        }),
        LABELS
      )
    ),
  ]);
  const numberCell = conDecisiones.getRow(2).getCell(2);
  assert.equal(typeof numberCell.value, "number");
  assert.equal(numberCell.value, 40);
  // El formato oficial del libro: la tasa viaja en 0–100 desde SQL, así que el
  // símbolo va entrecomillado. Con `0.0%` nativo, Excel mostraría 4000 %.
  assert.equal(numberCell.numFmt, '0.0"%"');
});
