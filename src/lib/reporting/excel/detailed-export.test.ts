import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { detailedExportFilename } from "./filename.ts";
import { DELEGATABLE_CAPABILITIES, ROLE_CAPABILITIES } from "../../auth/capabilities.ts";

/**
 * ============================================================================
 * MILESTONE 26B-26F — LO QUE UN EXTRACTO DE PII NO PERDONA
 * ============================================================================
 *
 * El PDF de 26B-26E circula, pero no identifica a nadie. Este archivo sí:
 * nombres, cédulas, teléfonos, correos, empresas y salarios de clientes reales
 * de una financiera panameña. Una vez descargado no se puede revocar, ni
 * rastrear, ni borrar a distancia.
 *
 * Estas pruebas defienden las cinco cosas que no se ven abriendo el archivo:
 * quién puede generarlo, que la descarga queda registrada, que lo prohibido no
 * está dentro, que ningún identificador interno se cuela, y que el nombre del
 * fichero no puede romper una cabecera HTTP.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** El cuerpo de un módulo sin sus comentarios — para no acertar en una nota. */
const codeOnly = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");

const ROUTE = "../../../app/api/exportacion-detallada/route.ts";
const SERVICE = "../../services/reporting-export.ts";

// ---------------------------------------------------------------------------
// 1. UNA CAPACIDAD PROPIA, NO LA DEL DASHBOARD
// ---------------------------------------------------------------------------

test("reports:export_sensitive existe y NO es analytics:view", () => {
  const capabilities = read("../../auth/capabilities.ts");
  assert.ok(capabilities.includes('| "reports:export_sensitive"'), "falta la capacidad");
  // Dos filas distintas de la matriz. Que hoy las tengan los mismos roles no las
  // hace la misma: la separación es lo que permite que un día se muevan aparte.
  assert.ok(capabilities.includes('| "analytics:view"'));
});

test("la tienen administrador y gerente, y solo ellos", () => {
  const holders = (Object.keys(ROLE_CAPABILITIES) as (keyof typeof ROLE_CAPABILITIES)[]).filter(
    (role) => (ROLE_CAPABILITIES[role] as readonly string[]).includes("reports:export_sensitive")
  );
  assert.deepEqual(holders.sort(), ["administrador", "gerente"]);
});

test("asesor, compliance y consulta NO pueden exportar datos personales", () => {
  for (const role of ["asesor", "compliance", "consulta"] as const) {
    assert.ok(
      !(ROLE_CAPABILITIES[role] as readonly string[]).includes("reports:export_sensitive"),
      `${role} no deberia poder descargar PII`
    );
  }
});

test("no se puede delegar: sacar PII de la empresa se cambia con el rol, a la vista", () => {
  assert.ok(
    !(DELEGATABLE_CAPABILITIES as readonly string[]).includes("reports:export_sensitive"),
    "no debe poder concederse a un individuo por delegacion"
  );
});

// ---------------------------------------------------------------------------
// 2. LA PUERTA ESTÁ EN EL SERVIDOR, Y ES LO PRIMERO
// ---------------------------------------------------------------------------

test("la ruta exige la capacidad ANTES de leer un solo parámetro", () => {
  const route = read(ROUTE);
  assert.ok(route.includes('requireCapability("reports:export_sensitive")'));
  assert.ok(
    !route.includes('requireCapability("analytics:view")'),
    "esta ruta no se protege con la capacidad del Dashboard"
  );

  const authAt = route.indexOf("requireCapability");
  const parseAt = route.indexOf("resolvePeriodFromParams(");
  assert.ok(authAt > 0 && parseAt > authAt, "autorizar primero, validar despues");
});

test("sin capacidad no se pide ni un dato personal: el 403 sale antes de la base", () => {
  const body = read(ROUTE).slice(read(ROUTE).indexOf("export async function GET"));
  const denyAt = body.indexOf('auth.status === "denied"');
  const fetchAt = body.indexOf("getDetailedExportData(");
  assert.ok(denyAt > 0, "debe existir la comprobacion de denegacion");
  assert.ok(fetchAt > denyAt, "la lectura del detalle debe ocurrir DESPUES del rechazo");
});

test("el botón se dibuja solo si el servidor ya resolvió la capacidad", () => {
  const page = read("../../../app/(app)/dashboard/page.tsx");
  assert.ok(page.includes('requireCapability("reports:export_sensitive")'));
  assert.ok(page.includes("canExportSensitive={canExportSensitive}"));

  const section = read("../../../components/dashboard/analytics/analytics-section.tsx");
  assert.ok(
    section.includes("{canExportSensitive && <ExcelDownloadButton />}"),
    "el boton debe depender del booleano resuelto en el servidor"
  );

  // Y el componente de cliente no vuelve a decidir por su cuenta: una segunda
  // comprobacion es una segunda oportunidad de discrepar con la primera.
  const button = read("../../../components/dashboard/analytics/excel-download-button.tsx");
  assert.ok(!button.includes("role ==="), "el boton no debe comparar roles");
  assert.ok(!button.includes("ROLE_CAPABILITIES"), "el boton no debe leer la matriz");
});

// ---------------------------------------------------------------------------
// 3. SIN AUDITORÍA NO HAY DESCARGA
// ---------------------------------------------------------------------------

test("la descarga se registra ANTES de entregar los bytes", () => {
  const body = read(ROUTE).slice(read(ROUTE).indexOf("export async function GET"));
  const auditAt = body.indexOf("recordSensitiveExportEvent(");
  const renderAt = body.indexOf("renderDetailedExport(");
  assert.ok(auditAt > 0, "debe registrarse el evento");
  assert.ok(renderAt > auditAt, "el registro debe preceder a la generacion del libro");
  assert.ok(
    body.includes('"EXPORT_AUDIT_FAILED"'),
    "un fallo de auditoria debe cortar la descarga, no ignorarse"
  );
});

test("el evento va por la RPC auditada, nunca por un insert directo", () => {
  const service = codeOnly(read(SERVICE));
  assert.ok(service.includes('rpc("record_sensitive_export_event"'));
  // `crm_events` concede a service_role solo SELECT: un insert directo ni
  // siquiera funcionaria, y escribirlo sugeriria que existe otro camino.
  assert.ok(!service.includes(".insert("), "no debe insertar directamente");
  assert.ok(!service.includes(".update("), "la exportacion es de solo lectura");
  assert.ok(!service.includes(".delete("), "la exportacion es de solo lectura");
});

test("el evento guarda recuentos, nunca contenido exportado", () => {
  const migration = read(
    "../../../../supabase/migrations/20260831220000_milestone_26b26f_sensitive_export_audit.sql"
  );
  assert.ok(migration.includes("'sensitive_export_generated'"));
  assert.ok(migration.includes("security definer"));
  assert.ok(migration.includes("set search_path = public, pg_temp"));
  assert.ok(migration.includes("grant execute on function"));
  assert.ok(migration.includes("to service_role"));
  // Nada de la PII entra en el registro que existe para vigilarla.
  for (const forbidden of ["full_name", "applicant_email", "identification_number", "phone"]) {
    assert.ok(!migration.includes(forbidden), `el evento no debe guardar ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// 4. LO QUE NO PUEDE ESTAR DENTRO DEL ARCHIVO
// ---------------------------------------------------------------------------

test("el detalle nunca lee secretos, rutas de almacenamiento ni contenido", () => {
  const service = codeOnly(read(SERVICE));
  for (const forbidden of [
    "storage_path",
    "storage_bucket",
    "file_sha256",
    "signedUrl",
    "createSignedUrl",
    "password",
    "token",
    "api_key",
    "raw_payload",
  ]) {
    assert.ok(!service.includes(forbidden), `el extracto no debe tocar "${forbidden}"`);
  }
});

test("la nota interna del seguimiento no se selecciona siquiera", () => {
  const service = codeOnly(read(SERVICE));
  // Es texto libre que un asesor escribe para sus compañeros. Se comprueba que
  // no aparece en la lista de columnas pedidas a la base.
  assert.ok(!/["'\s]note,/.test(service), "no debe seleccionarse `note`");
  assert.ok(!/,\s*note["'\s]/.test(service), "no debe seleccionarse `note`");

  const types = read("../export-types.ts");
  assert.ok(!/^\s*note[?]?:/m.test(types), "el contrato no debe tener campo de nota");
});

test("el contrato del detalle no expone ningún identificador interno", () => {
  const types = read("../export-types.ts");
  // `applicationNumber` sí — es el identificador que ODL ya usa en voz alta.
  // Un `uuid` no le dice nada a quien lee y sí a quien reciba el archivo por
  // error.
  for (const forbidden of ["clientId", "applicationId", "intakeId", "slotId", "profileId"]) {
    assert.ok(!types.includes(`${forbidden}:`), `el contrato no debe exponer "${forbidden}"`);
  }
});

test("el libro no imprime el identificador de un perfil sin nombre: lo omite", () => {
  const workbook = read("./workbook.ts");
  assert.ok(
    workbook.includes("snapshot.team.filter((row) => nameByProfileId[row.profileId])"),
    "un perfil sin nombre resuelto debe omitirse"
  );
  assert.ok(
    !/value:\s*\(r\)\s*=>\s*r\.profileId/.test(workbook),
    "el profileId no debe renderizarse como celda"
  );
});

test("el libro no vuelve a calcular una sola métrica: las recibe hechas", () => {
  const workbook = codeOnly(read("./workbook.ts"));
  for (const forbidden of ["supabase", ".rpc(", "SELECT ", "reporting_lead_metrics", ".reduce("]) {
    assert.ok(!workbook.includes(forbidden), `el generador no debe calcular ni consultar: ${forbidden}`);
  }
  // La única fuente de los agregados, la misma del Dashboard y del PDF.
  assert.ok(read(ROUTE).includes("getReportingComparison"));
});

test("el estado «sin aprobaciones» sale de la MISMA clave que el Dashboard y el PDF", () => {
  // 26B-26F.1. Si el Excel tuviera su propia traducción de la frase, las tres
  // superficies podrían acabar diciendo cosas distintas sobre el mismo hecho.
  const workbook = read("./workbook.ts");
  assert.ok(workbook.includes('tKpis("approvedEmpty")'), "debe reutilizar kpis.approvedEmpty");

  for (const source of [
    "../pdf/executive-report.ts",
    "../../../components/dashboard/analytics/analytics-section.tsx",
  ]) {
    assert.ok(read(source).includes("approvedEmpty"), `${source} usa otra clave`);
  }

  // Y el predicado es el mismo recuento, no uno parecido.
  const summary = read("./summary.ts");
  assert.ok(summary.includes("approvedCount === 0"));
  assert.ok(
    read("../../../components/dashboard/analytics/analytics-section.tsx").includes(
      "current.financial.approvedCount === 0"
    ),
    "el Dashboard debe seguir usando financial.approvedCount"
  );
});

test("el estado «sin decisiones» sale también de la clave compartida", () => {
  // 26B-26F.2. Última diferencia semántica entre las tres superficies: el
  // Dashboard y el PDF ya escribían «Sin decisiones» donde el Excel dejaba un
  // hueco. Misma clave, no una copia con el mismo texto.
  assert.ok(read("./workbook.ts").includes('tKpis("approvalRateEmpty")'));

  for (const source of [
    "../pdf/executive-report.ts",
    "../../../components/dashboard/analytics/analytics-section.tsx",
  ]) {
    assert.ok(read(source).includes("approvalRateEmpty"), `${source} usa otra clave`);
  }

  // Y las dos traducciones oficiales siguen siendo las que espera el negocio.
  const kpis = (file: string) => JSON.parse(read(file)).dashboard.analytics.kpis;
  assert.equal(kpis(MESSAGES[0]).approvalRateEmpty, "Sin decisiones");
  assert.equal(kpis(MESSAGES[1]).approvalRateEmpty, "No decisions");
  assert.equal(kpis(MESSAGES[0]).approvedEmpty, "Sin aprobaciones");
  assert.equal(kpis(MESSAGES[1]).approvedEmpty, "No approvals");
});

test("la metodología describe la tasa como la muestra de verdad, no como la mostraba antes", () => {
  // Una nota que dijera «la celda queda vacía» seria falsa desde 26B-26F.2, y
  // una metodologia que no describe la hoja es peor que no tenerla.
  for (const [file, needle] of [
    [MESSAGES[0], "Sin decisiones"],
    [MESSAGES[1], "No decisions"],
  ] as const) {
    const note = JSON.parse(read(file)).dashboard.analytics.excel.methodology.approvalRate as string;
    assert.ok(note.includes(needle), `${file}: la nota no nombra el estado real`);
    assert.ok(!/queda vacía|is left empty/.test(note), `${file}: la nota sigue diciendo que va vacia`);
    // Y sigue declarando el denominador oficial, con las canceladas fuera.
    assert.match(note, /cancelad|cancelled/i);
  }
});

test("la hoja Resumen se arma en el módulo puro, donde puede probarse", () => {
  const workbook = read("./workbook.ts");
  assert.ok(workbook.includes("buildSummaryRows(reporting,"));
  assert.ok(workbook.includes("summaryCellKind("));
});

test("el extracto no se persiste en ningún sitio", () => {
  const route = codeOnly(read(ROUTE));
  for (const forbidden of ["storage", "writeFile", "upload", ".insert("]) {
    assert.ok(
      !route.toLowerCase().includes(forbidden.toLowerCase()),
      `no debe persistirse: ${forbidden}`
    );
  }
  assert.ok(route.includes('"Cache-Control": "no-store'), "datos personales no se cachean");
});

test("un fallo no produce un libro a medias ni filtra la traza", () => {
  const route = read(ROUTE);
  const body = route.slice(route.indexOf("export async function GET"));
  const failAt = body.indexOf('"EXPORT_UNAVAILABLE"');
  const renderAt = body.indexOf("renderDetailedExport(");
  assert.ok(failAt > 0 && failAt < renderAt, "el error debe cortar ANTES de generar");
  assert.ok(route.includes('"EXPORT_RENDER_FAILED"'));
  assert.ok(!route.includes("error.stack"), "no debe devolverse la traza");
  assert.ok(!/error:\s*error\b/.test(route), "no debe devolverse el objeto de error");
});

// ---------------------------------------------------------------------------
// 5. UNA SOLA DEFINICIÓN DE CADA REGLA DE NEGOCIO
// ---------------------------------------------------------------------------

test("el estado del portal se clasifica con el módulo compartido, no con umbrales propios", () => {
  const service = read(SERVICE);
  assert.ok(service.includes("classifyPortalFunnelState"));
  // Ni un umbral escrito a mano: una segunda definicion de «abandonado» haria
  // que el Excel y el Dashboard discreparan sin que nadie lo notara.
  assert.ok(!/72\s*\*\s*60/.test(service), "los umbrales no se duplican aqui");
  assert.ok(!/7\s*\*\s*24\s*\*\s*60/.test(service), "los umbrales no se duplican aqui");
});

test("el período se resuelve con el analizador del Dashboard, no con una copia", () => {
  assert.ok(read(ROUTE).includes('from "@/lib/reporting/period-params"'));
});

test("el nombre del archivo comparte la frontera de cabecera con el PDF", () => {
  const excel = read("./filename.ts");
  const pdf = read("../pdf/filename.ts");
  for (const source of [excel, pdf]) {
    assert.ok(source.includes("safeDownloadName"), "ambos deben usar el mismo saneado");
    assert.ok(source.includes("reportDateRange"), "ambos deben usar el mismo rango");
  }
});

// ---------------------------------------------------------------------------
// 6. EL NOMBRE DEL ARCHIVO
// ---------------------------------------------------------------------------

const PANAMA = "America/Panama";
const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 5, 0, 0));

test("el nombre lleva el rango, el idioma y la palabra que avisa del contenido", () => {
  const from = day(2026, 8, 1);
  const to = day(2026, 9, 1); // fin EXCLUSIVO
  assert.equal(
    detailedExportFilename(from, to, "es", PANAMA),
    "ODL-Informe-Detallado-2026-08-01_2026-08-31.xlsx"
  );
  assert.equal(
    detailedExportFilename(from, to, "en", PANAMA),
    "ODL-Detailed-Report-2026-08-01_2026-08-31.xlsx"
  );
});

test("un solo día no repite la fecha", () => {
  assert.equal(
    detailedExportFilename(day(2026, 8, 29), day(2026, 8, 30), "es", PANAMA),
    "ODL-Informe-Detallado-2026-08-29.xlsx"
  );
});

test("el nombre no puede romper la cabecera Content-Disposition", () => {
  const name = detailedExportFilename(day(2026, 1, 1), day(2027, 1, 1), "es", PANAMA);
  assert.match(name, /^[A-Za-z0-9._-]+\.xlsx$/);
  for (const dangerous of ['"', "\r", "\n", ";", " ", "/", "\\"]) {
    assert.ok(!name.includes(dangerous), `el nombre no debe contener ${JSON.stringify(dangerous)}`);
  }
});

test("el nombre se resuelve en hora de Panamá, no en la del servidor", () => {
  // 2026-09-01T02:00Z son las 21:00 del 31 de agosto en Panamá.
  const name = detailedExportFilename(day(2026, 8, 1), new Date("2026-09-01T02:00:00Z"), "es", PANAMA);
  assert.ok(name.includes("2026-08-31"), name);
});

// ---------------------------------------------------------------------------
// 7. LOS TEXTOS: PARIDAD Y LAS ADVERTENCIAS QUE NO PUEDEN FALTAR
// ---------------------------------------------------------------------------

const MESSAGES = ["../../../../messages/es.json", "../../../../messages/en.json"] as const;

const excelBlock = (file: string) => JSON.parse(read(file)).dashboard.analytics.excel;

test("ES y EN tienen exactamente las mismas claves de Excel", () => {
  const keys = (o: unknown, prefix = ""): string[] =>
    o && typeof o === "object"
      ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
          keys(v, prefix ? `${prefix}.${k}` : k)
        )
      : [prefix];
  const es = keys(excelBlock(MESSAGES[0])).sort();
  const en = keys(excelBlock(MESSAGES[1])).sort();
  assert.deepEqual(es, en);
  assert.ok(es.length > 100, "el bloque deberia ser sustancial");
});

test("las ocho hojas están nombradas en los dos idiomas", () => {
  for (const file of MESSAGES) {
    const sheets = excelBlock(file).sheets as Record<string, string>;
    assert.deepEqual(Object.keys(sheets).sort(), [
      "acquisition",
      "applications",
      "documents",
      "followUps",
      "leads",
      "methodology",
      "summary",
      "team",
    ]);
    for (const [key, name] of Object.entries(sheets)) {
      // Excel rechaza nombres de hoja de más de 31 caracteres.
      assert.ok(name.length > 0 && name.length <= 31, `${file}: ${key} = "${name}"`);
    }
  }
});

test("la metodología avisa de que el archivo lleva datos personales, en ES y EN", () => {
  for (const [file, needle] of [
    [MESSAGES[0], "datos personales"],
    [MESSAGES[1], "personal data"],
  ] as const) {
    // La fila entera, tema y explicación, que es como se lee en la hoja: el
    // aviso lo da el título y el detalle lo desarrolla.
    const { piiTopic, pii } = excelBlock(file).methodology as Record<string, string>;
    assert.ok(
      `${piiTopic} ${pii}`.toLowerCase().includes(needle),
      `${file}: falta el aviso de PII`
    );
    assert.ok(pii.length > 100, `${file}: el aviso es demasiado corto para decir algo`);
    // Y dice lo que de verdad importa: que una vez fuera ya no se puede deshacer.
    assert.match(pii, /revoc|delet|borrar|rastre|trace/i);
  }
});

test("la metodología declara que «aprobado» NO es desembolsado, en ES y EN", () => {
  for (const [file, needle] of [
    [MESSAGES[0], "NO representa desembolsos realizados"],
    [MESSAGES[1], "does NOT represent disbursements made"],
  ] as const) {
    assert.ok(
      (excelBlock(file).methodology.approved as string).includes(needle),
      `${file}: falta la declaracion explicita`
    );
  }
});

test("la metodología enumera lo que el archivo NO contiene, en ambos idiomas", () => {
  for (const file of MESSAGES) {
    const excluded = (excelBlock(file).methodology.excluded as string).toLowerCase();
    for (const term of ["token", "api"]) {
      assert.ok(excluded.includes(term), `${file}: la lista de exclusiones no menciona "${term}"`);
    }
  }
});

test("cada hoja tiene su propia frase de vacío, y ninguna es un guion", () => {
  for (const file of MESSAGES) {
    const empty = excelBlock(file).empty as Record<string, string>;
    for (const key of [
      "summary",
      "applications",
      "leads",
      "documents",
      "followUps",
      "acquisition",
      "acquisitionUncovered",
      "team",
    ]) {
      assert.equal(typeof empty[key], "string", `${file}: falta empty.${key}`);
      assert.ok(empty[key].length > 10, `${file}: empty.${key} no puede ser un guion`);
    }
    // «No hubo campañas» y «no lo estábamos midiendo» son cosas distintas.
    assert.notEqual(empty.acquisition, empty.acquisitionUncovered);
  }
});

test("ningún texto del Excel afirma «prestado», «desembolsado» ni «cartera»", () => {
  for (const file of MESSAGES) {
    const excel = excelBlock(file);
    const flat = JSON.stringify(excel).toLowerCase();
    // La única frase donde esas palabras pueden aparecer es la que NIEGA que el
    // dato exista. Se descuenta y se comprueba que no quedan en ningún otro sitio.
    const outside = flat.replace((excel.methodology.approved as string).toLowerCase(), "");
    for (const word of ["desembolsado", "cartera colocada", "loan book", "disbursements made"]) {
      assert.ok(!outside.includes(word), `${file} usa "${word}" fuera de la nota aclaratoria`);
    }
  }
});
