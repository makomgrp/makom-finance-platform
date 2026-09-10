import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { applyBranchScope, isEmptyScope } from "@/lib/services/branch-scope-query";
import type { BranchScope } from "@/types";
import { isDocumentPackageComplete, type CompletenessSlot } from "./document-completeness.ts";

/**
 * ============================================================================
 * MILESTONE 2.4 — "READY FOR REVIEW", NOT A DECISION
 * ============================================================================
 *
 * Called from `setRequirementSlotStatus` — the single existing write path for
 * `requirement_slots.status` — immediately after a slot transitions into
 * `satisfied` or `waived`, the only moment the applicant's document package
 * can newly become complete (see `document-completeness.ts` for why).
 *
 * This function does three things and nothing else: reads every slot for the
 * application, decides completeness with the same pure rule 2.3 already
 * established, and — only if that rule says yes — atomically claims a durable
 * marker and pushes an internal nudge to the assigned advisor. It never
 * changes `applications.status`, never completes a review, and never makes or
 * implies a credit decision. "Ready for review" is the entire vocabulary this
 * file is allowed to use.
 *
 * ----------------------------------------------------------------------------
 * BEST-EFFORT, NEVER THROWN BACK AT THE CALLER
 * ----------------------------------------------------------------------------
 * A staff member marking one evidence file satisfied must never fail, or
 * appear to fail, because this side effect had trouble — the slot status
 * change is the operation that matters, this is a nudge on top of it. Every
 * failure here is logged and swallowed, mirroring `broadcastFollowUpReminder`
 * / `broadcastDocumentRequest`'s own convention.
 *
 * ----------------------------------------------------------------------------
 * THE ATOMIC CLAIM ALSO EXCLUDES TERMINAL APPLICATIONS
 * ----------------------------------------------------------------------------
 * A "ready for review" nudge for a case that is already approved, not
 * eligible, or cancelled is not wrong, it is obsolete — the decision already
 * happened. The guarded UPDATE's WHERE clause checks this at claim time, not
 * only at read time, for the same reason the claim re-checks
 * `documents_complete_notified_at is null` rather than trusting the read: a
 * decision can land between this function's read and its write.
 *
 * ----------------------------------------------------------------------------
 * WHY NO SCOPE / BRANCH FILTER HERE
 * ----------------------------------------------------------------------------
 * This runs as a system-level consequence of a write the caller was already
 * authorized to make (branch-checked inside `record_requirement_slot_status_
 * change` itself). It reads back rows the same request just touched and
 * returns nothing to a human caller unfiltered — exactly the posture
 * `SYSTEM_NATIONAL_SCOPE` documents, so no separate scope threading is needed
 * for this internal check.
 */

const SLOTS_SELECT = "required, applicant_visible, actor, subject_type, status";

interface SlotRow {
  required: boolean;
  applicant_visible: boolean;
  actor: CompletenessSlot["actor"];
  subject_type: CompletenessSlot["subjectType"];
  status: CompletenessSlot["status"];
}

export interface DocumentsCompleteNotification {
  applicationId: string;
  applicationNumber?: string;
  advisorProfileId: string;
  clientFullName: string;
}

async function broadcastDocumentsComplete(notification: DocumentsCompleteNotification): Promise<void> {
  const supabase = getSupabaseServerClient();
  const channel = supabase.channel(`chat:user:${notification.advisorProfileId}`);
  try {
    await channel.httpSend("requirement.documents_complete", notification);
  } catch (error) {
    console.error(
      "[document completeness workflow] broadcast failed:",
      error instanceof Error ? error.message : "unknown error"
    );
  } finally {
    await supabase.removeChannel(channel);
  }
}

/**
 * Evaluates one application's document completeness and, if newly complete,
 * atomically claims the durable marker and notifies the assigned advisor.
 * Safe to call redundantly (e.g. from concurrent requests touching different
 * slots of the same application) — at most one caller ever wins the claim.
 *
 * Never throws: every failure is logged and the function returns quietly,
 * because the slot status change that triggered this must never be affected
 * by it.
 */
export async function evaluateDocumentsCompleteWorkflow(applicationId: string): Promise<void> {
  try {
    const supabase = getSupabaseServerClient();

    const { data: slotRows, error: slotsError } = await supabase
      .from("requirement_slots")
      .select(SLOTS_SELECT)
      .eq("application_id", applicationId);

    if (slotsError) {
      console.error(
        "[document completeness workflow] failed to read slots:",
        slotsError.message
      );
      return;
    }

    const slots: CompletenessSlot[] = ((slotRows ?? []) as unknown as SlotRow[]).map((row) => ({
      required: row.required,
      applicantVisible: row.applicant_visible,
      actor: row.actor,
      subjectType: row.subject_type,
      status: row.status,
    }));

    if (!isDocumentPackageComplete(slots)) return;

    // THE ATOMIC CLAIM. `documents_complete_notified_at is null` re-checked
    // here, together with excluding terminal statuses, is what makes this
    // safe under concurrency and safe against an obsolete notification —
    // whichever caller's UPDATE commits first wins, and `.select("id")`
    // tells this call whether it actually won.
    const { data: claimedRows, error: claimError } = await supabase
      .from("applications")
      .update({ documents_complete_notified_at: new Date().toISOString() })
      .eq("id", applicationId)
      .is("documents_complete_notified_at", null)
      // Excludes the three terminal application statuses one at a time
      // (chained filters AND together) rather than a single `.not(..., "in",
      // ...)`, so the value format is never in question.
      .neq("status", "approved")
      .neq("status", "not_eligible")
      .neq("status", "cancelled")
      .select("id, application_number, assigned_advisor_profile_id, client:clients!applications_client_id_fkey(full_name)");

    if (claimError) {
      console.error("[document completeness workflow] failed to claim:", claimError.message);
      return;
    }

    const claimed = (claimedRows ?? [])[0] as unknown as
      | {
          id: string;
          application_number: string | null;
          assigned_advisor_profile_id: string | null;
          client: { full_name: string } | null;
        }
      | undefined;

    if (!claimed) return; // lost the race, or application no longer eligible — not an error.

    // NO ADVISOR, NO NOTIFICATION. The marker is already claimed (this is a
    // fact about the application regardless of who owns it); there is simply
    // nobody to nudge yet, and inventing a supervisor recipient is out of
    // scope for this milestone — same posture as 2.2/2.3.
    if (!claimed.assigned_advisor_profile_id) return;

    await broadcastDocumentsComplete({
      applicationId: claimed.id,
      applicationNumber: claimed.application_number ?? undefined,
      advisorProfileId: claimed.assigned_advisor_profile_id,
      clientFullName: claimed.client?.full_name ?? "",
    });
  } catch (error) {
    console.error(
      "[document completeness workflow] unexpected failure:",
      error instanceof Error ? error.message : "unknown error"
    );
  }
}

const MY_READY_FOR_REVIEW_SELECT =
  "id, application_number, documents_complete_notified_at, " +
  "client:clients!applications_client_id_fkey(full_name)";

interface MyReadyForReviewRow {
  id: string;
  application_number: string | null;
  documents_complete_notified_at: string;
  client: { full_name: string } | null;
}

/** One application whose document package is complete and still awaiting
 * human review — for the assigned advisor's own dashboard view. Read-only;
 * never used to decide the workflow's own claim. */
export interface MyReadyForReviewItem {
  applicationId: string;
  applicationNumber?: string;
  clientFullName: string;
  documentsCompleteNotifiedAt: string;
}

/**
 * The viewer's OWN applications that are ready for human review: the
 * document-completeness marker is set AND the application is still
 * `in_review` — once a case leaves that status the decision already
 * happened, and this persistent list stops being the relevant place to look
 * for it (the marker itself, and the notification already sent, are not
 * un-set or un-sent; they simply age out of this particular view). Branch-
 * scoped and advisor-scoped like every other personal dashboard read in this
 * codebase (see `getMyOutstandingDocumentRequests`) — deliberately separate
 * from the cron's own claim, which runs system-wide with no scope at all.
 */
export async function getMyReadyForReviewApplications(
  scope: BranchScope,
  advisorProfileId: string
): Promise<MyReadyForReviewItem[]> {
  if (isEmptyScope(scope)) return [];

  const supabase = getSupabaseServerClient();
  const { data, error } = await applyBranchScope(
    supabase
      .from("applications")
      .select(MY_READY_FOR_REVIEW_SELECT)
      .eq("assigned_advisor_profile_id", advisorProfileId)
      .eq("status", "in_review")
      .not("documents_complete_notified_at", "is", null),
    scope,
    "branch_id"
  );

  if (error) {
    console.error(
      "[document completeness workflow] failed to read ready-for-review applications:",
      error.message
    );
    return [];
  }

  return ((data ?? []) as unknown as MyReadyForReviewRow[]).map((row) => ({
    applicationId: row.id,
    applicationNumber: row.application_number ?? undefined,
    clientFullName: row.client?.full_name ?? "",
    documentsCompleteNotifiedAt: row.documents_complete_notified_at,
  }));
}
