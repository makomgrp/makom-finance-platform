import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applicationDossierFilename } from "./dossier-filename.ts";

/**
 * ============================================================================
 * MILESTONE 26B-27A — LO QUE UN EXPEDIENTE IMPRESO NO PERDONA
 * ============================================================================
 *
 * Este PDF lleva nombre, cédula, teléfono, dirección, patrono y salario de una
 * persona real. Se imprime, se lleva a un comité y se queda en una carpeta.
 *
 * Cuatro cosas no se pueden comprobar mirándolo: que solo lo obtenga quien ya
 * podía abrir el expediente, que no arrastre el contenido de los documentos,
 * que no saque las notas internas, y que su nombre de archivo no delate al
 * titular en la carpeta de descargas.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** El cuerpo de un módulo sin comentarios — para no acertar en una nota. */
const codeOnly = (source: string) =>
  source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n");

const ROUTE = read("../../../app/api/solicitudes/[applicationId]/pdf/route.ts");
const PAGE = read("../../../app/(app)/solicitudes/[applicationId]/page.tsx");
const RENDERER = read("./application-dossier.ts");

// ---------------------------------------------------------------------------
// 1. LA MISMA PUERTA QUE LA PANTALLA — NI UNA MÁS, NI UNA MENOS
// ---------------------------------------------------------------------------

test("la ruta repite los tres pasos de autorización del expediente", () => {
  // Si la pantalla y el PDF usaran reglas distintas, alguien podría abrir una y
  // no la otra. Se comprueban los tres, en la ruta Y en la página.
  for (const guard of [
    "getCurrentProfile()",
    "getApplicationListItemById(scope, applicationId)",
    "isStaffManageableApplication(application)",
  ]) {
    assert.ok(ROUTE.includes(guard), `la ruta debe usar ${guard}`);
  }
  assert.ok(PAGE.includes("getApplicationListItemById(scope, applicationId)"));
  assert.ok(PAGE.includes("isStaffManageableApplication(application)"));
});

test("el orden importa: identidad, alcance y tipo ANTES de leer el expediente", () => {
  const body = ROUTE.slice(ROUTE.indexOf("export async function GET"));
  const profileAt = body.indexOf("getCurrentProfile()");
  const scopedAt = body.indexOf("getApplicationListItemById(");
  const manageableAt = body.indexOf("isStaffManageableApplication(");
  const loadAt = body.indexOf("getApplicationStep2(");

  assert.ok(profileAt > 0 && scopedAt > profileAt, "el alcance se resuelve tras la identidad");
  assert.ok(manageableAt > scopedAt, "el tipo se comprueba tras el alcance");
  assert.ok(loadAt > manageableAt, "los datos se cargan al final");
});

test("NO introduce una capacidad propia: el expediente no se protege así", () => {
  // El acceso al expediente lo decide el alcance de sucursal desde 26B-5. Una
  // capacidad nueva aquí sería una segunda regla para la misma pregunta.
  // Se examina el CÓDIGO: la cabecera del fichero EXPLICA que no se usa
  // `requireCapability`, y buscar la palabra a secas encontraría esa explicación.
  assert.ok(!codeOnly(ROUTE).includes("requireCapability"), "no debe inventar una capacidad");
  assert.ok(!codeOnly(PAGE).includes("requireCapability"), "la pantalla tampoco usa una");
});

test("fuera de alcance, inexistente y borrador del portal responden IGUAL", () => {
  // Un 403 distinguible convertiría esta URL en una forma de confirmar que un
  // expediente existe en una sucursal que quien pregunta no puede ver.
  const notFounds = ROUTE.match(/status: 404/g) ?? [];
  assert.ok(notFounds.length >= 2, "ambos caminos deben devolver 404");
  assert.ok(!ROUTE.includes("status: 403"), "no debe existir un 403 distinguible");
});

test("sin sesión responde 401 en JSON, no una redirección a /login", () => {
  // Es una API: la convención del proyecto es devolver un código, no redirigir.
  assert.ok(ROUTE.includes('{ error: "UNAUTHENTICATED" }'));
  assert.ok(ROUTE.includes("status: 401"));
  assert.ok(!ROUTE.includes("redirect("), "una API no redirige");
});

// ---------------------------------------------------------------------------
// 2. EL CONTENIDO DE LOS DOCUMENTOS SE QUEDA FUERA
// ---------------------------------------------------------------------------

test("el generador nunca lee rutas de almacenamiento, hashes ni nombres de archivo", () => {
  const code = codeOnly(RENDERER);
  for (const forbidden of [
    "storagePath",
    "storageBucket",
    "fileSha256",
    "fileName",
    "mimeType",
    "fileSizeBytes",
    "signedUrl",
    "createSignedUrl",
  ]) {
    assert.ok(!code.includes(forbidden), `el PDF no debe tocar "${forbidden}"`);
  }
});

test("de las evidencias solo se leen recuento y fechas", () => {
  const code = codeOnly(RENDERER);
  for (const allowed of ["uploadedAt", "reviewedAt", "requirementSlotId"]) {
    assert.ok(code.includes(allowed), `deberia usar ${allowed}`);
  }
});

// ---------------------------------------------------------------------------
// 3. LAS NOTAS INTERNAS NO SALEN DE LA HERRAMIENTA
// ---------------------------------------------------------------------------

test("no se imprimen las observaciones libres del cliente ni las de la revisión", () => {
  const code = codeOnly(RENDERER);
  // `client.observations` es texto libre del expediente del cliente.
  assert.ok(!code.includes("observations"), "no debe leer observaciones libres");
  // `items[].note` son apuntes por ítem de la revisión.
  assert.ok(!/\.items\b/.test(code), "no debe recorrer los items de la revision");
  // `observations[].body` es el cuerpo de las observaciones del analista. Se
  // busca la RUTA, no la palabra: `INK.body` es el color de la tinta.
  assert.ok(!/review\.observations/.test(code), "no debe recorrer las observaciones");
  assert.ok(!/observation\.body|\.observations\b/.test(code), "no debe imprimir su cuerpo");
});

test("la razón de la recomendación SÍ se imprime, y es deliberado", () => {
  // No es un apunte privado: es la explicación formal que acompaña a una
  // recomendación, que es justo lo que un comité necesita leer.
  assert.ok(RENDERER.includes("review.recommendationNote"));
});

// ---------------------------------------------------------------------------
// 4. DINERO
// ---------------------------------------------------------------------------

test("solicitado y aprobado se mantienen separados, y ninguno pisa al otro", () => {
  assert.ok(RENDERER.includes("application.requestedAmount"));
  assert.ok(RENDERER.includes("application.approvedAmount"));
  // Sin decisión se dice, en vez de imprimir un cero que se leería como
  // «se aprobó cero».
  assert.ok(RENDERER.includes('tPdf("noApprovedAmount")'));
});

test("el generador nunca afirma «prestado», «desembolsado» ni «cartera»", () => {
  // ODL no tiene modelo de desembolso: no hay tabla, ni fecha, ni saldo.
  const patterns = [/\blent\b/i, /\bdisburs/i, /\bportfolio\b/i, /\bdesembols/i, /\bcartera\b/i];
  for (const line of RENDERER.split("\n")) {
    if (/no existe|nunca|NO ES|no hay|no registra/i.test(line)) continue;
    for (const pattern of patterns) {
      assert.ok(!pattern.test(line), `application-dossier.ts: "${line.trim()}"`);
    }
  }
});

// ---------------------------------------------------------------------------
// 5. REGISTROS Y PERSISTENCIA
// ---------------------------------------------------------------------------

test("el registro de errores no lleva ni un dato del expediente", () => {
  const body = ROUTE.slice(ROUTE.indexOf("catch"));
  assert.ok(body.includes("applicationId"), "el id tecnico sirve para depurar");
  for (const forbidden of ["fullName", "client.", "application.", "identificationNumber", "email"]) {
    assert.ok(!body.includes(forbidden), `el log no debe incluir ${forbidden}`);
  }
});

test("el PDF no se guarda en ningún sitio", () => {
  const code = codeOnly(ROUTE);
  for (const forbidden of ["storage", "upload", "writeFile", ".insert("]) {
    assert.ok(!code.toLowerCase().includes(forbidden.toLowerCase()), `no debe persistir: ${forbidden}`);
  }
});

test("no se cachea en ningún punto del camino", () => {
  assert.ok(ROUTE.includes('"Cache-Control": "private, no-store, must-revalidate"'));
});

test("la respuesta es un PDF adjunto", () => {
  assert.ok(ROUTE.includes('"Content-Type": "application/pdf"'));
  assert.ok(ROUTE.includes("attachment; filename="));
  assert.ok(ROUTE.includes('"Content-Length"'));
});

// ---------------------------------------------------------------------------
// 6. EL NOMBRE DEL ARCHIVO
// ---------------------------------------------------------------------------

test("una solicitud formalizada se nombra por su número oficial", () => {
  assert.equal(
    applicationDossierFilename(
      { applicationNumber: "ODL-24AGO26-0007-N", applicationId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
      "es"
    ),
    "ODL-Solicitud-ODL-24AGO26-0007-N.pdf"
  );
  assert.equal(
    applicationDossierFilename(
      { applicationNumber: "ODL-24AGO26-0007-N", applicationId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
      "en"
    ),
    "ODL-Application-ODL-24AGO26-0007-N.pdf"
  );
});

test("un borrador se anuncia como tal y NO recibe un número inventado", () => {
  const name = applicationDossierFilename(
    { applicationId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
    "es"
  );
  assert.equal(name, "ODL-Solicitud-Borrador-aaaaaaaa.pdf");
  // Ni el uuid completo ni nada con forma de número oficial.
  assert.ok(!name.includes("aaaaaaaa-bbbb"), "no debe llevar el uuid entero");
});

test("dos borradores distintos no se pisan en la carpeta de descargas", () => {
  const a = applicationDossierFilename({ applicationId: "11111111-2222-3333-4444-555555555555" }, "es");
  const b = applicationDossierFilename({ applicationId: "99999999-2222-3333-4444-555555555555" }, "es");
  assert.notEqual(a, b);
});

test("el nombre no lleva NI UN dato personal y no rompe la cabecera", () => {
  const name = applicationDossierFilename(
    { applicationNumber: "ODL-24AGO26-0007-N", applicationId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" },
    "es"
  );
  assert.match(name, /^[A-Za-z0-9._-]+\.pdf$/);
  for (const dangerous of ['"', "\r", "\n", ";", " ", "/", "\\"]) {
    assert.ok(!name.includes(dangerous), `no debe contener ${JSON.stringify(dangerous)}`);
  }
  // El generador del nombre no recibe siquiera el nombre del cliente.
  const source = read("./dossier-filename.ts");
  for (const forbidden of ["fullName", "clientFullName", "identification", "phone", "email"]) {
    assert.ok(!source.includes(forbidden), `el nombre no debe conocer ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// 7. BORRADOR VS FORMAL, DENTRO DEL DOCUMENTO
// ---------------------------------------------------------------------------

test("un borrador se anuncia en el cuerpo y no finge tener número", () => {
  assert.ok(RENDERER.includes("const isDraft = !application.applicationNumber"));
  assert.ok(RENDERER.includes('tPdf("draftNotice")'));
});

test("los metadatos del PDF no llevan el nombre del solicitante", () => {
  const info = RENDERER.slice(RENDERER.indexOf("info: {"), RENDERER.indexOf("});", RENDERER.indexOf("info: {")));
  for (const forbidden of ["clientFullName", "fullName", "client."]) {
    assert.ok(!info.includes(forbidden), `los metadatos no deben llevar ${forbidden}`);
  }
});

// ---------------------------------------------------------------------------
// 8. REUTILIZACIÓN Y TEXTOS
// ---------------------------------------------------------------------------

test("reutiliza el motor y los ayudantes del informe ejecutivo", () => {
  assert.ok(RENDERER.includes('from "pdfkit"'), "mismo motor");
  assert.ok(RENDERER.includes('from "@/lib/reporting/pdf/layout"'), "mismos ayudantes");
  assert.ok(RENDERER.includes('from "@/lib/format"'), "mismo formato de moneda");
  assert.ok(RENDERER.includes("BUSINESS_TIME_ZONE"), "misma zona horaria");
  // Ninguna libreria de PDF nueva.
  const packageJson = JSON.parse(read("../../../../package.json"));
  const pdfLibs = Object.keys(packageJson.dependencies).filter((d) => /pdf/i.test(d));
  assert.deepEqual(pdfLibs, ["pdfkit"]);
});

test("el pie anula el margen inferior — el defecto que dejó seis páginas vacías", () => {
  assert.ok(RENDERER.includes("doc.page.margins.bottom = 0"));
});

test("cada página declara confidencialidad, período y numeración", () => {
  assert.ok(RENDERER.includes('tPdf("confidential")'));
  assert.ok(RENDERER.includes('tPdf("pageOf"'));
  assert.ok(RENDERER.includes("generatedAt"), "la fecha de generacion va en el pie");
});

test("ES y EN tienen exactamente las mismas claves del PDF, y ninguna vacía", () => {
  const keys = (o: Record<string, unknown>) => Object.keys(o).sort();
  const es = JSON.parse(read("../../../../messages/es.json")).applicationDossier.pdf;
  const en = JSON.parse(read("../../../../messages/en.json")).applicationDossier.pdf;
  assert.deepEqual(keys(es), keys(en));
  assert.ok(keys(es).length > 20);
  for (const [key, value] of Object.entries(es)) {
    assert.ok(typeof value === "string" && value.length > 0, `es.${key} vacio`);
    assert.ok(typeof en[key] === "string" && en[key].length > 0, `en.${key} vacio`);
  }
});

test("la nota de confidencialidad nombra a ODL en los dos idiomas", () => {
  for (const file of ["../../../../messages/es.json", "../../../../messages/en.json"]) {
    const pdf = JSON.parse(read(file)).applicationDossier.pdf;
    assert.ok(pdf.confidential.includes("ODL Financial Corporation"), file);
    assert.match(pdf.confidential, /confidencial|confidential/i);
  }
});

// ---------------------------------------------------------------------------
// 9. ANCHURAS DE TABLA — EL FALLO QUE MATÓ UN SERVIDOR
// ---------------------------------------------------------------------------

/**
 * La primera versión pasó las anchuras como fracciones (0.38, 0.12…) donde el
 * contrato pide PUNTOS. `column.width - 12` quedaba negativo y pdfkit, tratando
 * de ajustar texto en una caja de ancho negativo, concatenó cadenas hasta
 * agotar 4 GB de heap y tumbar el servidor. TypeScript no podía verlo: fracción
 * y punto son ambos `number`.
 */
test("ninguna anchura de tabla es una fracción disfrazada de puntos", () => {
  const widths = [...RENDERER.matchAll(/width:\s*([\d.]+)\s*[,}]/g)].map((m) => Number(m[1]));
  assert.ok(widths.length >= 12, "deberia haber varias columnas que comprobar");
  for (const width of widths) {
    assert.ok(width >= 24, `ancho de columna sospechoso: ${width}pt`);
    assert.ok(Number.isInteger(width), `${width} no parece puntos`);
  }
});

test("cada tabla cabe en el ancho útil de la página", () => {
  // PAGE.contentWidth = 595.28 - 48*2 = 499.28.
  const CONTENT_WIDTH = 499.28;
  const tables = [...RENDERER.matchAll(/table\(\s*doc,\s*\[([\s\S]*?)\],/g)];
  assert.ok(tables.length >= 4, "deberia haber al menos cuatro tablas");
  for (const [, block] of tables) {
    const widths = [...block.matchAll(/width:\s*([\d.]+)/g)].map((m) => Number(m[1]));
    const total = widths.reduce((sum, w) => sum + w, 0);
    assert.ok(total > 0, "una tabla sin anchuras");
    assert.ok(total <= CONTENT_WIDTH, `una tabla suma ${total}pt y no cabe en ${CONTENT_WIDTH}pt`);
  }
});

test("el ayudante compartido rechaza una anchura imposible en vez de colgarse", () => {
  const layout = read("./layout.ts");
  assert.ok(layout.includes("column.width < 24"), "table() debe validar la anchura");
  assert.ok(layout.includes("throw new Error"), "debe fallar rapido, no consumir memoria");
});
