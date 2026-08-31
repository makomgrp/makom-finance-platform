import "server-only";

import {
  ACTIVE_PIPELINE_STAGES,
  isActiveStage,
  isLeadStage,
  PIPELINE_STAGE_ORDER,
} from "@/lib/config/pipeline";
import { getPipelineCards } from "./pipeline";
import { getProfiles } from "./profiles";
import type { BranchScope, PipelineCard, PipelineStage } from "@/types";

/**
 * ============================================================================
 * MILESTONE 26B-7 — THE MORNING SCREEN
 * ============================================================================
 *
 * Everything management needs to know before opening any other page: how much
 * work is in flight, where it is stuck, who is carrying it, and what is late.
 *
 * ----------------------------------------------------------------------------
 * IT COMPUTES NOTHING THE BOARD DOES NOT ALREADY COMPUTE
 * ----------------------------------------------------------------------------
 * Every figure here is an aggregation of `getPipelineCards()` — the same cards,
 * with the same derived stages, that /solicitudes renders. That is the whole
 * design. A dashboard is only useful if its numbers are the ones a manager will
 * see when they click through, and the fastest way to break that is to answer
 * the same question twice: a SQL `count(*)` grouped by some status column would
 * be cheaper and would start disagreeing with the board the first time a
 * requirement was waived or a pay slip replaced.
 *
 * `deriveDraftStage` is a product-specific rule (26A-4's isStep2Complete, plus
 * min_files-aware document completion). It cannot be expressed as a GROUP BY
 * without reimplementing it, and a second implementation is a second answer.
 *
 * ----------------------------------------------------------------------------
 * QUERY COST IS FIXED
 * ----------------------------------------------------------------------------
 * TWO reads, whatever the size of the business: the pipeline (itself a bounded
 * handful of set-based queries) and, only when a workload table is actually
 * going to be rendered, the staff roster. No metric issues its own query, and
 * nothing runs per advisor or per card — the advisor breakdown is a single pass
 * over an array that is already in memory.
 *
 * ----------------------------------------------------------------------------
 * TERMINAL WORK IS NOT WORKLOAD
 * ----------------------------------------------------------------------------
 * Approved, cancelled and discarded processes are excluded from every active
 * count. They are finished, and a workload figure that includes them only ever
 * grows — which would make the number useless within a month of go-live.
 *
 * ----------------------------------------------------------------------------
 * SCOPE
 * ----------------------------------------------------------------------------
 * The caller passes the already-resolved view scope and it goes straight to
 * getPipelineCards, which applies the same branch predicate every other
 * application read uses. An aggregate is not a loophole: a branch manager's
 * totals are their branch's totals, because the rows behind them were never
 * fetched.
 */

/** One advisor's open work, split by where each process currently sits. */
export interface AdvisorWorkloadRow {
  profileId: string;
  fullName: string;
  /** Open processes only — terminal stages are excluded. */
  activeTotal: number;
  byStage: Record<PipelineStage, number>;
}

export interface DashboardOperations {
  /** Every stage, including terminal ones, for the pipeline strip. */
  stageCounts: Record<PipelineStage, number>;

  /**
   * Trabajo previo al envío que llegó POR EL PORTAL: nuevo + paso_2 + paso_3, y
   * solo `kind === "lead"`. Nunca incluye applications, y desde 26B-26B tampoco
   * los borradores que ODL creó a mano —que también viven en esas etapas—.
   */
  activeLeads: number;
  /** Formally submitted and under evaluation. Never includes leads. */
  inEvaluation: number;
  /**
   * TODO lo que sigue abierto, en cualquier etapa activa.
   *
   * ⚠️ NO es `activeLeads + inEvaluation`. Desde 26B-26B hay un tercer grupo que
   * no tiene cifra propia: los borradores manuales, que están abiertos pero no
   * son leads del portal. Mientras ODL no cargue ninguno los tres números
   * cuadran; en cuanto lo haga, dejan de cuadrar, y esa diferencia es real y no
   * un error de suma.
   */
  activeProcesses: number;

  /** Open processes with no advisor. Terminal work cannot be "unassigned". */
  unassignedActive: number;

  /** Pending commitments due today, and ones already late. */
  followUpsToday: number;
  followUpsOverdue: number;
  /** Open processes nobody has promised a next step for. */
  withoutNextAction: number;

  /**
   * Applications where the customer has sent something no reviewer has
   * concluded on. Application-level, not slot-level: "3 applications waiting"
   * is a work queue, "17 slots" is noise.
   */
  applicationsWithDocumentsToReview: number;
}

export type GetDashboardOperationsResult =
  | { status: "ok"; operations: DashboardOperations; workload: AdvisorWorkloadRow[] }
  | { status: "error" };

function emptyStageCounts(): Record<PipelineStage, number> {
  return PIPELINE_STAGE_ORDER.reduce(
    (acc, stage) => ({ ...acc, [stage]: 0 }),
    {} as Record<PipelineStage, number>
  );
}

/**
 * @param scope         Already-resolved view scope. Never resolved in here.
 * @param workloadFor   Which advisors the caller is authorized to see a
 *                      workload row for. `"all"` is for supervisors holding
 *                      `application:assign_advisor`; a profile id restricts the
 *                      table to that person's own row; `"none"` skips the staff
 *                      read entirely, so an unauthorized caller costs one query
 *                      fewer rather than fetching rows the page will discard.
 */
export async function getDashboardOperations(
  scope: BranchScope,
  workloadFor: "all" | "none" | { selfProfileId: string }
): Promise<GetDashboardOperationsResult> {
  const pipelineResult = await getPipelineCards(scope);
  if (pipelineResult.status !== "ok") return { status: "error" };

  const cards = pipelineResult.cards;
  const stageCounts = emptyStageCounts();
  for (const card of cards) stageCounts[card.stage] += 1;

  const activeCards = cards.filter((card) => isActiveStage(card.stage));

  // ---------------------------------------------------------------------------
  // MILESTONE 26B-26B — UN BORRADOR NO ES UN LEAD DEL PORTAL
  //
  // Esta línea filtraba solo por ETAPA, y la etapa no dice de dónde salió el
  // expediente. Desde 23A un borrador puede ser igualmente algo que un empleado
  // empezó a mano en el CRM, y ese expediente aterriza en `nuevo`, `paso_2` o
  // `paso_3` como cualquier otro: la etapa se deriva de lo completo que esté,
  // no de quién lo abrió. El resultado era que el trabajo propio de ODL se
  // contaba como público — un lead de un formulario que nadie rellenó.
  //
  // Hoy no se nota porque no hay ninguna solicitud manual todavía. Se corrige
  // ahora justamente por eso: el primer expediente que cargue Randol habría
  // empezado a inflar la cifra en silencio, sin error y sin nada que mirar.
  //
  // `card.kind` ya responde a esto exactamente — la calcula el pipeline como
  // `isDraft && !isManualDraft(...)` —, así que esto es usar el discriminador
  // que ya existía en vez de añadir una segunda regla libre de discrepar. Es
  // también lo que el comentario de `activeLeads` en la interfaz de arriba ya
  // prometía ("Never includes applications") y la etapa por sí sola no cumplía.
  //
  // LA ETAPA SIGUE HACIENDO FALTA: `kind === "lead"` distingue el origen, e
  // `isLeadStage` distingue el momento. Un lead del portal que ya envió pasa a
  // `en_evaluacion` y deja de ser trabajo previo al envío.
  // ---------------------------------------------------------------------------
  const activeLeads = activeCards.filter(
    (card) => card.kind === "lead" && isLeadStage(card.stage)
  ).length;
  const inEvaluation = stageCounts.en_evaluacion;

  const unassignedActive = activeCards.filter((card) => !card.advisorProfileId).length;

  // URGENCY IS ALREADY DERIVED, and deliberately not re-derived here.
  // follow-ups.ts computes `nextActionUrgency` at read time against the
  // reader's clock, and only for commitments that are still outstanding —
  // a completed action has no `nextAction` on the summary at all, so
  // "completed" cannot leak into either figure below.
  //
  // TIMEZONE, STATED PLAINLY: "today" means the SERVER's calendar day
  // (deriveUrgency compares local Y/M/D). This project has no business-timezone
  // constant, and inventing one here would put the board and the dashboard on
  // different clocks — the one thing worse than an imprecise boundary. Panama
  // does not observe DST and sits at UTC-5, so a server running UTC rolls
  // "today" over five hours early. Documented rather than guessed; see the
  // milestone report.
  let followUpsToday = 0;
  let followUpsOverdue = 0;
  let withoutNextAction = 0;
  for (const card of activeCards) {
    const urgency = card.followUp?.nextActionUrgency;
    if (!card.followUp?.nextAction) {
      withoutNextAction += 1;
      continue;
    }
    if (urgency === "today") followUpsToday += 1;
    else if (urgency === "overdue") followUpsOverdue += 1;
  }

  // RECEIVED IS NOT REVIEWED. `documentsReceived` counts requirements with
  // enough live files; `documentsReviewed` counts the ones a reviewer has
  // concluded (satisfied/waived). The gap between them is the review queue —
  // NOT missing paperwork, which would be `total - received` and is a
  // different, customer-facing problem.
  const applicationsWithDocumentsToReview = activeCards.filter(
    (card) => card.kind === "application" && card.documentsReceived > card.documentsReviewed
  ).length;

  const operations: DashboardOperations = {
    stageCounts,
    activeLeads,
    inEvaluation,
    activeProcesses: activeCards.length,
    unassignedActive,
    followUpsToday,
    followUpsOverdue,
    withoutNextAction,
    applicationsWithDocumentsToReview,
  };

  const workload = await buildAdvisorWorkload(activeCards, workloadFor);
  return { status: "ok", operations, workload };
}

/**
 * ONE PASS OVER CARDS ALREADY IN MEMORY, plus at most one staff read.
 *
 * The roster is fetched so that an advisor carrying nothing still appears with
 * a zero — which is the row a manager most needs to see. Deriving the list from
 * the cards alone would silently omit exactly the people worth asking about.
 *
 * WHO IS LISTED mirrors assignment eligibility rather than inventing a second
 * rule: an active `asesor` with an auth link. A pending invitee cannot sign in
 * and the database refuses to assign work to them, so a permanent zero row for
 * one is noise about a person who is not yet part of the operation.
 */
async function buildAdvisorWorkload(
  activeCards: PipelineCard[],
  workloadFor: "all" | "none" | { selfProfileId: string }
): Promise<AdvisorWorkloadRow[]> {
  if (workloadFor === "none") return [];

  const profilesResult = await getProfiles();
  if (profilesResult.status !== "ok") return [];

  const eligible = profilesResult.users.filter(
    (user) => user.role === "asesor" && user.active && user.authLinked
  );
  const visible =
    workloadFor === "all"
      ? eligible
      : eligible.filter((user) => user.id === workloadFor.selfProfileId);

  const rows = new Map<string, AdvisorWorkloadRow>(
    visible.map((user) => [
      user.id,
      { profileId: user.id, fullName: user.fullName, activeTotal: 0, byStage: emptyStageCounts() },
    ])
  );

  for (const card of activeCards) {
    if (!card.advisorProfileId) continue;
    const row = rows.get(card.advisorProfileId);
    // An advisor who has since been deactivated, unlinked or re-roled keeps
    // their existing files — attribution is never rewritten by a change in
    // eligibility (see profiles.ts). They simply do not get a row here, which
    // is why the rows' totals can legitimately sum to less than
    // `activeProcesses - unassignedActive`.
    if (!row) continue;
    row.activeTotal += 1;
    row.byStage[card.stage] += 1;
  }

  return [...rows.values()].sort(
    (a, b) => b.activeTotal - a.activeTotal || a.fullName.localeCompare(b.fullName)
  );
}

/** The stages the workload breakdown renders, in board order. */
export const WORKLOAD_STAGES = ACTIVE_PIPELINE_STAGES;
