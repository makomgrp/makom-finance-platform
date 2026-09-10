import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectReminderCandidates,
  type FollowUpReminderCandidate,
} from "./follow-up-reminder-eligibility.ts";

/**
 * ============================================================================
 * MILESTONE 2.2 — REMINDER ELIGIBILITY, WITHOUT A DATABASE
 * ============================================================================
 *
 * `selectReminderCandidates` is the only place this milestone decides who
 * gets reminded. Everything here is a plain fixture and an injected `now` —
 * no Supabase client, matching how deriveUrgency and the period tests already
 * verify time-sensitive logic in this project.
 */

const NOW = new Date("2026-09-10T12:00:00Z");

function candidate(overrides: Partial<FollowUpReminderCandidate> = {}): FollowUpReminderCandidate {
  return {
    id: "f-1",
    applicationId: "a-1",
    nextAction: "Llamar de vuelta",
    nextActionAt: "2026-09-10T08:00:00Z",
    advisorProfileId: "advisor-1",
    applicationNumber: "ODL-10SEP26-0001-N",
    clientFullName: "Juan Pérez",
    applicationStatus: "in_review",
    ...overrides,
  };
}

test("un follow-up vencido (overdue) se reclama", () => {
  const result = selectReminderCandidates([candidate({ nextActionAt: "2026-09-10T08:00:00Z" })], NOW);
  assert.equal(result.toClaim.length, 1);
  assert.equal(result.skippedUnassigned, 0);
  assert.equal(result.skippedNotDueYet, 0);
});

test("un follow-up con la accion vencida justo ahora se reclama", () => {
  const result = selectReminderCandidates([candidate({ nextActionAt: NOW.toISOString() })], NOW);
  assert.equal(result.toClaim.length, 1);
});

test("un follow-up futuro (todavia no vence) NO se reclama", () => {
  const result = selectReminderCandidates(
    [candidate({ nextActionAt: "2026-09-11T08:00:00Z" })],
    NOW
  );
  assert.equal(result.toClaim.length, 0);
  assert.equal(result.skippedNotDueYet, 1);
});

test("sin asesor asignado: se cuenta y no se reclama", () => {
  const result = selectReminderCandidates([candidate({ advisorProfileId: null })], NOW);
  assert.equal(result.toClaim.length, 0);
  assert.equal(result.skippedUnassigned, 1);
});

test("cero candidatos: resultado seguro, todo en cero", () => {
  const result = selectReminderCandidates([], NOW);
  assert.deepEqual(result, {
    toClaim: [],
    skippedUnassigned: 0,
    skippedNotDueYet: 0,
    skippedTerminalApplication: 0,
  });
});

test("un follow-up ya completado no se reclama, aunque venga en la lista", () => {
  const result = selectReminderCandidates(
    [candidate({ id: "f-completed" })],
    NOW,
    new Set(["f-completed"])
  );
  assert.equal(result.toClaim.length, 0);
});

test("idempotencia: la segunda ejecucion no reclama lo que la primera ya reclamo", () => {
  const rows = [candidate({ id: "f-idempotent" })];

  const first = selectReminderCandidates(rows, NOW);
  assert.equal(first.toClaim.length, 1);

  // Simula que la escritura atomica de la primera ejecucion ya se comprometio
  // antes de que corra la segunda — exactamente lo que el UPDATE guardado por
  // internal_reminder_sent_at garantiza en la base de datos real.
  const second = selectReminderCandidates(rows, NOW, new Set(), new Set(["f-idempotent"]));
  assert.equal(second.toClaim.length, 0);
});

test("una mezcla de filas produce los conteos correctos para cada una", () => {
  const rows = [
    candidate({ id: "overdue-1", nextActionAt: "2026-09-09T00:00:00Z" }),
    candidate({ id: "future-1", nextActionAt: "2026-09-12T00:00:00Z" }),
    candidate({ id: "unassigned-1", advisorProfileId: null }),
    candidate({ id: "already-reminded-1" }),
  ];

  const result = selectReminderCandidates(rows, NOW, new Set(), new Set(["already-reminded-1"]));

  assert.deepEqual(
    result.toClaim.map((c) => c.id),
    ["overdue-1"]
  );
  assert.equal(result.skippedNotDueYet, 1);
  assert.equal(result.skippedUnassigned, 1);
});

// ---------------------------------------------------------------------------
// MILESTONE 2.4 — LIMPIEZA DE RECORDATORIOS SOBRE SOLICITUDES TERMINALES
// ---------------------------------------------------------------------------

test("solicitud activa (in_review) sigue siendo elegible, sin cambios", () => {
  const result = selectReminderCandidates([candidate({ applicationStatus: "in_review" })], NOW);
  assert.equal(result.toClaim.length, 1);
  assert.equal(result.skippedTerminalApplication, 0);
});

test("solicitud approved: se ignora, no se genera un nuevo recordatorio", () => {
  const result = selectReminderCandidates([candidate({ applicationStatus: "approved" })], NOW);
  assert.equal(result.toClaim.length, 0);
  assert.equal(result.skippedTerminalApplication, 1);
});

test("solicitud not_eligible: se ignora", () => {
  const result = selectReminderCandidates([candidate({ applicationStatus: "not_eligible" })], NOW);
  assert.equal(result.toClaim.length, 0);
  assert.equal(result.skippedTerminalApplication, 1);
});

test("solicitud cancelled: se ignora", () => {
  const result = selectReminderCandidates([candidate({ applicationStatus: "cancelled" })], NOW);
  assert.equal(result.toClaim.length, 0);
  assert.equal(result.skippedTerminalApplication, 1);
});

test("solicitud terminal tiene prioridad sobre 'no asignado': se cuenta como terminal, no como sin asesor", () => {
  const result = selectReminderCandidates(
    [candidate({ applicationStatus: "cancelled", advisorProfileId: null })],
    NOW
  );
  assert.equal(result.skippedTerminalApplication, 1);
  assert.equal(result.skippedUnassigned, 0);
});
