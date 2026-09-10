import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { applyBranchScope, isEmptyScope } from "@/lib/services/branch-scope-query";
import type { BranchScope } from "@/types";
import {
  selectDocumentRequestCandidates,
  type DocumentRequestCandidate,
  type EligibleActor,
  type EligibleStatus,
  type EligibleSubjectType,
} from "./document-request-eligibility.ts";

/**
 * ============================================================================
 * MILESTONE 2.3 — INTERNAL DOCUMENT REQUESTS
 * ============================================================================
 *
 * Turns a requirement slot the CRM already knows is outstanding into a
 * one-time internal nudge to the advisor who owns the case. Internal only:
 * this file never calls sendMail, never composes a customer-facing message,
 * and never touches WhatsApp — that activation is a separate, later
 * authorization (see the 2.3 architecture audit, § Customer Communication
 * Boundary).
 *
 * The eligibility decision — which slots qualify, and why the rest were left
 * alone — lives in `document-request-eligibility.ts` as a pure function, so
 * it can be unit-tested with `node --test` without a Supabase client. This
 * file is everything around that decision: the read, the atomic claim, and
 * the best-effort Realtime push. Same split, same reasoning, as
 * `follow-up-reminders.ts` / `follow-up-reminder-eligibility.ts` in 2.2.
 *
 * ----------------------------------------------------------------------------
 * THE READ IS ALLOWED TO BE STALE. THE CLAIM IS NOT.
 * ----------------------------------------------------------------------------
 * Two concurrent cron invocations can both read the same pending slot with no
 * consequence. What must not happen twice is the WRITE: `processDueDocumentRequests`
 * issues a single guarded UPDATE (`document_request_generated_at is null`),
 * identical in shape to 2.2's `internal_reminder_sent_at` claim. Under
 * Postgres's normal row locking, a second concurrent UPDATE against an
 * already-claimed row serializes behind the first, then re-evaluates its
 * WHERE clause against what was just committed and matches nothing.
 *
 * ----------------------------------------------------------------------------
 * NO ADVISOR, NO CLAIM
 * ----------------------------------------------------------------------------
 * A slot on an application with no `assigned_advisor_profile_id` is left
 * untouched — not claimed, not notified. Inventing a supervisor-escalation
 * target is explicitly out of scope for this milestone.
 */

const CANDIDATE_SELECT =
  "id, application_id, required, applicant_visible, actor, subject_type, status, " +
  "document_request_generated_at, name, " +
  "application:applications!requirement_slots_application_id_fkey(" +
  "application_number, assigned_advisor_profile_id, " +
  "client:clients!applications_client_id_fkey(full_name)" +
  ")";

interface CandidateApplication {
  application_number: string | null;
  assigned_advisor_profile_id: string | null;
  client: { full_name: string } | null;
}

interface CandidateRow {
  id: string;
  application_id: string;
  required: boolean;
  applicant_visible: boolean;
  actor: EligibleActor;
  subject_type: EligibleSubjectType;
  status: EligibleStatus;
  document_request_generated_at: string | null;
  name: { es: string; en: string };
  application: CandidateApplication | null;
}

function toCandidate(row: CandidateRow): DocumentRequestCandidate {
  return {
    id: row.id,
    applicationId: row.application_id,
    required: row.required,
    applicantVisible: row.applicant_visible,
    actor: row.actor,
    subjectType: row.subject_type,
    status: row.status,
    advisorProfileId: row.application?.assigned_advisor_profile_id ?? null,
    applicationNumber: row.application?.application_number ?? undefined,
    clientFullName: row.application?.client?.full_name ?? "",
    slotNameEs: row.name?.es ?? "",
    slotNameEn: row.name?.en ?? "",
  };
}

export interface DocumentRequestNotification {
  requirementSlotId: string;
  applicationId: string;
  applicationNumber?: string;
  advisorProfileId: string;
  clientFullName: string;
  slotNameEs: string;
  slotNameEn: string;
}

export interface ProcessDueDocumentRequestsResult {
  candidatesRead: number;
  claimed: number;
  skippedUnassigned: number;
  skippedNotEligible: number;
  notifyFailures: number;
}

/**
 * Sends one best-effort broadcast to the advisor's existing per-user
 * notification channel — same channel `follow-up-reminders.ts` already uses
 * (`chat:user:{profileId}`), one persistent subscription per session, not a
 * second one for this milestone. This file does not import chat.ts's private
 * sender for the same reason `follow-up-reminders.ts` does not: that helper's
 * type is narrowed to chat's own event names, and widening it here would
 * touch working, unrelated code for a four-line saving. Failure here is
 * swallowed, never thrown: the persistent documents workspace is the reliable
 * surface, this is only the nudge.
 */
async function broadcastDocumentRequest(notification: DocumentRequestNotification): Promise<void> {
  const supabase = getSupabaseServerClient();
  const channel = supabase.channel(`chat:user:${notification.advisorProfileId}`);
  try {
    await channel.httpSend("document.request_generated", notification);
  } catch (error) {
    console.error(
      "[document requests] broadcast failed:",
      error instanceof Error ? error.message : "unknown error"
    );
  } finally {
    await supabase.removeChannel(channel);
  }
}

/**
 * The cron's whole job: read outstanding requirement slots, decide which
 * qualify, atomically claim exactly those, and notify their advisors. Safe to
 * invoke with zero eligible rows, and safe to invoke twice in immediate
 * succession — the second call claims nothing the first one already claimed.
 *
 * Sends NO customer communication of any kind.
 */
export async function processDueDocumentRequests(): Promise<ProcessDueDocumentRequestsResult> {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from("requirement_slots")
    .select(CANDIDATE_SELECT)
    .is("document_request_generated_at", null);

  if (error) {
    console.error("[document requests] failed to read candidates:", error.message);
    return {
      candidatesRead: 0,
      claimed: 0,
      skippedUnassigned: 0,
      skippedNotEligible: 0,
      notifyFailures: 0,
    };
  }

  const rows = (data ?? []) as unknown as CandidateRow[];
  const candidates = rows.map(toCandidate);

  const { toClaim, skippedUnassigned, skippedNotEligible } =
    selectDocumentRequestCandidates(candidates);

  if (toClaim.length === 0) {
    return {
      candidatesRead: candidates.length,
      claimed: 0,
      skippedUnassigned,
      skippedNotEligible,
      notifyFailures: 0,
    };
  }

  // THE ATOMIC CLAIM. `is("document_request_generated_at", null)` re-checked
  // here — not just relied upon from the read above — is what makes two
  // concurrent invocations of this whole function safe: whichever one's
  // UPDATE commits first wins each row, and `.select("id")` on the response
  // tells this invocation exactly which rows it actually won, never assumed.
  const { data: claimedRows, error: claimError } = await supabase
    .from("requirement_slots")
    .update({ document_request_generated_at: new Date().toISOString() })
    .in(
      "id",
      toClaim.map((c) => c.id)
    )
    .is("document_request_generated_at", null)
    .select("id");

  if (claimError) {
    console.error("[document requests] failed to claim rows:", claimError.message);
    return {
      candidatesRead: candidates.length,
      claimed: 0,
      skippedUnassigned,
      skippedNotEligible,
      notifyFailures: 0,
    };
  }

  const claimedIds = new Set((claimedRows ?? []).map((r) => (r as { id: string }).id));
  const won = toClaim.filter((c) => claimedIds.has(c.id));

  const outcomes = await Promise.allSettled(
    won.map((c) =>
      broadcastDocumentRequest({
        requirementSlotId: c.id,
        applicationId: c.applicationId,
        applicationNumber: c.applicationNumber,
        advisorProfileId: c.advisorProfileId as string,
        clientFullName: c.clientFullName,
        slotNameEs: c.slotNameEs,
        slotNameEn: c.slotNameEn,
      })
    )
  );
  const notifyFailures = outcomes.filter((o) => o.status === "rejected").length;

  return {
    candidatesRead: candidates.length,
    claimed: won.length,
    skippedUnassigned,
    skippedNotEligible,
    notifyFailures,
  };
}

const MY_REQUESTS_SELECT =
  "id, status, document_request_generated_at, name, " +
  "application:applications!requirement_slots_application_id_fkey!inner(" +
  "id, application_number, assigned_advisor_profile_id, branch_id, " +
  "client:clients!applications_client_id_fkey(full_name)" +
  ")";

interface MyRequestsApplication {
  id: string;
  application_number: string | null;
  assigned_advisor_profile_id: string | null;
  branch_id: string | null;
  client: { full_name: string } | null;
}

interface MyRequestsRow {
  id: string;
  status: EligibleStatus;
  document_request_generated_at: string | null;
  name: { es: string; en: string };
  application: MyRequestsApplication;
}

/** One outstanding required document, for the assigned advisor's own
 * dashboard view — read-only, never used to decide the cron's claim. */
export interface MyDocumentRequestItem {
  requirementSlotId: string;
  applicationId: string;
  applicationNumber?: string;
  clientFullName: string;
  slotNameEs: string;
  slotNameEn: string;
  status: EligibleStatus;
  requestGenerated: boolean;
}

/**
 * The viewer's OWN outstanding required documents (pending/missing,
 * applicant-visible, client-facing, application-level — same eligibility
 * question `document-request-eligibility.ts` asks for the cron, asked here as
 * a plain read instead of a claim). Branch-scoped like every other read in
 * this codebase; the cron itself is intentionally NOT scoped this way,
 * because it runs as service_role system-wide and targets one specific
 * advisor per row rather than a viewer's whole visible set.
 */
export async function getMyOutstandingDocumentRequests(
  scope: BranchScope,
  advisorProfileId: string
): Promise<MyDocumentRequestItem[]> {
  if (isEmptyScope(scope)) return [];

  const supabase = getSupabaseServerClient();
  const { data, error } = await applyBranchScope(
    supabase
      .from("requirement_slots")
      .select(MY_REQUESTS_SELECT)
      .eq("required", true)
      .eq("applicant_visible", true)
      .eq("actor", "client")
      .eq("subject_type", "application")
      .in("status", ["pending", "missing"])
      .eq("application.assigned_advisor_profile_id", advisorProfileId),
    scope,
    "application.branch_id"
  );

  if (error) {
    console.error("[document requests] failed to read my outstanding requests:", error.message);
    return [];
  }

  return ((data ?? []) as unknown as MyRequestsRow[]).map((row) => ({
    requirementSlotId: row.id,
    applicationId: row.application.id,
    applicationNumber: row.application.application_number ?? undefined,
    clientFullName: row.application.client?.full_name ?? "",
    slotNameEs: row.name?.es ?? "",
    slotNameEn: row.name?.en ?? "",
    status: row.status,
    requestGenerated: row.document_request_generated_at !== null,
  }));
}
