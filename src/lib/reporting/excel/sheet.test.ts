import { test } from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { CURRENCY_FORMAT, panamaWallClock, writeSheet, type ColumnSpec } from "./sheet.ts";

/**
 * ============================================================================
 * MILESTONE 26B-26F — SE GENERA UN LIBRO Y SE VUELVE A LEER
 * ============================================================================
 *
 * Estas pruebas NO leen el código fuente: escriben un .xlsx de verdad, lo
 * vuelven a abrir y miran qué hay dentro de cada celda. Es la única forma de
 * demostrar las cuatro promesas del extracto, porque las cuatro dependen de
 * cómo exceljs acaba escribiendo el XML y no de cómo se ve el TypeScript:
 *
 *   ¿el nombre hostil quedó como texto o como fórmula?
 *   ¿el importe es un número o una cadena con puntos?
 *   ¿la fecha es una fecha, y es la de Panamá?
 *   ¿hay panel fijo y autofiltro donde se dijo?
 *
 * Un comentario que dijera «se escribe como texto» no probaría ninguna.
 */

interface Row {
  name: string;
  amount: number | null;
  when: string;
  flag: boolean;
}

const COLUMNS: ColumnSpec<Row>[] = [
  { header: "Cliente", kind: "text", width: 30, value: (r) => r.name },
  { header: "Monto", kind: "currency", width: 16, value: (r) => r.amount },
  { header: "Fecha", kind: "datetime", width: 18, value: (r) => r.when },
  { header: "Bandera", kind: "boolean", width: 10, value: (r) => r.flag },
];

const OPTIONS = { yes: "Sí", no: "No", emptyMessage: "No hubo nada en este período.", locale: "es" };

/** Escribe una hoja, la serializa y la vuelve a abrir desde los bytes. */
async function roundTrip(rows: Row[]) {
  const book = new ExcelJS.Workbook();
  writeSheet(book.addWorksheet("Prueba"), COLUMNS, rows, OPTIONS);

  const bytes = await book.xlsx.writeBuffer();

  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(bytes as ArrayBuffer);
  return reopened.getWorksheet("Prueba")!;
}

// ---------------------------------------------------------------------------
// 1. NINGÚN TEXTO SE CONVIERTE EN FÓRMULA
// ---------------------------------------------------------------------------

test("un nombre hostil llega al archivo como texto, no como fórmula", async () => {
  const sheet = await roundTrip([
    { name: `=cmd|' /C calc'!A0`, amount: 100, when: "2026-08-15T15:00:00Z", flag: true },
  ]);

  const cell = sheet.getRow(2).getCell(1);
  assert.equal(cell.type, ExcelJS.ValueType.String, "deberia ser una celda de texto");
  assert.equal(cell.formula, undefined, "no puede tener formula");
  assert.equal(cell.value, `'=cmd|' /C calc'!A0`);
});

test("el teléfono de un cliente panameño no se altera al escribirlo", async () => {
  const sheet = await roundTrip([
    { name: "+507 6000-0000", amount: null, when: "2026-08-15T15:00:00Z", flag: false },
  ]);
  assert.equal(sheet.getRow(2).getCell(1).value, "+507 6000-0000");
});

test("ninguna celda del libro lleva hipervínculo", async () => {
  // Un correo o un dominio que llegó de un formulario público no debe
  // convertirse en algo en lo que se pueda hacer clic dentro del archivo.
  const sheet = await roundTrip([
    { name: "maria@example.com", amount: 1, when: "2026-08-15T15:00:00Z", flag: true },
  ]);

  let hyperlinks = 0;
  sheet.eachRow((row) =>
    row.eachCell((cell) => {
      if (cell.type === ExcelJS.ValueType.Hyperlink) hyperlinks += 1;
    })
  );
  assert.equal(hyperlinks, 0);
});

// ---------------------------------------------------------------------------
// 2. EL DINERO ES UN NÚMERO
// ---------------------------------------------------------------------------

test("un importe es numérico y lleva el formato del balboa", async () => {
  const sheet = await roundTrip([
    { name: "Ana", amount: 12345.67, when: "2026-08-15T15:00:00Z", flag: true },
  ]);

  const cell = sheet.getRow(2).getCell(2);
  assert.equal(typeof cell.value, "number", "un importe en texto no se puede sumar");
  assert.equal(cell.value, 12345.67);
  assert.equal(cell.numFmt, CURRENCY_FORMAT);
  // Entrecomillado: sin las comillas, `/` seria el codigo de fraccion de Excel
  // y `B/.` no se imprimiria.
  assert.ok(CURRENCY_FORMAT.startsWith('"B/. "'), CURRENCY_FORMAT);
});

test("un importe desconocido deja la celda VACÍA, no en cero", async () => {
  // Un 0 se suma. «No lo sabemos» sumado como «nada» falsea el total.
  const sheet = await roundTrip([
    { name: "Ana", amount: null, when: "2026-08-15T15:00:00Z", flag: true },
  ]);
  const cell = sheet.getRow(2).getCell(2);
  assert.ok(cell.value === null || cell.value === undefined, String(cell.value));
});

// ---------------------------------------------------------------------------
// 3. LAS FECHAS SON FECHAS, Y SON DE PANAMÁ
// ---------------------------------------------------------------------------

test("una fecha se escribe como fecha de Excel, no como cadena ISO", async () => {
  const sheet = await roundTrip([
    { name: "Ana", amount: 1, when: "2026-08-15T15:00:00Z", flag: true },
  ]);
  const cell = sheet.getRow(2).getCell(3);
  assert.equal(cell.type, ExcelJS.ValueType.Date, "una fecha en texto no se ordena ni se filtra");
  assert.ok(cell.numFmt?.includes("dd/mm/yyyy"), cell.numFmt);
});

test("las nueve de la noche en Panamá siguen siendo el mismo día, no el siguiente", async () => {
  // 2026-09-01T02:00Z son las 21:00 del 31 de agosto en Panamá. Sin corregir la
  // zona, un cierre de mes pondría esta solicitud en septiembre.
  const sheet = await roundTrip([
    { name: "Ana", amount: 1, when: "2026-09-01T02:00:00Z", flag: true },
  ]);

  const value = sheet.getRow(2).getCell(3).value as Date;
  assert.equal(value.getUTCFullYear(), 2026);
  assert.equal(value.getUTCMonth() + 1, 8, "debe seguir siendo agosto");
  assert.equal(value.getUTCDate(), 31);
  assert.equal(value.getUTCHours(), 21);
});

test("panamaWallClock devuelve null ante una fecha ilegible en vez de inventar una", () => {
  assert.equal(panamaWallClock("no es una fecha"), null);
  assert.equal(panamaWallClock(""), null);
});

test("una marca de tiempo corrupta se muestra tal cual en vez de desaparecer", async () => {
  // Quien lea el informe tiene que poder VER que ese dato está mal; borrarlo
  // convertiría un error de datos en una fila que parece correcta.
  const sheet = await roundTrip([{ name: "Ana", amount: 1, when: "vaya", flag: true }]);
  assert.equal(sheet.getRow(2).getCell(3).value, "vaya");
});

// ---------------------------------------------------------------------------
// 4. PANEL FIJO, AUTOFILTRO Y ESTADO VACÍO
// ---------------------------------------------------------------------------

test("la fila de encabezados queda fija y el filtro cubre lo escrito", async () => {
  const rows: Row[] = [1, 2, 3].map((n) => ({
    name: `Cliente ${n}`,
    amount: n * 100,
    when: "2026-08-15T15:00:00Z",
    flag: n % 2 === 0,
  }));
  const sheet = await roundTrip(rows);

  assert.equal(sheet.views[0]?.state, "frozen");
  assert.equal(sheet.views[0]?.ySplit, 1, "los titulos deben seguir a la vista al bajar");

  // Al releer el archivo el filtro vuelve como el RANGO A1 que Excel guarda de
  // verdad, no como el objeto que se le pasó. Se comprueba esa forma a
  // propósito: es la que abre Excel. Cuatro columnas (A–D) y tres filas más el
  // encabezado.
  assert.equal(sheet.autoFilter, "A1:D4");
});

test("un booleano se escribe con la palabra del idioma, no con TRUE", async () => {
  const sheet = await roundTrip([
    { name: "Ana", amount: 1, when: "2026-08-15T15:00:00Z", flag: true },
    { name: "Luis", amount: 2, when: "2026-08-15T15:00:00Z", flag: false },
  ]);
  assert.equal(sheet.getRow(2).getCell(4).value, "Sí");
  assert.equal(sheet.getRow(3).getCell(4).value, "No");
});

test("una hoja sin filas explica por qué, en vez de quedarse en blanco", async () => {
  const sheet = await roundTrip([]);

  // Los encabezados siguen ahí: quien abre la hoja ve qué se buscaba.
  assert.equal(sheet.getRow(1).getCell(1).value, "Cliente");
  // Y una frase, no un guion ni el vacío — que se leería como un fallo.
  assert.equal(sheet.getRow(2).getCell(1).value, OPTIONS.emptyMessage);
  assert.ok(OPTIONS.emptyMessage.length > 10);
});

test("los encabezados también pasan por el saneador", async () => {
  const book = new ExcelJS.Workbook();
  writeSheet(
    book.addWorksheet("H"),
    [{ header: "=1+1", kind: "text", width: 10, value: () => "x" }],
    [{}],
    OPTIONS
  );
  const cell = book.getWorksheet("H")!.getRow(1).getCell(1);
  assert.equal(cell.formula, undefined);
  assert.equal(cell.value, "'=1+1");
});
