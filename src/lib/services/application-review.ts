import "server-only";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getApplicationById } from "@/lib/services/applications";
import {
  getRequirementSlotsByApplicationId,
  summariseDocumentProgress,
  type ApplicationDocumentSummary,
} from "@/lib/services/requirement-slots";
import { getEvidenceByApplicationId } from "@/lib/services/document-evidence";
import {
  REVIEW_ITEMS,
  type ReviewItemState,
  type ReviewObservationCategory,
  type ReviewRecommendation,
  type ReviewSection,
} from "@/lib/config/application-review";
import type { BranchScope } from "@/types";

/**
 * ============================================================================
 * MILESTONE 26B-10 — THE MANUAL REVIEW
 * ============================================================================
 *
 * Reads and writes one application's review. It computes no score, derives no
 * verdict, and changes no application status — every conclusion recorded here
 * was typed by a person, and the loan's own status is moved elsewhere, by
 * whoever holds `application:set_status`, through machinery that already
 * exists for it.
 *
 * ----------------------------------------------------------------------------
 * SCOPE IS RE-CHECKED ON THE APPLICATION, EVERY TIME
 * ----------------------------------------------------------------------------
 * Knowing a review id, or an application id, is never authorization. Every
 * entry point re-resolves the APPLICATION through `getApplicationById` — the
 * same branch-scoped read the dossier page itself uses — before touching
 * anything. A hand-crafted request naming another branch's file resolves to
 * nothing, exactly as that route already 404s.
 *
 * The review tables carry no branch column of their own, deliberately: an
 * application's branch is the application's fact, and copying it here would
 * create a second answer that could drift when a case is transferred.
 */

export type ReviewStatus = "not_started" | "in_progress" | "completed";

export interface ReviewItemView {
  code: string;
  section: ReviewSection;
  state: ReviewItemState;
  note?: string;
  updatedAt?: string;
  updatedByFullName?: string;
  requiredForCompletion: boolean;
}

export interface ReviewObservationView {
  id: string;
  category: ReviewObservationCategory;
  body: string;
  authorFullName: string;
  createdAt: string;
}

/**
 * Objective, unresolved conditions. NOT a risk assessment.
 *
 * Every number here counts things a person has not yet answered or resolved.
 * None of them is weighted, combined, scored or graded by severity — "3 pending
 * items" says three questions are unanswered, not that this applicant is three
 * units risky.
 */
export interface ReviewAttention {
  pendingRequiredItems: number;
  issueItems: number;
  documentsAwaitingReview: number;
  rejectedDocuments: number;
  recommendationPending: boolean;
}

export interface ApplicationReviewView {
  applicationId: string;
  reviewId?: string;
  status: ReviewStatus;
  reviewerFullName?: string;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
  completedByFullName?: string;
  recommendation: ReviewRecommendation;
  recommendationNote?: string;
  recommendationAt?: string;
  recommendationByFullName?: string;
  items: ReviewItemView[];
  observations: ReviewObservationView[];
  documents: ApplicationDocumentSummary;
  attention: ReviewAttention;
  /** Whether Complete would be accepted right now. The server re-decides. */
  canComplete: boolean;
}

export type GetApplicationReviewResult =
  | { status: "ok"; review: ApplicationReviewView }
  | { status: "not_found" }
  | { status: "error" };

interface ReviewRow {
  id: string;
  application_id: string;
  status: "in_progress" | "completed";
  started_at: string;
  updated_at: string;
  completed_at: string | null;
  recommendation: ReviewRecommendation;
  recommendation_note: string | null;
  recommendation_at: string | null;
  reviewer: { full_name: string } | null;
  completed_by: { full_name: string } | null;
  recommended_by: { full_name: string } | null;
}

const REVIEW_SELECT =
  "id, application_id, status, started_at, updated_at, completed_at, " +
  "recommendation, recommendation_note, recommendation_at, " +
  "reviewer:profiles!application_reviews_reviewer_profile_id_fkey(full_name), " +
  "completed_by:profiles!application_reviews_completed_by_profile_id_fkey(full_name), " +
  "recommended_by:profiles!application_reviews_recommendation_by_profile_id_fkey(full_name)";

/** The one authorization question every entry point asks first. */
async function isApplicationInScope(scope: BranchScope, applicationId: string): Promise<boolean> {
  const result = await getApplicationById(scope, applicationId);
  return result.status === "ok";
}

/**
 * This application's documents, read fresh.
 *
 * Slots and evidence come from their own services and the counting rule is
 * `summariseDocumentProgress`, shared with the pipeline — there is exactly one
 * answer in this system to "how many are received" and "how many are reviewed",
 * and the review workspace reports it rather than computing a second one.
 */
async function loadDocumentSummary(
  scope: BranchScope,
  applicationId: string
): Promise<ApplicationDocumentSummary> {
  const [slotsResult, evidenceResult] = await Promise.all([
    getRequirementSlotsByApplicationId(scope, applicationId),
    getEvidenceByApplicationId(scope, applicationId),
  ]);
  if (slotsResult.status !== "ok" || evidenceResult.status !== "ok") {
    return { received: 0, reviewed: 0, total: 0, rejected: 0 };
  }
  return summariseDocumentProgress(slotsResult.requirementSlots, evidenceResult.evidence);
}

function buildAttention(
  items: readonly ReviewItemView[],
  documents: ApplicationDocumentSummary,
  recommendation: ReviewRecommendation
): ReviewAttention {
  return {
    pendingRequiredItems: items.filter((item) => item.requiredForCompletion && item.state === "pending")
      .length,
    issueItems: items.filter((item) => item.state === "issue").length,
    // RECEIVED IS NOT REVIEWED (26B-5). Files that arrived and nobody has
    // concluded on yet — the reviewer's actual queue.
    documentsAwaitingReview: Math.max(0, documents.received - documents.reviewed),
    rejectedDocuments: documents.rejected,
    recommendationPending: recommendation === "pending",
  };
}

/**
 * The review as the tab renders it.
 *
 * NO ROW MEANS `not_started`, not an error. A review exists once somebody
 * begins one; until then the application simply has not been reviewed, and
 * creating an empty row on every page view would make "started" meaningless and
 * put a reviewer's name on work nobody has done.
 *
 * THE CHECKLIST IS PROJECTED FROM THE CATALOGUE, not from stored rows: every
 * item in the config appears, defaulting to `pending`, with whatever a reviewer
 * recorded merged over it. Adding an item to the catalogue therefore appears
 * immediately on reviews already in progress instead of being silently absent.
 */
export async function getApplicationReview(
  scope: BranchScope,
  applicationId: string
): Promise<GetApplicationReviewResult> {
  if (!(await isApplicationInScope(scope, applicationId))) return { status: "not_found" };

  try {
    const supabase = getSupabaseServerClient();

    const [{ data: reviewRow, error: reviewError }, documents] = await Promise.all([
      supabase
        .from("application_reviews")
        .select(REVIEW_SELECT)
        .eq("application_id", applicationId)
        .maybeSingle<ReviewRow>(),
      loadDocumentSummary(scope, applicationId),
    ]);

    if (reviewError) {
      console.error("[review service] Failed to load review:", reviewError.message);
      return { status: "error" };
    }

    if (!reviewRow) {
      const items: ReviewItemView[] = REVIEW_ITEMS.map((item) => ({
        code: item.code,
        section: item.section,
        state: "pending",
        requiredForCompletion: item.requiredForCompletion,
      }));
      return {
        status: "ok",
        review: {
          applicationId,
          status: "not_started",
          recommendation: "pending",
          items,
          observations: [],
          documents,
          attention: buildAttention(items, documents, "pending"),
          canComplete: false,
        },
      };
    }

    const [
      { data: itemRows, error: itemError },
      { data: observationRows, error: observationError },
    ] = await Promise.all([
      supabase
        .from("application_review_items")
        .select(
          "item_code, state, note, updated_at, " +
            "updated_by:profiles!application_review_items_updated_by_profile_id_fkey(full_name)"
        )
        .eq("review_id", reviewRow.id),
      supabase
        .from("application_review_observations")
        .select(
          "id, category, body, created_at, " +
            "author:profiles!application_review_observations_author_profile_id_fkey(full_name)"
        )
        .eq("review_id", reviewRow.id)
        .order("created_at", { ascending: false }),
    ]);

    if (itemError || observationError) {
      console.error(
        "[review service] Failed to load review detail:",
        itemError?.message ?? observationError?.message
      );
      return { status: "error" };
    }

    const stored = new Map(
      (
        (itemRows ?? []) as unknown as {
          item_code: string;
          state: ReviewItemState;
          note: string | null;
          updated_at: string;
          updated_by: { full_name: string } | null;
        }[]
      ).map((row) => [row.item_code, row])
    );

    const items: ReviewItemView[] = REVIEW_ITEMS.map((definition) => {
      const row = stored.get(definition.code);
      return {
        code: definition.code,
        section: definition.section,
        state: row?.state ?? "pending",
        note: row?.note ?? undefined,
        updatedAt: row?.updated_at,
        updatedByFullName: row?.updated_by?.full_name ?? undefined,
        requiredForCompletion: definition.requiredForCompletion,
      };
    });

    const attention = buildAttention(items, documents, reviewRow.recommendation);

    return {
      status: "ok",
      review: {
        applicationId,
        reviewId: reviewRow.id,
        status: reviewRow.status,
        reviewerFullName: reviewRow.reviewer?.full_name ?? undefined,
        startedAt: reviewRow.started_at,
        updatedAt: reviewRow.updated_at,
        completedAt: reviewRow.completed_at ?? undefined,
        completedByFullName: reviewRow.completed_by?.full_name ?? undefined,
        recommendation: reviewRow.recommendation,
        recommendationNote: reviewRow.recommendation_note ?? undefined,
        recommendationAt: reviewRow.recommendation_at ?? undefined,
        recommendationByFullName: reviewRow.recommended_by?.full_name ?? undefined,
        items,
        observations: (
          (observationRows ?? []) as unknown as {
            id: string;
            category: ReviewObservationCategory;
            body: string;
            created_at: string;
            author: { full_name: string } | null;
          }[]
        ).map((row) => ({
          id: row.id,
          category: row.category,
          body: row.body,
          authorFullName: row.author?.full_name ?? "—",
          createdAt: row.created_at,
        })),
        documents,
        attention,
        canComplete: reviewRow.status === "in_progress" && evaluateCompletion(attention).ok,
      },
    };
  } catch (error) {
    console.error(
      "[review service] Unexpected failure loading review:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

export type CompletionBlocker =
  | "required_items_pending"
  | "documents_rejected"
  | "recommendation_pending";

/**
 * ============================================================================
 * WHEN MAY A REVIEW BE CALLED FINISHED?
 * ============================================================================
 *
 * Three conditions, all objective, stated once here so the button and the
 * server cannot disagree:
 *
 *   1. NO REQUIRED CHECKLIST ITEM IS STILL `pending`. `not_applicable` counts
 *      as answered — "this product has no payroll deduction" is a real answer,
 *      and forcing a false tick to satisfy a rule would corrupt the record. An
 *      `issue` also counts as answered: a reviewer may legitimately finish a
 *      review whose conclusion is that something is wrong, which is precisely
 *      what `recommend_rejection` and `escalate` are for. THIS IS NOT A SCORE —
 *      it is a check that every required question has SOME answer.
 *
 *   2. NO DOCUMENT SITS REJECTED. A rejected requirement is an unresolved
 *      document problem in the existing review model; completing over it would
 *      let the review assert a cleared file that is not cleared. Resolving it
 *      means the customer re-uploads or a reviewer waives it — both already
 *      exist, and neither happens here.
 *
 *   3. A RECOMMENDATION HAS BEEN RECORDED. A finished review that recommends
 *      nothing tells the next person nothing.
 *
 * `issueItems` and `documentsAwaitingReview` are deliberately NOT blockers.
 * They are shown so a reviewer sees them; whether they matter is the reviewer's
 * judgement, and blocking on them would let an unread optional document freeze
 * a review that has legitimately concluded.
 *
 * NOTHING COMPLETES ITSELF. Satisfying these conditions does not complete the
 * review; it only makes the button legal. A person clicks it.
 */
export function evaluateCompletion(attention: ReviewAttention): {
  ok: boolean;
  blockers: CompletionBlocker[];
} {
  const blockers: CompletionBlocker[] = [];
  if (attention.pendingRequiredItems > 0) blockers.push("required_items_pending");
  if (attention.rejectedDocuments > 0) blockers.push("documents_rejected");
  if (attention.recommendationPending) blockers.push("recommendation_pending");
  return { ok: blockers.length === 0, blockers };
}

export type ReviewMutationResult =
  | { status: "ok"; reviewId: string }
  | { status: "error"; code: "NOT_ACCESSIBLE" | "NOT_FOUND" | "INVALID" | "UPDATE_FAILED" };

/**
 * Returns the application's review, creating it on first use.
 *
 * The first person to record anything becomes the reviewer of record; later
 * editors are captured per item and per observation rather than overwriting
 * that. Reviews are collaborative here — an analyst may work the checklist and
 * a manager add an observation — so "the reviewer" means who opened it, not who
 * owns it exclusively.
 *
 * CALLERS MUST HAVE CHECKED SCOPE ALREADY. This takes an application id on
 * trust because every exported path above it re-resolves the application first.
 * It is not exported.
 */
async function ensureReview(
  applicationId: string,
  actorProfileId: string
): Promise<{ id: string } | null> {
  const supabase = getSupabaseServerClient();

  const { data: existing } = await supabase
    .from("application_reviews")
    .select("id")
    .eq("application_id", applicationId)
    .maybeSingle<{ id: string }>();
  if (existing) return existing;

  const { data, error } = await supabase
    .from("application_reviews")
    .insert({ application_id: applicationId, reviewer_profile_id: actorProfileId })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    // Two reviewers opening the tab in the same instant race here. The UNIQUE
    // constraint on application_id decides it, and the loser reads the winner's
    // row rather than failing somebody's first click.
    if (error.code === "23505") {
      const { data: raced } = await supabase
        .from("application_reviews")
        .select("id")
        .eq("application_id", applicationId)
        .maybeSingle<{ id: string }>();
      return raced ?? null;
    }
    console.error("[review service] Failed to create review:", error.code ?? error.message);
    return null;
  }
  return data;
}

/** True when a review exists for this application and is already completed. */
async function isReviewLocked(applicationId: string): Promise<boolean> {
  const supabase = getSupabaseServerClient();
  const { data } = await supabase
    .from("application_reviews")
    .select("status")
    .eq("application_id", applicationId)
    .maybeSingle<{ status: string }>();
  return data?.status === "completed";
}

/**
 * Records one reviewer's conclusion about one checklist item.
 *
 * A COMPLETED REVIEW IS NOT EDITABLE. Editing an item underneath a finished
 * review would silently invalidate a completion somebody put their name to;
 * reopen it first, which states a reason and leaves an event.
 *
 * NO EVENT PER ITEM. Twenty ticks would bury the three entries — recommended,
 * completed, reopened — that a reader of the activity feed actually needs, and
 * each item already carries its own editor and timestamp.
 */
export async function setReviewItemState(
  scope: BranchScope,
  applicationId: string,
  itemCode: string,
  state: ReviewItemState,
  note: string | null,
  actorProfileId: string
): Promise<ReviewMutationResult> {
  if (!(await isApplicationInScope(scope, applicationId))) {
    return { status: "error", code: "NOT_ACCESSIBLE" };
  }

  const definition = REVIEW_ITEMS.find((item) => item.code === itemCode);
  if (!definition) return { status: "error", code: "INVALID" };

  // Mirrors the CHECK constraint, so a reviewer gets a specific message rather
  // than a database error.
  const trimmedNote = note?.trim() ?? "";
  if (state === "issue" && !trimmedNote) return { status: "error", code: "INVALID" };

  if (await isReviewLocked(applicationId)) return { status: "error", code: "INVALID" };

  const review = await ensureReview(applicationId, actorProfileId);
  if (!review) return { status: "error", code: "UPDATE_FAILED" };

  const supabase = getSupabaseServerClient();
  const now = new Date().toISOString();

  const { error } = await supabase.from("application_review_items").upsert(
    {
      review_id: review.id,
      section: definition.section,
      item_code: itemCode,
      state,
      note: trimmedNote || null,
      updated_by_profile_id: actorProfileId,
      updated_at: now,
    },
    { onConflict: "review_id,item_code" }
  );

  if (error) {
    console.error("[review service] Failed to set item state:", error.code ?? error.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }

  await touchReview(review.id, now);
  return { status: "ok", reviewId: review.id };
}

/**
 * Appends an observation.
 *
 * APPEND-ONLY, and the table grants no UPDATE or DELETE to back that up. An
 * observation is what a reviewer said at a moment; a correction is another
 * observation, not a rewrite of the first.
 *
 * ALLOWED ON A COMPLETED REVIEW. Adding a note to a finished review changes no
 * conclusion and invalidates nothing — it is how somebody records what they
 * learned afterwards without reopening the file.
 */
export async function addReviewObservation(
  scope: BranchScope,
  applicationId: string,
  category: ReviewObservationCategory,
  body: string,
  actorProfileId: string
): Promise<ReviewMutationResult> {
  if (!(await isApplicationInScope(scope, applicationId))) {
    return { status: "error", code: "NOT_ACCESSIBLE" };
  }
  const trimmed = body.trim();
  if (!trimmed) return { status: "error", code: "INVALID" };

  const review = await ensureReview(applicationId, actorProfileId);
  if (!review) return { status: "error", code: "UPDATE_FAILED" };

  const supabase = getSupabaseServerClient();
  const { error } = await supabase.from("application_review_observations").insert({
    review_id: review.id,
    category,
    body: trimmed,
    author_profile_id: actorProfileId,
  });

  if (error) {
    console.error("[review service] Failed to add observation:", error.code ?? error.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }

  await touchReview(review.id, new Date().toISOString());
  return { status: "ok", reviewId: review.id };
}

/**
 * Records a human recommendation.
 *
 * RECOMMENDATION IS NOT DECISION. This writes columns on the review and an
 * audit event. NOTHING about the application changes — not its status, not its
 * stage, not its assignment. An analyst who recommends approval has approved
 * nothing; somebody holding `application:set_status` still has to act, through
 * `setApplicationStatus`, and that act is what the customer's record reflects.
 */
export async function setReviewRecommendation(
  scope: BranchScope,
  applicationId: string,
  recommendation: ReviewRecommendation,
  note: string | null,
  actorProfileId: string
): Promise<ReviewMutationResult> {
  if (!(await isApplicationInScope(scope, applicationId))) {
    return { status: "error", code: "NOT_ACCESSIBLE" };
  }
  if (await isReviewLocked(applicationId)) return { status: "error", code: "INVALID" };

  const review = await ensureReview(applicationId, actorProfileId);
  if (!review) return { status: "error", code: "UPDATE_FAILED" };

  const supabase = getSupabaseServerClient();
  const now = new Date().toISOString();
  const isCleared = recommendation === "pending";

  const { error } = await supabase
    .from("application_reviews")
    .update({
      recommendation,
      recommendation_note: note?.trim() || null,
      // Cleared back to pending, the attribution goes with it — a name and a
      // time attached to a recommendation nobody is making is a false record.
      recommendation_at: isCleared ? null : now,
      recommendation_by_profile_id: isCleared ? null : actorProfileId,
      updated_at: now,
    })
    .eq("id", review.id);

  if (error) {
    // 23514 is the note-required CHECK doing its job.
    if (error.code === "23514") return { status: "error", code: "INVALID" };
    console.error("[review service] Failed to set recommendation:", error.code ?? error.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }

  if (!isCleared) {
    await recordReviewEvent(
      "application_review_recommended",
      review.id,
      applicationId,
      actorProfileId,
      { recommendation }
    );
  }
  return { status: "ok", reviewId: review.id };
}

export type CompleteReviewResult =
  | { status: "ok" }
  | { status: "blocked"; blockers: CompletionBlocker[] }
  | { status: "error"; code: "NOT_ACCESSIBLE" | "NOT_FOUND" | "UPDATE_FAILED" };

/**
 * Marks the review finished, if it may be.
 *
 * THE SERVER RE-EVALUATES. `canComplete` on the view is what greys the button
 * out; this is what decides. A stale page, a second tab, a slow network or a
 * crafted request all arrive here and are checked against the record as it
 * stands right now — including the documents, re-read rather than trusted from
 * whatever the browser was rendered with.
 *
 * THE UPDATE IS GUARDED ON `status = 'in_progress'`, so two reviewers clicking
 * at once produce one completion rather than two with different names on them.
 */
export async function completeReview(
  scope: BranchScope,
  applicationId: string,
  actorProfileId: string
): Promise<CompleteReviewResult> {
  if (!(await isApplicationInScope(scope, applicationId))) {
    return { status: "error", code: "NOT_ACCESSIBLE" };
  }

  const current = await getApplicationReview(scope, applicationId);
  if (current.status !== "ok" || !current.review.reviewId) {
    return { status: "error", code: "NOT_FOUND" };
  }
  if (current.review.status === "completed") return { status: "ok" };

  const verdict = evaluateCompletion(current.review.attention);
  if (!verdict.ok) return { status: "blocked", blockers: verdict.blockers };

  const supabase = getSupabaseServerClient();
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("application_reviews")
    .update({
      status: "completed",
      completed_at: now,
      completed_by_profile_id: actorProfileId,
      updated_at: now,
    })
    .eq("id", current.review.reviewId)
    .eq("status", "in_progress")
    .select("id");

  if (error) {
    console.error("[review service] Failed to complete review:", error.code ?? error.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }
  // Nothing matched => somebody else completed it between the read and the
  // write. Their completion stands, and no second event is written.
  if ((data ?? []).length === 0) return { status: "ok" };

  await recordReviewEvent(
    "application_review_completed",
    current.review.reviewId,
    applicationId,
    actorProfileId,
    { recommendation: current.review.recommendation }
  );
  return { status: "ok" };
}

/**
 * Reopens a completed review.
 *
 * A REASON IS REQUIRED, and it is the one piece of free text these events
 * carry: a completion is being set aside, and a reopening with no stated cause
 * cannot be audited afterwards.
 *
 * THE PREVIOUS COMPLETION IS NOT ERASED. It survives in the
 * `application_review_completed` event already written to the append-only log,
 * which is what makes it safe to clear the row's own columns — the same trade
 * 26B-8 makes when an alert is reactivated.
 *
 * THE CHECKLIST IS LEFT ALONE. Reopening asks for another look, not for the
 * work to be redone from nothing; wiping the items would destroy conclusions
 * that are still valid and still attributed to the people who reached them.
 */
export async function reopenReview(
  scope: BranchScope,
  applicationId: string,
  reason: string,
  actorProfileId: string
): Promise<ReviewMutationResult> {
  if (!(await isApplicationInScope(scope, applicationId))) {
    return { status: "error", code: "NOT_ACCESSIBLE" };
  }
  const trimmed = reason.trim();
  if (!trimmed) return { status: "error", code: "INVALID" };

  const supabase = getSupabaseServerClient();
  const { data: review } = await supabase
    .from("application_reviews")
    .select("id, status")
    .eq("application_id", applicationId)
    .maybeSingle<{ id: string; status: string }>();

  if (!review) return { status: "error", code: "NOT_FOUND" };
  if (review.status !== "completed") return { status: "error", code: "INVALID" };

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("application_reviews")
    .update({
      status: "in_progress",
      completed_at: null,
      completed_by_profile_id: null,
      updated_at: now,
    })
    .eq("id", review.id)
    .eq("status", "completed")
    .select("id");

  if (error) {
    console.error("[review service] Failed to reopen review:", error.code ?? error.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }
  if ((data ?? []).length === 0) return { status: "error", code: "INVALID" };

  await recordReviewEvent("application_review_reopened", review.id, applicationId, actorProfileId, {
    // Bounded because crm_events has no delete path — an accidental paste of a
    // whole document into this field could never be taken back out.
    reason: trimmed.slice(0, 500),
  });
  return { status: "ok", reviewId: review.id };
}

/** Keeps `updated_at` honest after a child-table write. Non-fatal: a stale
 * timestamp must never fail the mutation that actually succeeded. */
async function touchReview(reviewId: string, now: string): Promise<void> {
  try {
    const supabase = getSupabaseServerClient();
    await supabase.from("application_reviews").update({ updated_at: now }).eq("id", reviewId);
  } catch {
    /* deliberately ignored — see above */
  }
}

/**
 * Audit, through the RPC.
 *
 * `crm_events` grants service_role SELECT only, so a direct insert is silently
 * refused — 26B-9B found that the hard way, with emails sending and the
 * customer's activity staying empty. Every event in this system is written from
 * inside a SECURITY DEFINER function, which is what keeps the audit log closed
 * to ordinary application code.
 *
 * NON-FATAL. The reviewer's action has already been recorded; failing it
 * because the history row did not write would report a success as a failure.
 */
async function recordReviewEvent(
  eventType:
    | "application_review_recommended"
    | "application_review_completed"
    | "application_review_reopened",
  reviewId: string,
  applicationId: string,
  actorProfileId: string,
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.rpc("record_application_review_event", {
      p_event_type: eventType,
      p_review_id: reviewId,
      p_application_id: applicationId,
      p_actor_profile_id: actorProfileId,
      p_payload: payload,
    });
    if (error) console.error("[review service] Failed to record review event:", error.message);
  } catch (error) {
    console.error(
      "[review service] Failed to record review event:",
      error instanceof Error ? error.message : "unknown error"
    );
  }
}
