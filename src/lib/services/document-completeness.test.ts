import { test } from "node:test";
import assert from "node:assert/strict";
import { isDocumentPackageComplete, type CompletenessSlot } from "./document-completeness.ts";

/**
 * ============================================================================
 * MILESTONE 2.4 — DOCUMENT PACKAGE COMPLETENESS, WITHOUT A DATABASE
 * ============================================================================
 *
 * `isDocumentPackageComplete` is the only place this milestone decides
 * whether an application's applicant-facing document package is done.
 * Everything here is a plain fixture — no Supabase client — matching
 * `document-request-eligibility.test.ts`'s own approach.
 */

function slot(overrides: Partial<CompletenessSlot> = {}): CompletenessSlot {
  return {
    required: true,
    applicantVisible: true,
    actor: "client",
    subjectType: "application",
    status: "satisfied",
    ...overrides,
  };
}

test("todos los slots relevantes satisfied -> completo", () => {
  assert.equal(isDocumentPackageComplete([slot({ status: "satisfied" }), slot({ status: "satisfied" })]), true);
});

test("un slot relevante incompleto entre varios -> no completo", () => {
  assert.equal(
    isDocumentPackageComplete([slot({ status: "satisfied" }), slot({ status: "pending" })]),
    false
  );
});

test("waived cuenta como completo", () => {
  assert.equal(isDocumentPackageComplete([slot({ status: "waived" })]), true);
});

test("rejected no es completo", () => {
  assert.equal(isDocumentPackageComplete([slot({ status: "rejected" })]), false);
});

test("missing no es completo", () => {
  assert.equal(isDocumentPackageComplete([slot({ status: "missing" })]), false);
});

test("pending no es completo", () => {
  assert.equal(isDocumentPackageComplete([slot({ status: "pending" })]), false);
});

test("submitted/under_review no son completos", () => {
  assert.equal(isDocumentPackageComplete([slot({ status: "submitted" })]), false);
  assert.equal(isDocumentPackageComplete([slot({ status: "under_review" })]), false);
});

test("un slot opcional incompleto no bloquea si los relevantes ya estan completos", () => {
  assert.equal(
    isDocumentPackageComplete([
      slot({ status: "satisfied" }),
      slot({ required: false, status: "pending" }),
    ]),
    true
  );
});

test("un slot no visible al aplicante no bloquea ni completa", () => {
  assert.equal(
    isDocumentPackageComplete([
      slot({ status: "satisfied" }),
      slot({ applicantVisible: false, status: "pending" }),
    ]),
    true
  );
});

test("slots de garante/colateral no cuentan para el paquete del solicitante", () => {
  assert.equal(
    isDocumentPackageComplete([
      slot({ status: "satisfied" }),
      slot({ subjectType: "guarantor", status: "pending" }),
      slot({ subjectType: "collateral", status: "pending" }),
    ]),
    true
  );
});

test("actor distinto de client no cuenta", () => {
  for (const actor of ["guarantor", "internal", "generated", "external_third_party"] as const) {
    assert.equal(
      isDocumentPackageComplete([slot({ status: "satisfied" }), slot({ actor, status: "pending" })]),
      true,
      `actor=${actor} no deberia bloquear`
    );
  }
});

test("conjunto vacio de slots relevantes NO es completo (fail-safe, no vacuamente verdadero)", () => {
  assert.equal(isDocumentPackageComplete([]), false);
  // Solo slots irrelevantes tampoco cuenta como completo.
  assert.equal(
    isDocumentPackageComplete([slot({ required: false, status: "satisfied" })]),
    false
  );
});
