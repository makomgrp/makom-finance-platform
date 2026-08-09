import type { RequirementSlotStatus } from "@/types";

export const REQUIREMENT_SLOT_STATUS_ORDER: RequirementSlotStatus[] = [
  "pending",
  "missing",
  "submitted",
  "under_review",
  "satisfied",
  "rejected",
  "waived",
];

// Legal transitions only. Deliberately conservative for this first
// implementation — satisfied and waived are treated as terminal (no
// outgoing transitions). If a real business need for reopening a
// satisfied or waived slot ever emerges, that is a deliberate future
// change to make on its own merits, not a default capability. "pending"
// never appears as a target anywhere: it is only ever the initial
// (column-default) state a slot is created in, never something a slot
// transitions back to — see the requirement_slots table migration's
// comment on requirement_slots_status_pending_pair_check for why that
// invariant depends on this. See the Milestone 10B architecture review's
// "Execution Lifecycle" section for what each state means.
export const REQUIREMENT_SLOT_STATUS_TRANSITIONS: Record<RequirementSlotStatus, RequirementSlotStatus[]> = {
  pending: ["submitted", "missing", "waived"],
  missing: ["submitted", "waived"],
  submitted: ["under_review", "waived"],
  under_review: ["satisfied", "rejected", "waived"],
  rejected: ["submitted", "waived"],
  satisfied: [],
  waived: [],
};
