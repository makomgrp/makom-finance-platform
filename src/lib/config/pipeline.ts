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
