import type { ApplicationStatus } from "@/types";

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
  new: ["in_review", "cancelled"],
  in_review: ["approved", "not_eligible", "cancelled"],
  approved: [],
  not_eligible: [],
  cancelled: [],
};
