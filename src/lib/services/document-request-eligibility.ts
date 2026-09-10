/**
 * ============================================================================
 * MILESTONE 2.3 — WHICH REQUIREMENT SLOTS GET AN INTERNAL DOCUMENT REQUEST
 * ============================================================================
 *
 * Zero imports, deliberately — this is the only dependency
 * `document-requests.test.ts` needs, and it is exercised with `node --test`,
 * which resolves real files and knows nothing of the `@/` bundler alias. Same
 * split `follow-up-reminder-eligibility.ts` already uses for the same reason.
 *
 * ----------------------------------------------------------------------------
 * ELIGIBILITY, IN FULL, LIVES HERE — NOT IN THE SQL QUERY
 * ----------------------------------------------------------------------------
 * `document-requests.ts` reads every requirement slot that has not yet had a
 * request generated (`document_request_generated_at is null`) and hands the
 * whole set to this function. Every other condition — required, visible to
 * the applicant, the applicant's own slot (not a guarantor's or collateral's),
 * pending or missing, not already claimed — is decided here, in one place
 * that a unit test can exercise without a database. This mirrors how
 * `follow-up-reminder-eligibility.ts` keeps the "is it actually due" decision
 * out of SQL.
 *
 * ----------------------------------------------------------------------------
 * WHY EXACTLY THIS SET OF CONDITIONS
 * ----------------------------------------------------------------------------
 * `required = true`         — an optional requirement is not something ODL is
 *                              owed; automating a request for it would invent
 *                              urgency nobody asked for.
 * `applicantVisible = true` — a requirement hidden from the applicant is
 *                              internal-facing by design; requesting it FROM
 *                              them would ask for something they were never
 *                              shown existed.
 * `actor === "client"`      — `guarantor`/`internal`/`generated`/
 *                              `external_third_party` are not the applicant;
 *                              a `client`-only rule is the conservative
 *                              reading approved for this milestone.
 * `subjectType === "application"` — a slot about a guarantor or a piece of
 *                              collateral is not "the applicant's document".
 *                              Guarantors in particular have not consented and
 *                              carry no verified contact channel — requesting
 *                              from them is explicitly out of scope here.
 * `status` in `pending`/`missing` — `submitted`/`under_review` already have
 *                              something from the customer awaiting staff, and
 *                              `satisfied`/`waived`/`rejected` are settled.
 *                              Re-requesting a `rejected` slot is a real,
 *                              named future case, not assumed here.
 */

export type EligibleActor = "client" | "guarantor" | "internal" | "generated" | "external_third_party";
export type EligibleSubjectType = "application" | "guarantor" | "collateral";
export type EligibleStatus =
  | "pending"
  | "submitted"
  | "under_review"
  | "satisfied"
  | "rejected"
  | "waived"
  | "missing";

/** The shape the caller has already resolved from Supabase — see
 * `document-requests.ts`'s `CANDIDATE_SELECT` for where each field comes
 * from. Deliberately flat, so a fixture is just an object literal. */
export interface DocumentRequestCandidate {
  id: string;
  applicationId: string;
  required: boolean;
  applicantVisible: boolean;
  actor: EligibleActor;
  subjectType: EligibleSubjectType;
  status: EligibleStatus;
  advisorProfileId: string | null;
  applicationNumber?: string;
  clientFullName: string;
  slotNameEs: string;
  slotNameEn: string;
}

export interface SelectDocumentRequestCandidatesResult {
  toClaim: DocumentRequestCandidate[];
  skippedUnassigned: number;
  skippedNotEligible: number;
}

const ELIGIBLE_STATUSES: ReadonlySet<EligibleStatus> = new Set(["pending", "missing"]);

/**
 * Pure decision function: which requirement slots get an internal document
 * request generated, and why the rest were left alone. Never touches the
 * database.
 *
 * `alreadyGeneratedByRowId` lets this function alone simulate what the DB's
 * own guard (`document_request_generated_at is null`) already enforces for
 * real — including "the second cron run does not reclaim what the first one
 * already claimed" — without needing two database round-trips to prove it.
 */
export function selectDocumentRequestCandidates(
  rows: DocumentRequestCandidate[],
  alreadyGeneratedByRowId: ReadonlySet<string> = new Set()
): SelectDocumentRequestCandidatesResult {
  let skippedUnassigned = 0;
  let skippedNotEligible = 0;
  const toClaim: DocumentRequestCandidate[] = [];

  for (const row of rows) {
    if (alreadyGeneratedByRowId.has(row.id)) continue;

    const isEligible =
      row.required &&
      row.applicantVisible &&
      row.actor === "client" &&
      row.subjectType === "application" &&
      ELIGIBLE_STATUSES.has(row.status);

    if (!isEligible) {
      skippedNotEligible += 1;
      continue;
    }

    if (!row.advisorProfileId) {
      skippedUnassigned += 1;
      continue;
    }

    toClaim.push(row);
  }

  return { toClaim, skippedUnassigned, skippedNotEligible };
}
