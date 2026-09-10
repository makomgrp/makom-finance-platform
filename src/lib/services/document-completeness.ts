/**
 * ============================================================================
 * MILESTONE 2.4 — IS THE APPLICANT'S REQUIRED DOCUMENT PACKAGE COMPLETE?
 * ============================================================================
 *
 * Zero imports, deliberately — this is the only dependency
 * `document-completeness.test.ts` needs, and it is exercised with
 * `node --test`, which resolves real files and knows nothing of the `@/`
 * bundler alias. Same split `document-request-eligibility.ts` and
 * `follow-up-reminder-eligibility.ts` already use for the same reason.
 *
 * ----------------------------------------------------------------------------
 * THE SAME DEFINITION 2.3 ALREADY USES — NOT A SECOND ONE
 * ----------------------------------------------------------------------------
 * "Relevant" is exactly milestone 2.3's eligibility filter: required,
 * applicant-visible, the applicant's own slot (not a guarantor's or
 * collateral's), client-facing. A slot outside that filter — optional,
 * internal-only, hidden from the applicant, or about a guarantor/collateral —
 * does not count toward "the applicant's package" at all, in either
 * direction: it cannot block completeness and it cannot complete it either.
 *
 * "Complete" means every relevant slot has reached one of the two states
 * `requirement-slot.ts` already treats as terminal: `satisfied` or `waived`.
 * `pending`/`missing`/`submitted`/`under_review`/`rejected` are all "not yet".
 *
 * ----------------------------------------------------------------------------
 * AN EMPTY SET IS NOT VACUOUSLY COMPLETE
 * ----------------------------------------------------------------------------
 * An application with zero relevant slots is NOT "documents complete" — it is
 * unevaluated. Nothing in this schema's existing semantics says an absence of
 * requirements means the applicant's package is done, and treating an empty
 * set as trivially true would risk a "ready for review" notification firing
 * for a case with genuinely nothing to review yet. Fail-safe: false.
 *
 * ----------------------------------------------------------------------------
 * WHY THIS IS SAFE TO CHECK ONLY WHEN A SLOT REACHES satisfied/waived
 * ----------------------------------------------------------------------------
 * Both are terminal in `REQUIREMENT_SLOT_STATUS_TRANSITIONS` (empty outgoing
 * edges) — a slot that reaches either can never leave it through this
 * codebase's own transition graph. Combined with every other add-path for a
 * relevant slot happening before an application is submitted (conditional
 * materialisation at Step 2) or never being relevant at all (manual slots are
 * seeded `required: false`), completeness for the relevant subset is
 * monotonic: once true, nothing in this system can make it false again. The
 * caller only needs to run this check at the moment a slot transitions INTO
 * satisfied or waived — that is the only moment completeness can newly
 * become true.
 */

export type CompletenessActor = "client" | "guarantor" | "internal" | "generated" | "external_third_party";
export type CompletenessSubjectType = "application" | "guarantor" | "collateral";
export type CompletenessStatus =
  | "pending"
  | "submitted"
  | "under_review"
  | "satisfied"
  | "rejected"
  | "waived"
  | "missing";

/** One requirement slot, as much of it as this check needs. */
export interface CompletenessSlot {
  required: boolean;
  applicantVisible: boolean;
  actor: CompletenessActor;
  subjectType: CompletenessSubjectType;
  status: CompletenessStatus;
}

const TERMINAL_STATUSES: ReadonlySet<CompletenessStatus> = new Set(["satisfied", "waived"]);

function isRelevant(slot: CompletenessSlot): boolean {
  return (
    slot.required &&
    slot.applicantVisible &&
    slot.actor === "client" &&
    slot.subjectType === "application"
  );
}

/**
 * True only if there is at least one relevant slot AND every relevant slot
 * has reached a terminal (satisfied/waived) status. Never touches the
 * database — the caller reads every slot for one application and passes them
 * all here; irrelevant slots may be included, they are filtered internally.
 */
export function isDocumentPackageComplete(slots: CompletenessSlot[]): boolean {
  const relevant = slots.filter(isRelevant);
  if (relevant.length === 0) return false;
  return relevant.every((slot) => TERMINAL_STATUSES.has(slot.status));
}
