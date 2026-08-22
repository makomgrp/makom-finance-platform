import type { ApplicationStatus, PipelineStage } from "@/types";

/**
 * The board's columns, in the one order they are ever displayed.
 *
 * Fixed, not derived: the sequence is the business's approved pipeline, and a
 * board whose columns move around is unusable for people who navigate it by
 * position every day.
 */
export const PIPELINE_STAGE_ORDER: readonly PipelineStage[] = [
  "nuevo",
  "paso_2",
  "paso_3",
  "en_evaluacion",
  "aprobado",
  "cancelado",
  "descartado",
] as const;

/**
 * The stages a customer reaches by USING THE PORTAL.
 *
 * Staff cannot move a card into these. Claiming a customer completed Step 2
 * when they did not would be a false record of someone else's actions — and
 * since the stage is recomputed from that customer's own data on every read,
 * the claim would silently disappear on the next refresh. Better to offer no
 * control than one that appears to work.
 */
export const PORTAL_DRIVEN_STAGES: readonly PipelineStage[] = ["nuevo", "paso_2", "paso_3"] as const;

export function isPortalDrivenStage(stage: PipelineStage): boolean {
  return PORTAL_DRIVEN_STAGES.includes(stage);
}

/**
 * Where a formally received application sits on the board.
 *
 * ⚠️ `descartado` maps to the EXISTING `not_eligible` status. ODL's approved
 * pipeline vocabulary names this column "Descartado"; the database has always
 * called the state `not_eligible`. Mapping rather than adding a status avoids a
 * second, nearly identical terminal state — but "discarded" and "not eligible"
 * do not mean quite the same thing, and that difference is reported rather than
 * quietly absorbed.
 */
export function stageForFormalStatus(status: ApplicationStatus): PipelineStage {
  switch (status) {
    case "in_review":
      return "en_evaluacion";
    case "approved":
      return "aprobado";
    case "cancelled":
      return "cancelado";
    case "not_eligible":
      return "descartado";
    default:
      // `new` — formally received, not yet moved by anyone. It belongs with the
      // received applications, not back among the leads.
      return "en_evaluacion";
  }
}

/**
 * ============================================================================
 * MILESTONE 26B-7 — WHAT COUNTS AS WORK IN PROGRESS
 * ============================================================================
 *
 * The Dashboard aggregates the same cards the board renders, so the question
 * "is this still work?" has to be answered once, here, rather than as a filter
 * expression repeated in every metric.
 *
 * TERMINAL means ODL has finished with the process. An approved loan and a
 * discarded one are equally done, and counting either as workload would tell a
 * manager their team is busier than it is — the number would only ever grow.
 */
export const TERMINAL_PIPELINE_STAGES: readonly PipelineStage[] = [
  "aprobado",
  "cancelado",
  "descartado",
] as const;

/**
 * Pre-submission work. Identical to PORTAL_DRIVEN_STAGES by construction —
 * named separately because the two are the same set for a REASON that could
 * change: those are the stages staff cannot move a card into, these are the
 * stages where ODL is chasing a customer who has not applied yet. Aliasing
 * them would hide the day one stops implying the other.
 */
export const LEAD_PIPELINE_STAGES: readonly PipelineStage[] = ["nuevo", "paso_2", "paso_3"] as const;

/** Everything still open: leads being chased plus applications under evaluation. */
export const ACTIVE_PIPELINE_STAGES: readonly PipelineStage[] = [
  ...LEAD_PIPELINE_STAGES,
  "en_evaluacion",
] as const;

export function isTerminalStage(stage: PipelineStage): boolean {
  return TERMINAL_PIPELINE_STAGES.includes(stage);
}

export function isLeadStage(stage: PipelineStage): boolean {
  return LEAD_PIPELINE_STAGES.includes(stage);
}

export function isActiveStage(stage: PipelineStage): boolean {
  return ACTIVE_PIPELINE_STAGES.includes(stage);
}
