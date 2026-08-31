import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PORTAL_ABANDONED_AFTER_MS,
  PORTAL_RESUME_GAP_MS,
  PORTAL_RESUME_GAP_SECONDS,
  PORTAL_STALLED_AFTER_MS,
  classifyPortalFunnelState,
  type PortalFunnelInput,
} from "./portal-funnel.ts";

/**
 * ============================================================================
 * MILESTONE 26B-26B — LAS PRUEBAS QUE IMPORTAN SON LAS DE LA FRONTERA
 * ============================================================================
 *
 * Un clasificador de umbrales no se equivoca en el centro de los rangos: se
 * equivoca en el segundo exacto del corte, donde un `>` en vez de un `>=`
 * cambia la respuesta y nadie lo nota hasta que un informe cuenta como perdida
 * a una persona que no lo está. Por eso casi todo lo de abajo es 72h menos un
 * segundo, 72h clavadas, 7 días menos un segundo y 7 días clavados.
 *
 * `node --test` con el borrado nativo de tipos de Node — sin dependencias
 * nuevas. El import lleva la extensión `.ts` porque el runtime resuelve
 * ficheros reales, no el alias `@/` del bundler.
 */

const NOW = new Date("2026-08-31T12:00:00.000Z");
const SECOND = 1000;

function at(msAgo: number): string {
  return new Date(NOW.getTime() - msAgo).toISOString();
}

function portal(msAgo: number, submittedAt?: string): PortalFunnelInput {
  return { createdSource: "website_form", submittedAt, lastActivityAt: at(msAgo) };
}

// ---------------------------------------------------------------------------
// Los umbrales son los que ODL decidió
// ---------------------------------------------------------------------------

test("los umbrales valen 72 horas y 7 días", () => {
  assert.equal(PORTAL_STALLED_AFTER_MS, 72 * 60 * 60 * 1000);
  assert.equal(PORTAL_ABANDONED_AFTER_MS, 7 * 24 * 60 * 60 * 1000);
});

test("el hueco de reanudación ES el umbral de estancamiento, no un número aparte", () => {
  assert.equal(PORTAL_RESUME_GAP_MS, PORTAL_STALLED_AFTER_MS);
  assert.equal(PORTAL_RESUME_GAP_SECONDS, 72 * 60 * 60);
});

// ---------------------------------------------------------------------------
// FRONTERAS
// ---------------------------------------------------------------------------

test("71h59m59s sigue siendo activa", () => {
  assert.equal(classifyPortalFunnelState(portal(PORTAL_STALLED_AFTER_MS - SECOND), NOW), "active");
});

test("72h exactas es estancada", () => {
  assert.equal(classifyPortalFunnelState(portal(PORTAL_STALLED_AFTER_MS), NOW), "stalled");
});

test("6d23h59m59s sigue siendo estancada", () => {
  assert.equal(
    classifyPortalFunnelState(portal(PORTAL_ABANDONED_AFTER_MS - SECOND), NOW),
    "stalled"
  );
});

test("7 días exactos es abandonada", () => {
  assert.equal(classifyPortalFunnelState(portal(PORTAL_ABANDONED_AFTER_MS), NOW), "abandoned");
});

test("actividad de hace un instante es activa", () => {
  assert.equal(classifyPortalFunnelState(portal(0), NOW), "active");
});

// ---------------------------------------------------------------------------
// CONVERTIDA GANA A LA EDAD
// ---------------------------------------------------------------------------

test("una solicitud enviada es convertida por vieja que sea", () => {
  const input = portal(PORTAL_ABANDONED_AFTER_MS * 50, "2026-01-01T00:00:00.000Z");
  assert.equal(classifyPortalFunnelState(input, NOW), "converted");
});

test("enviada hace un instante también es convertida", () => {
  assert.equal(classifyPortalFunnelState(portal(0, NOW.toISOString()), NOW), "converted");
});

// ---------------------------------------------------------------------------
// LO MANUAL NUNCA ES ABANDONO DEL PORTAL
// ---------------------------------------------------------------------------

test("crm_manual nunca se clasifica como abandono del embudo, por antiguo que sea", () => {
  for (const msAgo of [0, PORTAL_STALLED_AFTER_MS, PORTAL_ABANDONED_AFTER_MS * 10]) {
    const input: PortalFunnelInput = {
      createdSource: "crm_manual",
      lastActivityAt: at(msAgo),
    };
    assert.equal(classifyPortalFunnelState(input, NOW), "not_portal");
  }
});

test("ningún otro canal entra en el embudo público", () => {
  for (const source of ["whatsapp", "email", "ai"] as const) {
    const input: PortalFunnelInput = {
      createdSource: source,
      lastActivityAt: at(PORTAL_ABANDONED_AFTER_MS),
    };
    assert.equal(classifyPortalFunnelState(input, NOW), "not_portal");
  }
});

test("el origen se comprueba ANTES que el envío: un manual enviado tampoco es del embudo", () => {
  const input: PortalFunnelInput = {
    createdSource: "crm_manual",
    submittedAt: NOW.toISOString(),
    lastActivityAt: at(0),
  };
  assert.equal(classifyPortalFunnelState(input, NOW), "not_portal");
});

// ---------------------------------------------------------------------------
// FALLO SEGURO
// ---------------------------------------------------------------------------

test("una fecha ilegible no inventa un abandono", () => {
  const input: PortalFunnelInput = { createdSource: "website_form", lastActivityAt: "no-es-fecha" };
  assert.equal(classifyPortalFunnelState(input, NOW), "active");
});

test("una fecha futura no se clasifica como abandono", () => {
  const input: PortalFunnelInput = {
    createdSource: "website_form",
    lastActivityAt: new Date(NOW.getTime() + PORTAL_ABANDONED_AFTER_MS).toISOString(),
  };
  assert.equal(classifyPortalFunnelState(input, NOW), "active");
});

// ---------------------------------------------------------------------------
// UNA SOLICITUD ABANDONADA QUE VUELVE DEJA DE SERLO
// ---------------------------------------------------------------------------

test("reanudar devuelve la solicitud a activa en el estado actual", () => {
  const abandoned = portal(PORTAL_ABANDONED_AFTER_MS);
  assert.equal(classifyPortalFunnelState(abandoned, NOW), "abandoned");

  // La reanudación escribe `last_activity_at`, y eso es todo lo que hace falta:
  // el estado se deriva, no se almacena, así que no hay ninguna marca de
  // "abandonada" que alguien tenga que acordarse de borrar.
  const resumed = portal(0);
  assert.equal(classifyPortalFunnelState(resumed, NOW), "active");
});
