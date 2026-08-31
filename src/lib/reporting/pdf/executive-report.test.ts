import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { executiveReportFilename } from "./filename.ts";
import { ROLE_CAPABILITIES } from "../../auth/capabilities.ts";

/**
 * ============================================================================
 * MILESTONE 26B-26E — LO QUE UN PDF NO PERDONA
 * ============================================================================
 *
 * Un informe en papel sobrevive a la conversación que lo acompañaba. Se
 * imprime, se reenvía y se lee meses después sin nadie al lado para matizarlo.
 * Un error que en pantalla se corrige recargando, aquí queda archivado.
 *
 * Estas pruebas defienden las cuatro cosas que no se pueden comprobar mirando
 * el documento: quién puede generarlo, que no lleva datos personales, que
 * nunca llama «prestado» a un monto aprobado, y que el nombre del archivo no
 * puede romper una cabecera HTTP.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// PERMISOS — la misma puerta que el Dashboard
// ---------------------------------------------------------------------------

test("solo administrador y gerente pueden generar el informe", () => {
  const holders = (Object.keys(ROLE_CAPABILITIES) as (keyof typeof ROLE_CAPABILITIES)[]).filter(
    (role) => (ROLE_CAPABILITIES[role] as readonly string[]).includes("analytics:view")
  );
  assert.deepEqual(holders.sort(), ["administrador", "gerente"]);
});

test("la ruta exige la capacidad en el SERVIDOR, antes de leer parámetros", () => {
  const route = read("../../../app/api/informe-ejecutivo/route.ts");
  assert.ok(route.includes('requireCapability("analytics:view")'));

  // El orden importa: autorizar primero, validar después. Al revés, un no
  // autorizado podría distinguir un período mal formado de uno correcto.
  const authAt = route.indexOf("requireCapability");
  const parseAt = route.indexOf("resolvePeriodFromParams");
  assert.ok(authAt > 0 && parseAt > authAt, "la autorizacion debe preceder al parseo");
});

test("sin capacidad no se pide ni un dato: el 403 sale antes de tocar la base", () => {
  const route = read("../../../app/api/informe-ejecutivo/route.ts");
  const body = route.slice(route.indexOf("export async function GET"));
  const denyAt = body.indexOf('auth.status === "denied"');
  const fetchAt = body.indexOf("getReportingComparison(");
  assert.ok(denyAt > 0, "debe existir la comprobacion de denegacion");
  assert.ok(fetchAt > denyAt, "la lectura de datos debe ocurrir DESPUES del rechazo");
});

// ---------------------------------------------------------------------------
// FUENTE DE VERDAD — una sola, la del Dashboard
// ---------------------------------------------------------------------------

test("el PDF se alimenta de getReportingComparison y de nada más", () => {
  const route = read("../../../app/api/informe-ejecutivo/route.ts");
  assert.ok(route.includes("getReportingComparison"));
  // Ninguna consulta propia: sin SQL alternativo, sin RPC directa, sin
  // supabase.from() en la ruta.
  for (const forbidden of ["supabase.from(", ".rpc(", "reporting_lead_metrics"]) {
    assert.ok(!route.includes(forbidden), `la ruta no debe consultar por su cuenta: ${forbidden}`);
  }
});

test("el generador no calcula ninguna métrica: solo formatea", () => {
  const report = read("./executive-report.ts");
  for (const forbidden of ["supabase", ".rpc(", "SELECT ", "reporting_"]) {
    assert.ok(!report.includes(forbidden), `el generador no debe consultar: ${forbidden}`);
  }
});

test("reutiliza el analizador de períodos del Dashboard, no una copia", () => {
  const route = read("../../../app/api/informe-ejecutivo/route.ts");
  assert.ok(route.includes('from "@/lib/reporting/period-params"'));
});

// ---------------------------------------------------------------------------
// TERMINOLOGÍA FINANCIERA
// ---------------------------------------------------------------------------

test("el generador nunca afirma «prestado», «desembolsado» ni «cartera»", () => {
  const report = read("./executive-report.ts");
  const patterns = [/\blent\b/i, /\bdisburs/i, /\bportfolio\b/i, /\bloan\s*book\b/i];
  for (const line of report.split("\n")) {
    // Se permiten las líneas que EXPLICAN que el dato no existe.
    if (/no existe|nunca|NO ES|no hay|NotDisbursed|notDisbursed|no dinero/i.test(line)) continue;
    for (const pattern of patterns) {
      assert.ok(!pattern.test(line), `executive-report.ts: "${line.trim()}"`);
    }
  }
});

test("los textos del PDF declaran que aprobado NO es desembolsado, en los dos idiomas", () => {
  for (const [file, needle] of [
    ["../../../../messages/es.json", "NO representa desembolsos realizados"],
    ["../../../../messages/en.json", "does NOT represent disbursements made"],
  ] as const) {
    const pdf = JSON.parse(read(file)).dashboard.analytics.pdf;
    assert.ok(
      (pdf.methodApprovedNotDisbursed as string).includes(needle),
      `${file}: falta la declaracion explicita`
    );
  }
});

// ---------------------------------------------------------------------------
// NOMBRE DE ARCHIVO — viaja en una cabecera HTTP
// ---------------------------------------------------------------------------

const PANAMA = "America/Panama";
const day = (y: number, m: number, d: number) =>
  new Date(Date.UTC(y, m - 1, d, 5, 0, 0)); // medianoche en Panamá

test("el nombre lleva el rango y el idioma correctos", () => {
  const from = day(2026, 8, 1);
  const to = day(2026, 9, 1); // fin EXCLUSIVO
  assert.equal(
    executiveReportFilename(from, to, "es", PANAMA),
    "ODL-Informe-Ejecutivo-2026-08-01_2026-08-31.pdf"
  );
  assert.equal(
    executiveReportFilename(from, to, "en", PANAMA),
    "ODL-Executive-Report-2026-08-01_2026-08-31.pdf"
  );
});

test("un solo día no repite la fecha", () => {
  assert.equal(
    executiveReportFilename(day(2026, 8, 29), day(2026, 8, 30), "es", PANAMA),
    "ODL-Informe-Ejecutivo-2026-08-29.pdf"
  );
});

test("el nombre no puede romper la cabecera Content-Disposition", () => {
  // Solo caracteres inocuos: ni comillas, ni saltos de línea, ni punto y coma.
  const name = executiveReportFilename(day(2026, 1, 1), day(2027, 1, 1), "es", PANAMA);
  assert.match(name, /^[A-Za-z0-9._-]+\.pdf$/);
  for (const dangerous of ['"', "\r", "\n", ";", " ", "/", "\\"]) {
    assert.ok(!name.includes(dangerous), `el nombre no debe contener ${JSON.stringify(dangerous)}`);
  }
});

test("el nombre se resuelve en hora de Panamá, no en la del servidor", () => {
  // 2026-09-01T02:00Z son todavía las 21:00 del 31 de agosto en Panamá, así que
  // el último día del informe es el 31 y no el 1 de septiembre.
  const to = new Date("2026-09-01T02:00:00Z");
  const name = executiveReportFilename(day(2026, 8, 1), to, "es", PANAMA);
  assert.ok(name.includes("2026-08-31"), name);
});

// ---------------------------------------------------------------------------
// TEXTOS: cobertura, estados vacíos y metodología, en ambos idiomas
// ---------------------------------------------------------------------------

test("la sección de metodología existe y cubre los ocho puntos, en ES y EN", () => {
  const required = [
    "methodTimezone",
    "methodPeriod",
    "methodApprovalRate",
    "methodFunnel",
    "methodAttribution",
    "methodApprovedNotDisbursed",
    "methodSnapshotVsPeriod",
    "methodUnavailable",
  ];
  for (const file of ["../../../../messages/es.json", "../../../../messages/en.json"]) {
    const pdf = JSON.parse(read(file)).dashboard.analytics.pdf;
    for (const key of required) {
      assert.equal(typeof pdf[key], "string", `${file}: falta pdf.${key}`);
      assert.ok((pdf[key] as string).length > 30, `${file}: pdf.${key} es demasiado corto`);
    }
  }
});

test("la nota de comunicaciones niega las tasas que no existen", () => {
  for (const file of ["../../../../messages/es.json", "../../../../messages/en.json"]) {
    const note = JSON.parse(read(file)).dashboard.analytics.pdf.communicationsNote as string;
    assert.ok(/entrega|delivery/i.test(note));
    assert.ok(/WhatsApp/i.test(note));
  }
});

test("ES y EN tienen exactamente las mismas claves de PDF", () => {
  const keys = (o: Record<string, unknown>) => Object.keys(o).sort();
  const es = keys(JSON.parse(read("../../../../messages/es.json")).dashboard.analytics.pdf);
  const en = keys(JSON.parse(read("../../../../messages/en.json")).dashboard.analytics.pdf);
  assert.deepEqual(es, en);
  assert.ok(es.length > 25);
});

// ---------------------------------------------------------------------------
// PII — el documento circula
// ---------------------------------------------------------------------------

test("el generador no accede a ningún campo de datos personales", () => {
  const report = read("./executive-report.ts");
  for (const field of [
    "fullName",
    "applicantFullName",
    "identificationNumber",
    "cedula",
    "applicantEmail",
    "applicantPhone",
    "address",
  ]) {
    assert.ok(!report.includes(field), `el PDF no debe leer "${field}"`);
  }
});

test("un perfil sin nombre resuelto se omite en vez de imprimir su identificador", () => {
  const report = read("./executive-report.ts");
  assert.ok(report.includes("nameByProfileId[row.profileId] &&"), "debe filtrar por nombre resuelto");
  assert.ok(
    !/\brow\.profileId,\s*$/m.test(report),
    "el profileId no debe renderizarse como celda"
  );
});

// ---------------------------------------------------------------------------
// FALLOS — un informe de ceros sería peor que ninguno
// ---------------------------------------------------------------------------

test("si la consulta falla NO se genera un PDF de ceros", () => {
  const route = read("../../../app/api/informe-ejecutivo/route.ts");
  // Dentro del CUERPO del handler: en los imports `renderExecutiveReport`
  // aparece antes por fuerza y la comparación no diría nada.
  const body = route.slice(route.indexOf("export async function GET"));
  const failAt = body.indexOf('"REPORT_UNAVAILABLE"');
  const renderAt = body.indexOf("renderExecutiveReport(");
  assert.ok(failAt > 0, "debe existir una salida de error para la lectura fallida");
  assert.ok(renderAt > 0 && failAt < renderAt, "el error debe cortar ANTES de renderizar");
});

test("un fallo del renderizador no filtra la traza al cliente", () => {
  const route = read("../../../app/api/informe-ejecutivo/route.ts");
  assert.ok(route.includes('"REPORT_RENDER_FAILED"'));
  // Lo único que sale es un código; el detalle va al registro del servidor.
  assert.ok(!/error:\s*error\b/.test(route), "no debe devolverse el objeto de error");
  assert.ok(!route.includes("error.stack"), "no debe devolverse la traza");
});

test("el PDF no se persiste en ningún sitio", () => {
  const route = read("../../../app/api/informe-ejecutivo/route.ts");
  // Se examina el CÓDIGO, no los comentarios: el propio encabezado explica que
  // no se usa Storage, y buscar la palabra a secas encontraría esa explicación.
  const code = route
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  for (const forbidden of ["storage", "writeFile", "upload", ".insert("]) {
    assert.ok(
      !code.toLowerCase().includes(forbidden.toLowerCase()),
      `no debe persistir: ${forbidden}`
    );
  }
});
