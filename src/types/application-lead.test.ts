import { test } from "node:test";
import assert from "node:assert/strict";
import { isManualDraft } from "./application.ts";
import type { Application, ApplicationSource, ApplicationStatus } from "./application.ts";

/**
 * ============================================================================
 * MILESTONE 26B-26B — LO QUE HACE CORRECTO EL ARREGLO DE `activeLeads`
 * ============================================================================
 *
 * El Dashboard contaba como lead del portal cualquier borrador en `nuevo`,
 * `paso_2` o `paso_3`, porque filtraba por ETAPA. La corrección exige además
 * `card.kind === "lead"`, y ese `kind` lo calcula el pipeline como
 * `isDraft && !isManualDraft(...)`.
 *
 * Ese predicado es el que decide si el trabajo propio de ODL acaba dentro de
 * una cifra de captación pública, así que es el que se prueba aquí. La suma en
 * sí no se puede probar sin base de datos —`getDashboardOperations` necesita
 * tarjetas reales—, pero la regla que la hace verdadera sí, y es donde estaba
 * el error.
 */

type LeadInput = Pick<Application, "status" | "createdSource">;

/** La regla exacta de pipeline.ts, escrita aquí para poder ejercitarla. */
function pipelineKind(app: LeadInput): "lead" | "application" {
  const isDraft = app.status === "draft";
  return isDraft && !isManualDraft(app) ? "lead" : "application";
}

const SOURCES: ApplicationSource[] = ["crm_manual", "website_form", "whatsapp", "email", "ai"];
const STATUSES: ApplicationStatus[] = [
  "draft",
  "new",
  "in_review",
  "approved",
  "not_eligible",
  "cancelled",
];

test("un borrador manual NUNCA es un lead, esté en la etapa que esté", () => {
  const manualDraft: LeadInput = { status: "draft", createdSource: "crm_manual" };
  assert.equal(isManualDraft(manualDraft), true);
  assert.equal(pipelineKind(manualDraft), "application");
});

test("un borrador del portal SÍ es un lead", () => {
  const portalDraft: LeadInput = { status: "draft", createdSource: "website_form" };
  assert.equal(isManualDraft(portalDraft), false);
  assert.equal(pipelineKind(portalDraft), "lead");
});

test("nada que no sea borrador es un lead, venga de donde venga", () => {
  for (const status of STATUSES.filter((s) => s !== "draft")) {
    for (const createdSource of SOURCES) {
      assert.equal(
        pipelineKind({ status, createdSource }),
        "application",
        `${status}/${createdSource} no debería ser lead`
      );
    }
  }
});

test("`crm_manual` es el único origen que saca a un borrador del embudo", () => {
  for (const createdSource of SOURCES) {
    const expected = createdSource === "crm_manual" ? "application" : "lead";
    assert.equal(pipelineKind({ status: "draft", createdSource }), expected);
  }
});

test("la etapa por sí sola no basta: el defecto que se corrige", () => {
  // Las dos tarjetas caen en la misma etapa del tablero — la etapa se deriva de
  // lo completo que esté el expediente, no de quién lo abrió. Antes de 26B-26B
  // el Dashboard las contaba a las dos como captación pública.
  const enElMismoSitio: LeadInput[] = [
    { status: "draft", createdSource: "website_form" },
    { status: "draft", createdSource: "crm_manual" },
  ];
  const leads = enElMismoSitio.filter((a) => pipelineKind(a) === "lead");
  assert.equal(leads.length, 1);
  assert.equal(leads[0].createdSource, "website_form");
});
