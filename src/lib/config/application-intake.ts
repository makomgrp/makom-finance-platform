import type { ApplicationIntakeStatus } from "@/types";

export const APPLICATION_INTAKE_STATUS_ORDER: ApplicationIntakeStatus[] = [
  "received",
  "client_matched",
  "needs_review",
  "processed",
];

// Legal transitions only — see the application_intakes table migration's
// header comment for the full lifecycle reasoning and why
// documents_pending/rejected are deliberately absent from this
// milestone's vocabulary. "received" never appears as a target anywhere:
// it is only ever the initial (column-default) state an intake is
// created in — see application_intakes_client_matched_pair_check for why
// that invariant matters. processed and needs_review are both terminal
// within this milestone's scope (no code path in Milestone 15B ever
// transitions out of either) — not because a future reprocessing action
// is impossible, but because building one is explicitly out of scope
// here (see the Milestone 15B brief's Actor Model section).
export const APPLICATION_INTAKE_STATUS_TRANSITIONS: Record<ApplicationIntakeStatus, ApplicationIntakeStatus[]> = {
  received: ["client_matched", "needs_review"],
  client_matched: ["processed", "needs_review"],
  // MILESTONE 26B-19 — needs_review stops being a terminal state.
  //
  // 15B left this empty deliberately, and said so: not because reprocessing was
  // impossible but because building it was out of scope. It has been out of
  // scope ever since, which meant an intake the engine parked was parked
  // forever — invisible to staff and unrecoverable by the applicant.
  //
  // The ONLY way out is back to `client_matched`, the same state the automatic
  // path uses once a client is known, so a resolved intake rejoins the existing
  // pipeline rather than following a second one. Nothing new leads to
  // `processed` or back to `received`.
  needs_review: ["client_matched"],
  processed: [],
};

// How long a processing claim (application_intakes.processing_claimed_at
// — see claimApplicationIntakeForProcessing in
// src/lib/services/application-intakes.ts) is honored before a later
// attempt is allowed to reclaim the same intake. Milestone 15B
// correction, section 8: a worker that claims an intake and then
// crashes before calling completeApplicationIntake would otherwise
// strand that intake at 'client_matched' forever, since nothing else
// ever clears the marker. This is a generous window relative to this
// pipeline's actual expected runtime (product lookup + one Application
// insert + one Requirement Slot snapshot — low seconds at most), chosen
// to make a false reclaim of a still-legitimately-running attempt
// vanishingly unlikely while still bounding the strand window to
// something a retry can recover from on its own, with no separate
// recovery job or workflow engine required. This is an operational
// timeout, not an ODL loan-policy rule.
export const APPLICATION_INTAKE_PROCESSING_CLAIM_STALE_AFTER_MS = 15 * 60 * 1000;
