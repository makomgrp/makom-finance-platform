import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ROLE_CAPABILITIES } from "../auth/capabilities.ts";

/**
 * ============================================================================
 * MILESTONE 26B-26D — LAS GARANTÍAS QUE NO SE VEN EN LA PANTALLA
 * ============================================================================
 *
 * Tres promesas que un informe de dirección hace y que no se pueden comprobar
 * mirándolo: quién puede verlo, que no filtra datos personales, y que nunca
 * llama «prestado» a un monto aprobado.
 *
 * Las tres se rompen igual de fácil —una línea en la matriz, un campo añadido
 * a un tipo, una etiqueta mal elegida— y ninguna de las tres avisa al romperse.
 * Por eso se prueban leyendo los ficheros: es lo único que detecta la
 * regresión el día que alguien la introduzca sin querer.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// QUIÉN PUEDE VER LOS RESULTADOS DEL NEGOCIO
// ---------------------------------------------------------------------------

test("analytics:view lo tienen administrador y gerente, y solo ellos", () => {
  const holders = (Object.keys(ROLE_CAPABILITIES) as (keyof typeof ROLE_CAPABILITIES)[]).filter(
    (role) => (ROLE_CAPABILITIES[role] as readonly string[]).includes("analytics:view")
  );
  assert.deepEqual(holders.sort(), ["administrador", "gerente"]);
});

test("asesor, compliance y consulta NO ven el informe de gestión", () => {
  for (const role of ["asesor", "compliance", "consulta"] as const) {
    assert.ok(
      !(ROLE_CAPABILITIES[role] as readonly string[]).includes("analytics:view"),
      `${role} no deberia tener analytics:view`
    );
  }
});

test("la página exige la capacidad en el SERVIDOR, no solo escondiendo la sección", () => {
  const page = read("../../app/(app)/dashboard/page.tsx");
  assert.ok(
    page.includes('requireCapability("analytics:view")'),
    "la pagina debe pasar por la puerta de autorizacion del proyecto"
  );
  // Y los datos no se piden siquiera cuando no hay permiso: no hay respuesta
  // que interceptar ni peticion que reproducir a mano.
  assert.ok(
    /canSeeAnalytics \? getReportingComparison/.test(page),
    "la lectura de reporting debe estar condicionada a la capacidad"
  );
});

// ---------------------------------------------------------------------------
// SIN DATOS PERSONALES EN LA CAPA AGREGADA
// ---------------------------------------------------------------------------

test("el contrato de reporting no tiene ningún campo de datos personales", () => {
  const types = read("./types.ts");
  // `email` se excluye del patron a proposito: `emailsSent` y compania son
  // CONTEOS de correos, no direcciones.
  const forbidden = [
    "fullName",
    "full_name",
    "phone",
    "identificationNumber",
    "cedula",
    "address",
    "bodyText",
    "applicantName",
    "clientName",
  ];
  for (const field of forbidden) {
    assert.ok(!types.includes(field), `el contrato no debe exponer "${field}"`);
  }
});

test("el único identificador de persona del contrato es profileId", () => {
  const types = read("./types.ts");
  assert.ok(types.includes("profileId: string"));
  // Y el nombre se resuelve fuera, contra el directorio que quien mira ya puede
  // leer: la capa agregada no es el sitio donde ampliar el acceso a personas.
  const page = read("../../app/(app)/dashboard/page.tsx");
  assert.ok(page.includes("nameByProfileId"), "los nombres se resuelven en la pagina, no en el contrato");
});

test("la pantalla nunca muestra un UUID: los nombres se resuelven antes de pintar", () => {
  const team = read("../../components/dashboard/analytics/analytics-breakdown.tsx");
  assert.ok(
    team.includes("nameByProfileId[row.profileId]"),
    "la fila de equipo debe renderizar el nombre, no el id"
  );
  assert.ok(
    team.includes("rows = snapshot.team.filter((row) => nameByProfileId[row.profileId])"),
    "un perfil sin nombre resuelto se omite en lugar de mostrar su id"
  );
});

// ---------------------------------------------------------------------------
// TERMINOLOGÍA FINANCIERA
// ---------------------------------------------------------------------------

const DASHBOARD_SOURCES = [
  "./types.ts",
  "./presentation.ts",
  "../../components/dashboard/analytics/analytics-section.tsx",
  "../../components/dashboard/analytics/analytics-breakdown.tsx",
  "../../components/dashboard/analytics/analytics-primitives.tsx",
];

test("ninguna fuente del dashboard afirma «prestado», «desembolsado» ni «cartera»", () => {
  // ODL no tiene ese dato: no hay tabla de desembolsos, ni fecha, ni saldo.
  // `approved_amount` es una DECISION. Confundirlos seria el error mas caro que
  // este informe podria cometer.
  const patterns = [/\blent\b/i, /\bdisburs/i, /\bportfolio\b/i, /\bloan\s*book\b/i];
  for (const source of DASHBOARD_SOURCES) {
    const text = read(source);
    for (const line of text.split("\n")) {
      // Se permiten las lineas que EXPLICAN que el dato no existe.
      if (/no existe|nunca|NO SE|no hay|does not|refuses|se niega|NOT AVAILABLE|Available: boolean/i.test(line)) {
        continue;
      }
      for (const pattern of patterns) {
        assert.ok(!pattern.test(line), `${source}: "${line.trim()}"`);
      }
    }
  }
});

test("los textos visibles en ES y EN tampoco lo afirman", () => {
  for (const file of ["../../../messages/es.json", "../../../messages/en.json"]) {
    const analytics = JSON.parse(read(file)).dashboard.analytics;
    const flat = JSON.stringify(analytics).toLowerCase();
    for (const word of ["prestado", "desembolsado", "cartera", "disbursed amount", "loan book"]) {
      // «desembolsos» aparece SOLO en la nota que aclara que no se registran.
      if (word === "desembolsado" || word === "disbursed amount") {
        assert.ok(!flat.includes(word), `${file} afirma "${word}"`);
      } else {
        // Las frases que NIEGAN la existencia del dato son justamente la
        // declaración exigida. Se excluyen las dos que existen —la nota
        // financiera de la pantalla y la de metodología del PDF— y se comprueba
        // que la palabra no aparece en ningún otro sitio.
        const negaciones = [
          analytics.financial.notDisbursedNote as string,
          analytics.pdf?.methodApprovedNotDisbursed as string | undefined,
        ].filter(Boolean) as string[];
        let outside = flat;
        for (const negacion of negaciones) outside = outside.replace(negacion.toLowerCase(), "");
        assert.ok(!outside.includes(word), `${file} usa "${word}" fuera de una nota aclaratoria`);
      }
    }
  }
});

// ---------------------------------------------------------------------------
// ESTADOS VACÍOS — cada uno con su frase, ninguno con un guion
// ---------------------------------------------------------------------------

test("cada estado vacío tiene texto propio en los dos idiomas", () => {
  const required: [string, string][] = [
    ["kpis", "approvedEmpty"],
    ["kpis", "approvalRateEmpty"],
    ["leadHealth", "empty"],
    ["funnel", "emptyCovered"],
    ["funnel", "emptyUncovered"],
    ["funnel", "coverageNotice"],
    ["products", "noActivity"],
    ["financial", "noApprovals"],
    ["financial", "noData"],
    ["speed", "noSamples"],
    ["acquisition", "noCampaigns"],
    ["acquisition", "coverageNotice"],
    ["team", "noAssignments"],
    ["team", "noProfiles"],
    ["comparison", "none"],
  ];
  for (const file of ["../../../messages/es.json", "../../../messages/en.json"]) {
    const analytics = JSON.parse(read(file)).dashboard.analytics;
    for (const [section, key] of required) {
      const value = analytics[section]?.[key];
      assert.equal(typeof value, "string", `${file}: falta dashboard.analytics.${section}.${key}`);
      assert.ok((value as string).length > 3, `${file}: ${section}.${key} no puede ser un guion`);
    }
  }
});

test("ES y EN tienen exactamente las mismas claves de analítica", () => {
  const keys = (o: unknown, prefix = ""): string[] =>
    o && typeof o === "object"
      ? Object.entries(o as Record<string, unknown>).flatMap(([k, v]) =>
          keys(v, prefix ? `${prefix}.${k}` : k)
        )
      : [prefix];
  const es = keys(JSON.parse(read("../../../messages/es.json")).dashboard.analytics).sort();
  const en = keys(JSON.parse(read("../../../messages/en.json")).dashboard.analytics).sort();
  assert.deepEqual(es, en);
  assert.ok(es.length > 60, "el bloque de analitica deberia ser sustancial");
});
