import { test } from "node:test";
import assert from "node:assert/strict";
import {
  selectDocumentRequestCandidates,
  type DocumentRequestCandidate,
} from "./document-request-eligibility.ts";

/**
 * ============================================================================
 * MILESTONE 2.3 — DOCUMENT REQUEST ELIGIBILITY, WITHOUT A DATABASE
 * ============================================================================
 *
 * `selectDocumentRequestCandidates` is the only place this milestone decides
 * which requirement slots get an internal document request. Everything here
 * is a plain fixture — no Supabase client — matching
 * `follow-up-reminder-eligibility.test.ts`'s own approach.
 */

function candidate(overrides: Partial<DocumentRequestCandidate> = {}): DocumentRequestCandidate {
  return {
    id: "slot-1",
    applicationId: "app-1",
    required: true,
    applicantVisible: true,
    actor: "client",
    subjectType: "application",
    status: "pending",
    advisorProfileId: "advisor-1",
    applicationNumber: "ODL-10SEP26-0001-N",
    clientFullName: "Juan Pérez",
    slotNameEs: "Cédula de identidad",
    slotNameEn: "National ID",
    ...overrides,
  };
}

test("required + visible + client + application + pending -> elegible", () => {
  const result = selectDocumentRequestCandidates([candidate({ status: "pending" })]);
  assert.equal(result.toClaim.length, 1);
  assert.equal(result.skippedNotEligible, 0);
  assert.equal(result.skippedUnassigned, 0);
});

test("missing -> elegible", () => {
  const result = selectDocumentRequestCandidates([candidate({ status: "missing" })]);
  assert.equal(result.toClaim.length, 1);
});

test("satisfied -> ignorado", () => {
  const result = selectDocumentRequestCandidates([candidate({ status: "satisfied" })]);
  assert.equal(result.toClaim.length, 0);
  assert.equal(result.skippedNotEligible, 1);
});

test("waived -> ignorado", () => {
  const result = selectDocumentRequestCandidates([candidate({ status: "waived" })]);
  assert.equal(result.toClaim.length, 0);
  assert.equal(result.skippedNotEligible, 1);
});

test("rejected -> ignorado (re-solicitud es un caso futuro, no asumido aqui)", () => {
  const result = selectDocumentRequestCandidates([candidate({ status: "rejected" })]);
  assert.equal(result.toClaim.length, 0);
  assert.equal(result.skippedNotEligible, 1);
});

test("submitted -> ignorado (ya hay algo del cliente esperando revision)", () => {
  const result = selectDocumentRequestCandidates([candidate({ status: "submitted" })]);
  assert.equal(result.toClaim.length, 0);
});

test("under_review -> ignorado", () => {
  const result = selectDocumentRequestCandidates([candidate({ status: "under_review" })]);
  assert.equal(result.toClaim.length, 0);
});

test("opcional (required=false) -> ignorado", () => {
  const result = selectDocumentRequestCandidates([candidate({ required: false })]);
  assert.equal(result.toClaim.length, 0);
  assert.equal(result.skippedNotEligible, 1);
});

test("applicant_visible=false -> ignorado", () => {
  const result = selectDocumentRequestCandidates([candidate({ applicantVisible: false })]);
  assert.equal(result.toClaim.length, 0);
  assert.equal(result.skippedNotEligible, 1);
});

test("actor distinto de client -> ignorado", () => {
  for (const actor of ["guarantor", "internal", "generated", "external_third_party"] as const) {
    const result = selectDocumentRequestCandidates([candidate({ actor })]);
    assert.equal(result.toClaim.length, 0, `actor=${actor} no deberia ser elegible`);
  }
});

test("subject_type distinto de application -> ignorado", () => {
  for (const subjectType of ["guarantor", "collateral"] as const) {
    const result = selectDocumentRequestCandidates([candidate({ subjectType })]);
    assert.equal(result.toClaim.length, 0, `subjectType=${subjectType} no deberia ser elegible`);
  }
});

test("ya generado (idempotencia): no se reclama de nuevo", () => {
  const rows = [candidate({ id: "slot-already-generated" })];

  const first = selectDocumentRequestCandidates(rows);
  assert.equal(first.toClaim.length, 1);

  // Simula que la escritura atomica de la primera ejecucion ya se comprometio
  // antes de que corra la segunda.
  const second = selectDocumentRequestCandidates(rows, new Set(["slot-already-generated"]));
  assert.equal(second.toClaim.length, 0);
});

test("sin asesor asignado: se cuenta y no se reclama", () => {
  const result = selectDocumentRequestCandidates([candidate({ advisorProfileId: null })]);
  assert.equal(result.toClaim.length, 0);
  assert.equal(result.skippedUnassigned, 1);
});

test("cero candidatos: resultado seguro, todo en cero", () => {
  const result = selectDocumentRequestCandidates([]);
  assert.deepEqual(result, { toClaim: [], skippedUnassigned: 0, skippedNotEligible: 0 });
});

test("una mezcla de filas produce los conteos correctos para cada una", () => {
  const rows = [
    candidate({ id: "eligible-1", status: "missing" }),
    candidate({ id: "optional-1", required: false }),
    candidate({ id: "guarantor-1", actor: "guarantor" }),
    candidate({ id: "unassigned-1", advisorProfileId: null }),
    candidate({ id: "already-generated-1" }),
  ];

  const result = selectDocumentRequestCandidates(rows, new Set(["already-generated-1"]));

  assert.deepEqual(
    result.toClaim.map((c) => c.id),
    ["eligible-1"]
  );
  assert.equal(result.skippedNotEligible, 2);
  assert.equal(result.skippedUnassigned, 1);
});
