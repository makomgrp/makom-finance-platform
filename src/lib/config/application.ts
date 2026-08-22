import type { ApplicationStatus } from "@/types";

// MILESTONE 26B-5 — `draft` is deliberately ABSENT from this list.
//
// This order drives operational surfaces (the Solicitudes board, status
// filters, the kanban columns). A draft is a portal journey ODL has not
// received, so it has no column and no filter chip: leaving it out here is what
// keeps it out of every one of those surfaces by construction, rather than by
// each of them remembering to exclude it.
export const APPLICATION_STATUS_ORDER: ApplicationStatus[] = [
  "new",
  "in_review",
  "approved",
  "not_eligible",
  "cancelled",
];

// Legal transitions only. approved / not_eligible / cancelled are treated
// as terminal (no outgoing transitions) — deliberately conservative for
// this first implementation, same posture already used for requirement_
// slots' satisfied/waived. If a real business need for reopening a
// terminal application ever emerges, that is a deliberate future change
// to make on its own merits, not a default capability. "new" never
// appears as a target anywhere: it is only ever the initial
// (column-default) state an application is created in — see the
// applications table migration's comment on applications_status_new_
// pair_check for why that invariant depends on this. See the Milestone
// 11 architecture review's "Lifecycle" section for what each state means.
export const APPLICATION_STATUS_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  // MILESTONE 26B-5 — a draft leaves this state through ONE door only:
  // submit_application(), which allocates the official number and moves it to
  // in_review in the same statement. No staff transition may promote a draft,
  // because promoting it without allocating a number would break
  // applications_draft_number_pair_check — so the empty list here is the code
  // agreeing with the constraint rather than a second opinion about it.
  draft: [],
  new: ["in_review", "cancelled"],
  in_review: ["approved", "not_eligible", "cancelled"],
  approved: [],
  not_eligible: [],
  cancelled: [],
};

// Every status a staff member may deliberately choose as a target,
// excluding "new" — which, per the invariant above, is only ever the
// initial state an application is created in and never a legal target
// from any state. Mirrors REQUIREMENT_SLOT_STATUS_TRANSITIONABLE's exact
// role in src/lib/config/requirement-slot.ts (a fixed allow-list for a
// "change status" menu) — added now, in Milestone 13B, ahead of the UI
// that will use it, since it belongs beside APPLICATION_STATUS_TRANSITIONS
// and has no reason to wait for that UI to exist.
export const APPLICATION_STATUS_TRANSITIONABLE: ApplicationStatus[] = APPLICATION_STATUS_ORDER.filter(
  (status) => status !== "new"
);

// Same semantic-color convention used throughout this schema (see
// REQUIREMENT_SLOT_STATUS_BADGE_CLASS, LOAN_STATUS_BADGE_CLASS): secondary
// for the initial state, navy for "actively being worked on," success for
// the positive terminal outcome. not_eligible is a negative DETERMINATION
// about the applicant (closer to requirement_slots' "rejected" than to a
// neutral exemption), so it takes destructive rather than muted; cancelled
// is an administrative/neutral closure with no judgment implied, so it
// takes the same muted treatment "waived" gets for requirement slots.
export const APPLICATION_STATUS_BADGE_CLASS: Record<ApplicationStatus, string> = {
  // Muted: a draft is not an operational state anyone acts on, and giving it a
  // colour that competes with `new` would invite exactly the confusion between
  // "in progress with the customer" and "received by ODL" that 26B-5 removed.
  draft: "bg-muted text-muted-foreground border-border",
  new: "bg-secondary text-secondary-foreground border-border",
  in_review: "bg-navy/10 text-navy border-navy/20",
  approved: "bg-success/10 text-success border-success/20",
  not_eligible: "bg-destructive/10 text-destructive border-destructive/20",
  cancelled: "bg-muted text-muted-foreground border-border",
};

/**
 * MILESTONE 26B-1B — THE ONE PLACE THE REPAYMENT-TERM BOUNDS ARE NAMED.
 *
 * These mirror `applications_requested_term_months_check`, which since 26B-1A
 * reads `requested_term_months IS NULL OR (> 0 AND <= 360)`. The DATABASE stays
 * authoritative; these exist so form validation rejects a bad value with a
 * readable message instead of surfacing a raw constraint violation.
 *
 * NAMED HERE rather than re-typed in each validator because the portal's
 * optional "desired term" field needed the same range that already existed, and
 * two independently-written ranges are exactly how a form starts accepting
 * values the database will later refuse.
 *
 * NOTE: `src/app/(app)/solicitudes/actions.ts` still carries its own local
 * MAX_TERM_MONTHS literal of the same value. It is deliberately left alone —
 * that is internal CRM code and outside this milestone's scope. Folding it in
 * is a worthwhile tidy-up for whichever milestone next has reason to touch it.
 */
export const APPLICATION_TERM_MONTHS_MIN = 1;
export const APPLICATION_TERM_MONTHS_MAX = 360;
