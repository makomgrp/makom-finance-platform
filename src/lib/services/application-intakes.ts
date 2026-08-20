import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  APPLICATION_INTAKE_PROCESSING_CLAIM_STALE_AFTER_MS,
  APPLICATION_INTAKE_STATUS_TRANSITIONS,
} from "@/lib/config/application-intake";
import { recordAutomationEvent } from "./automation-events";
import type {
  ApplicationIntake,
  ApplicationIntakeReviewReason,
  ApplicationIntakeStatus,
  ApplicationSource,
  IdentificationType,
  PortalStep,
} from "@/types";

/**
 * Server-only service for the Application Intake pipeline's own table
 * (Milestone 15B — see the Milestone 15A architecture review's
 * "Proposed Canonical Intake Pipeline" section). Uses the Admin Client,
 * same posture as every other service in this app: RLS is enabled on
 * `application_intakes` with zero policies, so this is the only way to
 * read or write it until a real permissions model exists.
 *
 * Deliberately minimal, matching this milestone's foundation-only scope:
 * create, read (by id, by submission, list), and three narrow,
 * purpose-built status transitions — never a generic unrestricted patch
 * function, the same discipline src/lib/services/clients.ts applies
 * (setClientStatus/setClientRestricted as two dedicated functions rather
 * than one polymorphic setter). No channel adapter exists yet; every
 * current caller is src/lib/services/application-intake-processing.ts
 * and dev/verification scripts, exactly like every other service in
 * this app before its own UI/Server Action layer exists.
 *
 * SECURITY CONTRACT — raw_payload: this column is an audit/replay
 * mechanism only. Callers (today: nothing yet; eventually every channel
 * adapter) MUST NEVER pass secrets, API keys, webhook signatures, or
 * authorization headers into it. This function does not — and cannot —
 * strip such values automatically; the boundary is enforced by every
 * caller, not by this service.
 */

interface ApplicationIntakeRow {
  id: string;
  channel: string;
  submission_id: string | null;
  status: string;
  raw_payload: Record<string, unknown>;
  applicant_full_name: string | null;
  applicant_identification_type: string | null;
  applicant_identification_number: string | null;
  applicant_email: string | null;
  applicant_phone: string | null;
  applicant_birth_date: string | null;
  applicant_nationality: string | null;
  applicant_address: string | null;
  applicant_position: string | null;
  requested_product_code: string | null;
  requested_amount: number | null;
  requested_term_months: number | null;
  employer_name: string | null;
  monthly_salary: number | null;
  matched_client_id: string | null;
  created_application_id: string | null;
  review_reason: string | null;
  received_at: string;
  processed_at: string | null;
  current_step: string;
  last_activity_at: string;
  submitted_at: string | null;
}

const APPLICATION_INTAKE_SELECT =
  "id, channel, submission_id, status, raw_payload, applicant_full_name, applicant_identification_type, " +
  "applicant_identification_number, applicant_email, applicant_phone, applicant_birth_date, " +
  "applicant_nationality, applicant_address, applicant_position, requested_product_code, requested_amount, " +
  "requested_term_months, employer_name, monthly_salary, matched_client_id, created_application_id, " +
  "review_reason, received_at, processed_at, current_step, last_activity_at, submitted_at";

function toApplicationIntake(row: ApplicationIntakeRow): ApplicationIntake {
  return {
    id: row.id,
    channel: row.channel as ApplicationSource,
    submissionId: row.submission_id ?? undefined,
    status: row.status as ApplicationIntakeStatus,
    rawPayload: row.raw_payload ?? {},
    applicantFullName: row.applicant_full_name ?? undefined,
    applicantIdentificationType: (row.applicant_identification_type as IdentificationType | null) ?? undefined,
    applicantIdentificationNumber: row.applicant_identification_number ?? undefined,
    applicantEmail: row.applicant_email ?? undefined,
    applicantPhone: row.applicant_phone ?? undefined,
    applicantBirthDate: row.applicant_birth_date ?? undefined,
    applicantNationality: row.applicant_nationality ?? undefined,
    applicantAddress: row.applicant_address ?? undefined,
    applicantPosition: row.applicant_position ?? undefined,
    requestedProductCode: row.requested_product_code ?? undefined,
    requestedAmount: row.requested_amount ?? undefined,
    requestedTermMonths: row.requested_term_months ?? undefined,
    employerName: row.employer_name ?? undefined,
    monthlySalary: row.monthly_salary ?? undefined,
    matchedClientId: row.matched_client_id ?? undefined,
    createdApplicationId: row.created_application_id ?? undefined,
    reviewReason: (row.review_reason as ApplicationIntakeReviewReason | null) ?? undefined,
    receivedAt: row.received_at,
    processedAt: row.processed_at ?? undefined,
    currentStep: row.current_step as PortalStep,
    lastActivityAt: row.last_activity_at,
    submittedAt: row.submitted_at ?? undefined,
  };
}

export interface CreateApplicationIntakeInput {
  channel: ApplicationSource;
  /** Channel-supplied idempotency key. Omit entirely for CRM-manual or
   * any other internally-originated intake with no external identifier
   * — never fabricate one. */
  submissionId?: string;
  /** Exactly what the channel supplied, for audit/replay. MUST NEVER
   * contain secrets, API keys, webhook signatures, or authorization
   * headers — see this module's doc comment. */
  rawPayload?: Record<string, unknown>;
  applicantFullName?: string;
  applicantIdentificationType?: IdentificationType;
  applicantIdentificationNumber?: string;
  applicantEmail?: string;
  applicantPhone?: string;
  /** Same field as Client.birthDate — see this module's doc comment
   * (Milestone 15B correction) for why this and the three fields below
   * were added: without them, no intake could ever supply everything
   * createClient requires. */
  applicantBirthDate?: string;
  applicantNationality?: string;
  applicantAddress?: string;
  applicantPosition?: string;
  requestedProductCode?: string;
  requestedAmount?: number;
  requestedTermMonths?: number;
  employerName?: string;
  monthlySalary?: number;
}

export type CreateApplicationIntakeResult =
  | { status: "ok"; intake: ApplicationIntake }
  | { status: "error"; code: "DUPLICATE_SUBMISSION" | "INSERT_FAILED" };

/**
 * Creates a new intake row, always at status = 'received' (the column
 * default — this function has no path to set any other status, matching
 * createClient's/createProduct's identical "new rows always start at
 * the default lifecycle state" posture). Field-level validation
 * (amount/term bounds, identification-type vocabulary) is enforced by
 * the table's own CHECK constraints, not duplicated here — this
 * function's only real decision is mapping a 23505 unique-violation
 * (channel, submission_id) to a caller-friendly DUPLICATE_SUBMISSION
 * result, the same "blanket-map 23505 to the one real duplicate" pattern
 * createClient/createProduct already use for their own unique
 * constraints.
 */
export async function createApplicationIntake(
  input: CreateApplicationIntakeInput
): Promise<CreateApplicationIntakeResult> {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from("application_intakes")
    .insert({
      channel: input.channel,
      submission_id: input.submissionId ?? null,
      raw_payload: input.rawPayload ?? {},
      applicant_full_name: input.applicantFullName ?? null,
      applicant_identification_type: input.applicantIdentificationType ?? null,
      applicant_identification_number: input.applicantIdentificationNumber ?? null,
      applicant_email: input.applicantEmail ?? null,
      applicant_phone: input.applicantPhone ?? null,
      applicant_birth_date: input.applicantBirthDate ?? null,
      applicant_nationality: input.applicantNationality ?? null,
      applicant_address: input.applicantAddress ?? null,
      applicant_position: input.applicantPosition ?? null,
      requested_product_code: input.requestedProductCode ?? null,
      requested_amount: input.requestedAmount ?? null,
      requested_term_months: input.requestedTermMonths ?? null,
      employer_name: input.employerName ?? null,
      monthly_salary: input.monthlySalary ?? null,
    })
    .select(APPLICATION_INTAKE_SELECT)
    .single<ApplicationIntakeRow>();

  if (error || !data) {
    if (error?.code === "23505") {
      return { status: "error", code: "DUPLICATE_SUBMISSION" };
    }
    console.error("[application-intakes service] Failed to insert intake:", error?.message ?? "no row returned");
    return { status: "error", code: "INSERT_FAILED" };
  }

  const intake = toApplicationIntake(data);

  // Best-effort — a failure to record this audit-trail entry must never
  // fail the intake creation it is documenting; see automation-events.ts's
  // own doc comment for why recordAutomationEvent already swallows its
  // own errors after logging them.
  await recordAutomationEvent({
    eventType: "intake_received",
    intakeId: intake.id,
    payload: { channel: intake.channel },
    actor: "system",
  });

  return { status: "ok", intake };
}

export type GetApplicationIntakeResult =
  | { status: "ok"; intake: ApplicationIntake }
  | { status: "error"; code: "NOT_FOUND" | "QUERY_FAILED" };

/** Loads a single intake by id. */
export async function getApplicationIntakeById(id: string): Promise<GetApplicationIntakeResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("application_intakes")
      .select(APPLICATION_INTAKE_SELECT)
      .eq("id", id)
      .maybeSingle<ApplicationIntakeRow>();

    if (error) {
      console.error("[application-intakes service] Failed to load intake:", error.message);
      return { status: "error", code: "QUERY_FAILED" };
    }
    if (!data) {
      return { status: "error", code: "NOT_FOUND" };
    }

    return { status: "ok", intake: toApplicationIntake(data) };
  } catch (error) {
    console.error(
      "[application-intakes service] Unexpected failure loading intake:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error", code: "QUERY_FAILED" };
  }
}

/**
 * Loads a single intake by its (channel, submission_id) idempotency
 * key — the lookup a future channel adapter uses to decide "have I
 * already recorded this exact submission" before calling
 * createApplicationIntake, and the lookup this service's own retry
 * story depends on. Returns NOT_FOUND (never an error) when nothing
 * matches, which is the expected, common case for a genuinely new
 * submission.
 */
export async function getApplicationIntakeBySubmission(
  channel: ApplicationSource,
  submissionId: string
): Promise<GetApplicationIntakeResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("application_intakes")
      .select(APPLICATION_INTAKE_SELECT)
      .eq("channel", channel)
      .eq("submission_id", submissionId)
      .maybeSingle<ApplicationIntakeRow>();

    if (error) {
      console.error("[application-intakes service] Failed to load intake by submission:", error.message);
      return { status: "error", code: "QUERY_FAILED" };
    }
    if (!data) {
      return { status: "error", code: "NOT_FOUND" };
    }

    return { status: "ok", intake: toApplicationIntake(data) };
  } catch (error) {
    console.error(
      "[application-intakes service] Unexpected failure loading intake by submission:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error", code: "QUERY_FAILED" };
  }
}

export type GetApplicationIntakesResult =
  | { status: "ok"; intakes: ApplicationIntake[] }
  | { status: "error" };

/** Loads every intake, newest first. Optionally scoped to one status —
 * the shape a future staff work-queue (`needs_review`) will need, added
 * now since it costs nothing beyond an optional `.eq()`. No pagination —
 * matches getApplications()'s/getClients()'s established "load
 * everything, filter client-side" precedent at this data scale. */
export async function getApplicationIntakes(
  status?: ApplicationIntakeStatus
): Promise<GetApplicationIntakesResult> {
  try {
    const supabase = getSupabaseServerClient();
    let query = supabase
      .from("application_intakes")
      .select(APPLICATION_INTAKE_SELECT)
      .order("received_at", { ascending: false });

    if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[application-intakes service] Failed to load intakes:", error.message);
      return { status: "error" };
    }

    const rows = (data ?? []) as unknown as ApplicationIntakeRow[];
    return { status: "ok", intakes: rows.map(toApplicationIntake) };
  } catch (error) {
    console.error(
      "[application-intakes service] Unexpected failure loading intakes:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

export type ClaimApplicationIntakeForClientResult =
  | { status: "ok"; intake: ApplicationIntake }
  | { status: "error"; code: "NOT_FOUND" | "ALREADY_CLAIMED" | "UPDATE_FAILED" };

/**
 * Transitions an intake from 'received' to 'client_matched', recording
 * matched_client_id in the same statement — the pipeline's first real
 * checkpoint (see src/lib/services/application-intake-processing.ts's
 * own doc comment for why this exact transition is where concurrent
 * processing of the same intake is made safe).
 *
 * Race-safe by construction, the same guarded-UPDATE idiom every other
 * status transition in this app already uses (see e.g.
 * src/lib/services/applications.ts#setApplicationStatus): the WHERE
 * clause requires status = 'received', so if a concurrent call already
 * won this exact transition, this UPDATE matches zero rows and returns
 * ALREADY_CLAIMED rather than silently double-processing the same
 * intake. This is also what makes retrying a failed pipeline run safe:
 * a retry that reaches this function again for an intake already past
 * 'received' correctly reports ALREADY_CLAIMED instead of re-matching.
 */
export async function claimApplicationIntakeForClient(
  intakeId: string,
  matchedClientId: string
): Promise<ClaimApplicationIntakeForClientResult> {
  const supabase = getSupabaseServerClient();

  const { data: current, error: fetchError } = await supabase
    .from("application_intakes")
    .select("id")
    .eq("id", intakeId)
    .maybeSingle();

  if (fetchError) {
    console.error(
      "[application-intakes service] Failed to look up intake before claiming:",
      fetchError.message
    );
    return { status: "error", code: "UPDATE_FAILED" };
  }
  if (!current) {
    return { status: "error", code: "NOT_FOUND" };
  }

  const { data: updated, error: updateError } = await supabase
    .from("application_intakes")
    .update({ status: "client_matched", matched_client_id: matchedClientId })
    .eq("id", intakeId)
    .eq("status", "received")
    .select(APPLICATION_INTAKE_SELECT)
    .maybeSingle<ApplicationIntakeRow>();

  if (updateError) {
    console.error("[application-intakes service] Failed to claim intake:", updateError.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }
  if (!updated) {
    return { status: "error", code: "ALREADY_CLAIMED" };
  }

  return { status: "ok", intake: toApplicationIntake(updated) };
}

export type CompleteApplicationIntakeResult =
  | { status: "ok"; intake: ApplicationIntake }
  | { status: "error"; code: "NOT_FOUND" | "INVALID_TRANSITION" | "UPDATE_FAILED" };

/**
 * Transitions an intake from 'client_matched' to 'processed', recording
 * created_application_id and processed_at in the same statement — the
 * pipeline's successful terminal state. Same guarded-UPDATE race-safety
 * as claimApplicationIntakeForClient: only ever reachable from
 * 'client_matched', so this can only fire once per intake even under
 * concurrent retries.
 */
export async function completeApplicationIntake(
  intakeId: string,
  createdApplicationId: string
): Promise<CompleteApplicationIntakeResult> {
  const supabase = getSupabaseServerClient();

  const { data: updated, error: updateError } = await supabase
    .from("application_intakes")
    .update({
      status: "processed",
      created_application_id: createdApplicationId,
      processed_at: new Date().toISOString(),
    })
    .eq("id", intakeId)
    .eq("status", "client_matched")
    .select(APPLICATION_INTAKE_SELECT)
    .maybeSingle<ApplicationIntakeRow>();

  if (updateError) {
    console.error("[application-intakes service] Failed to complete intake:", updateError.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }
  if (!updated) {
    return { status: "error", code: "INVALID_TRANSITION" };
  }

  return { status: "ok", intake: toApplicationIntake(updated) };
}

export type MarkApplicationIntakeNeedsReviewResult =
  | { status: "ok"; intake: ApplicationIntake }
  | { status: "error"; code: "NOT_FOUND" | "ALREADY_TERMINAL" | "UPDATE_FAILED" };

/**
 * Transitions an intake to 'needs_review' from either 'received' or
 * 'client_matched' — every business-level failure case the processing
 * pipeline can hit (see ApplicationIntakeReviewReason). Validates the
 * transition against APPLICATION_INTAKE_STATUS_TRANSITIONS first (both
 * source states legally reach needs_review; 'needs_review' and
 * 'processed' themselves do not), then performs the same guarded UPDATE
 * idiom as the other two transitions above — a concurrent call that
 * already moved this intake to a terminal state finds zero rows
 * matching and reports ALREADY_TERMINAL rather than overwriting a
 * decision it never validated.
 */
export async function markApplicationIntakeNeedsReview(
  intakeId: string,
  reviewReason: ApplicationIntakeReviewReason
): Promise<MarkApplicationIntakeNeedsReviewResult> {
  const supabase = getSupabaseServerClient();

  const { data: current, error: fetchError } = await supabase
    .from("application_intakes")
    .select("status")
    .eq("id", intakeId)
    .maybeSingle();

  if (fetchError) {
    console.error(
      "[application-intakes service] Failed to look up intake before marking needs_review:",
      fetchError.message
    );
    return { status: "error", code: "UPDATE_FAILED" };
  }
  if (!current) {
    return { status: "error", code: "NOT_FOUND" };
  }

  const currentStatus = current.status as ApplicationIntakeStatus;
  if (!APPLICATION_INTAKE_STATUS_TRANSITIONS[currentStatus].includes("needs_review")) {
    return { status: "error", code: "ALREADY_TERMINAL" };
  }

  const { data: updated, error: updateError } = await supabase
    .from("application_intakes")
    .update({ status: "needs_review", review_reason: reviewReason })
    .eq("id", intakeId)
    .eq("status", currentStatus)
    .select(APPLICATION_INTAKE_SELECT)
    .maybeSingle<ApplicationIntakeRow>();

  if (updateError) {
    console.error("[application-intakes service] Failed to mark intake needs_review:", updateError.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }
  if (!updated) {
    return { status: "error", code: "ALREADY_TERMINAL" };
  }

  return { status: "ok", intake: toApplicationIntake(updated) };
}

export type ClaimApplicationIntakeForProcessingResult =
  | { status: "ok"; intake: ApplicationIntake }
  | { status: "error"; code: "NOT_FOUND" | "ALREADY_CLAIMED" | "UPDATE_FAILED" };

/**
 * Atomically claims the right to attempt Application-creation for a
 * 'client_matched' intake, by setting processing_claimed_at from NULL
 * (or a stale prior claim — see below) to now() in one guarded UPDATE.
 * This is the second, narrower concurrency guard the Milestone 15B brief
 * asked for (section 17) — see
 * 20260811000300_add_processing_claim_to_application_intakes.sql's
 * header comment for the exact race this closes and why it needs a
 * marker distinct from the received->client_matched transition.
 *
 * CRASH RECOVERY (Milestone 15B correction, section 8): a worker that
 * successfully claims an intake and then crashes before calling
 * completeApplicationIntake would otherwise strand that intake at
 * 'client_matched' forever, since nothing else ever clears this marker.
 * Rather than adding a separate recovery job/workflow engine, the WHERE
 * clause itself also accepts a claim older than
 * APPLICATION_INTAKE_PROCESSING_CLAIM_STALE_AFTER_MS
 * (src/lib/config/application-intake.ts) as reclaimable. This stays
 * race-safe for the same reason every guarded UPDATE in this app is
 * race-safe: Postgres locks the row for the duration of the UPDATE, so
 * if two attempts reach this call concurrently, whichever commits first
 * sets processing_claimed_at to a fresh timestamp; the second attempt's
 * WHERE clause is then re-evaluated against that fresh (non-stale, non-
 * null) value and matches zero rows — it cannot also win.
 *
 * ALREADY_CLAIMED covers both "another attempt is mid-flight right now"
 * and "a prior attempt already completed" (completeApplicationIntake
 * does not clear this marker) — either way, the caller's correct
 * response is the same: stop, reload the intake, and report its actual
 * current state rather than attempting to create a second Application.
 * See application-intake-processing.ts for how the caller distinguishes
 * those two cases (and simply retries later if the claim is merely
 * fresh-and-in-progress, rather than reclaiming it early).
 */
export async function claimApplicationIntakeForProcessing(
  intakeId: string
): Promise<ClaimApplicationIntakeForProcessingResult> {
  const supabase = getSupabaseServerClient();

  const { data: current, error: fetchError } = await supabase
    .from("application_intakes")
    .select("id")
    .eq("id", intakeId)
    .maybeSingle();

  if (fetchError) {
    console.error(
      "[application-intakes service] Failed to look up intake before claiming for processing:",
      fetchError.message
    );
    return { status: "error", code: "UPDATE_FAILED" };
  }
  if (!current) {
    return { status: "error", code: "NOT_FOUND" };
  }

  const staleCutoff = new Date(Date.now() - APPLICATION_INTAKE_PROCESSING_CLAIM_STALE_AFTER_MS).toISOString();

  const { data: updated, error: updateError } = await supabase
    .from("application_intakes")
    .update({ processing_claimed_at: new Date().toISOString() })
    .eq("id", intakeId)
    .eq("status", "client_matched")
    .or(`processing_claimed_at.is.null,processing_claimed_at.lt.${staleCutoff}`)
    .select(APPLICATION_INTAKE_SELECT)
    .maybeSingle<ApplicationIntakeRow>();

  if (updateError) {
    console.error("[application-intakes service] Failed to claim intake for processing:", updateError.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }
  if (!updated) {
    return { status: "error", code: "ALREADY_CLAIMED" };
  }

  return { status: "ok", intake: toApplicationIntake(updated) };
}

/**
 * ============================================================================
 * MILESTONE 26A-4 — THE DRAFT LIFECYCLE
 * ============================================================================
 *
 * Writes for the customer-facing half of an intake. Deliberately narrow: each
 * function names exactly which columns it may touch, so a token-authenticated
 * portal write can never become a general-purpose row update. No caller ever
 * passes a column name.
 *
 * These do NOT touch `status`, `matched_client_id`, `created_application_id` or
 * `review_reason` — that vocabulary belongs to the 15B intake engine and its
 * guarded transitions, and a customer clicking "next" must not be able to move
 * a lead through the engine's state machine.
 */

export type UpdateIntakeDraftStateResult =
  | { status: "ok"; intake: ApplicationIntake }
  | { status: "error"; code: "NOT_FOUND" | "UPDATE_FAILED" };

/**
 * Record forward movement: where the customer now is, and that they did
 * something.
 *
 * `current_step` and `last_activity_at` move TOGETHER because they describe one
 * event. A step change is by definition activity, and letting them drift apart
 * would allow a draft to look abandoned while it was being worked on.
 *
 * REFUSES ON A SUBMITTED INTAKE. `.is("submitted_at", null)` is part of the
 * WHERE clause rather than a prior read, so the guard is atomic: a submission
 * landing between a check and an update cannot slip through. Once an
 * application is with ODL, a late draft edit must not silently alter what a
 * human is already assessing.
 */
export async function updateIntakeDraftState(
  intakeId: string,
  currentStep: PortalStep
): Promise<UpdateIntakeDraftStateResult> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("application_intakes")
    .update({ current_step: currentStep, last_activity_at: new Date().toISOString() })
    .eq("id", intakeId)
    .is("submitted_at", null)
    .select(APPLICATION_INTAKE_SELECT)
    .maybeSingle();

  if (error) {
    console.error("[application-intakes service] Failed to update draft state:", error.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }
  if (!data) {
    // Either no such intake, or it is already submitted. Both mean "this draft
    // is not editable", and distinguishing them would tell an anonymous caller
    // whether an intake exists.
    return { status: "error", code: "NOT_FOUND" };
  }

  // maybeSingle() over a runtime-built select string leaves PostgREST unable to
  // infer the row shape; every column read below is in APPLICATION_INTAKE_SELECT.
  return { status: "ok", intake: toApplicationIntake(data as unknown as ApplicationIntakeRow) };
}

/**
 * Mark that the customer changed something, without moving them.
 *
 * Called by WRITE paths only. Reads deliberately never call it: if opening a
 * link counted as activity, a customer who re-read the same email six times
 * would look busier than one who actually uploaded three documents, and the
 * future "you left an application unfinished" reminder would go to exactly the
 * wrong people.
 */
export async function touchIntakeActivity(
  intakeId: string
): Promise<{ status: "ok" } | { status: "error"; code: "UPDATE_FAILED" }> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("application_intakes")
    .update({ last_activity_at: new Date().toISOString() })
    .eq("id", intakeId)
    .is("submitted_at", null);

  if (error) {
    console.error("[application-intakes service] Failed to touch activity:", error.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }
  return { status: "ok" };
}

export type ReleaseApplicationIntakeProcessingClaimResult =
  | { status: "ok" }
  | { status: "error"; code: "UPDATE_FAILED" };

/**
 * MILESTONE 26B-1 — hand back a processing claim without having created
 * anything.
 *
 * Needed because the portal introduced a THIRD outcome for an Application-
 * creation attempt. Before 26B-1 an attempt either produced an Application or
 * routed the intake to needs_review, and both are terminal, so nothing ever had
 * to release the marker. A portal lead can now legitimately end an attempt with
 * "not enough information yet" and remain a live draft — and the moment the
 * customer supplies the missing piece, the very next attempt must be able to
 * claim it.
 *
 * Without this, that customer would wait out
 * APPLICATION_INTAKE_PROCESSING_CLAIM_STALE_AFTER_MS before their own
 * application could progress — a stall caused entirely by bookkeeping.
 *
 * NARROW ON PURPOSE: it clears the marker and touches nothing else. It cannot
 * change status, cannot unset created_application_id, and cannot resurrect a
 * finished intake, because it only ever clears a claim on a row that has not
 * produced an Application.
 */
export async function releaseApplicationIntakeProcessingClaim(
  intakeId: string
): Promise<ReleaseApplicationIntakeProcessingClaimResult> {
  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("application_intakes")
    .update({ processing_claimed_at: null })
    .eq("id", intakeId)
    .is("created_application_id", null);

  if (error) {
    console.error(
      "[application-intakes service] Failed to release processing claim:",
      error.message
    );
    return { status: "error", code: "UPDATE_FAILED" };
  }
  return { status: "ok" };
}
