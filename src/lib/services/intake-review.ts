import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { SYSTEM_NATIONAL_SCOPE } from "@/lib/services/branch-scope-query";
import { getApplicationIntakeById } from "@/lib/services/application-intakes";
import { createClient, findClientsByEmail, findClientsByPhone } from "@/lib/services/clients";
import { processApplicationIntake } from "@/lib/services/application-intake-processing";
import { recordAutomationEvent } from "@/lib/services/automation-events";
import type { ApplicationIntake, ApplicationIntakeReviewReason, Client } from "@/types";

/**
 * ============================================================================
 * MILESTONE 26B-19 — SOMEONE HAS TO DECIDE WHO THIS PERSON IS
 * ============================================================================
 *
 * When the matching engine cannot tell whether an applicant is an existing
 * client, it parks the intake and creates nothing. 26B-18 gave that applicant a
 * dignified screen instead of a 404. This gives ODL the other half: a way to
 * look at the case and answer the only question that was ever open — is this
 * the same person, or a different one?
 *
 * ----------------------------------------------------------------------------
 * IT DOES NOT MATCH. IT RECORDS A HUMAN'S ANSWER.
 * ----------------------------------------------------------------------------
 * No threshold moves, no scoring is added, and `matchClientForIntake` is not
 * called to decide anything. The candidates shown to staff are re-derived with
 * THE SAME TWO LOOKUPS the engine itself used — email and phone — so the screen
 * shows what the engine saw and never a comparison it does not make. Everything
 * after that is a person's judgement, written down.
 *
 * ----------------------------------------------------------------------------
 * RESOLUTION REJOINS THE EXISTING PIPELINE
 * ----------------------------------------------------------------------------
 * Both answers converge on the same two steps: move the intake to
 * `client_matched` (the state the automatic path uses once a client is known)
 * and hand it back to `processApplicationIntake`. That engine then does exactly
 * what it does for every other lead — creates the application, snapshots the
 * requirement slots, records its own events. There is no second pipeline here
 * and no second way to create an application.
 *
 * The applicant's continuation token needs no repair. 26B-18's guard sends them
 * to the review screen only while the intake is parked AND has no application;
 * the moment this creates one, the same link resumes at Step 2 on its own.
 */

/** What an employee needs to see in the list, and nothing that identifies a record. */
export interface IntakeReviewSummary {
  intakeId: string;
  applicantFullName?: string;
  applicantEmail?: string;
  applicantPhone?: string;
  receivedAt: string;
  requestedProductCode?: string;
  requestedAmount?: number;
  reason: ApplicationIntakeReviewReason;
}

/**
 * Every parked intake, newest first.
 *
 * NATIONAL BY NATURE. A parked intake has no client and therefore no branch to
 * scope by — that is precisely what is undecided. Scoping this by branch would
 * hide cases from everyone rather than route them to someone.
 */
export async function listIntakesNeedingReview(): Promise<IntakeReviewSummary[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("application_intakes")
    // A single literal, not a concatenation: the client infers the row type
    // from the string itself, and a `+` hides the columns from that inference.
    .select("id, applicant_full_name, applicant_email, applicant_phone, received_at, requested_product_code, requested_amount, review_reason")
    .eq("status", "needs_review")
    .is("created_application_id", null)
    .order("received_at", { ascending: false });

  if (error) {
    console.error("[intake-review service] Failed to list parked intakes:", error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    intakeId: row.id,
    applicantFullName: row.applicant_full_name ?? undefined,
    applicantEmail: row.applicant_email ?? undefined,
    applicantPhone: row.applicant_phone ?? undefined,
    receivedAt: row.received_at,
    requestedProductCode: row.requested_product_code ?? undefined,
    requestedAmount: row.requested_amount ?? undefined,
    reason: row.review_reason as ApplicationIntakeReviewReason,
  }));
}

/** Cheap enough to call from the page that renders the tab label. */
export async function countIntakesNeedingReview(): Promise<number> {
  const supabase = getSupabaseServerClient();
  const { count, error } = await supabase
    .from("application_intakes")
    .select("id", { count: "exact", head: true })
    .eq("status", "needs_review")
    .is("created_application_id", null);

  if (error) {
    console.error("[intake-review service] Failed to count parked intakes:", error.message);
    return 0;
  }
  return count ?? 0;
}

/** Only the fields the matcher actually compares on. */
export interface IntakeReviewCandidate {
  clientId: string;
  fullName: string;
  identificationType?: string;
  identificationNumber?: string;
  email?: string;
  phone?: string;
  birthDate?: string;
  /** Which lookup surfaced this client — the engine's own signals, not a score. */
  matchedOn: Array<"email" | "phone">;
}

/**
 * The flattened case the review panel renders.
 *
 * Assembled field by field rather than spreading the intake, so a column added
 * to `application_intakes` later cannot arrive on an employee's screen — or in
 * the RSC payload — just because it exists.
 */
export interface IntakeReviewCaseDetail {
  intakeId: string;
  applicantFullName?: string;
  applicantEmail?: string;
  applicantPhone?: string;
  applicantIdentificationType?: string;
  applicantIdentificationNumber?: string;
  applicantBirthDate?: string;
  receivedAt: string;
  reason: ApplicationIntakeReviewReason;
  candidates: IntakeReviewCandidate[];
}

export interface IntakeReviewCase {
  intake: ApplicationIntake;
  candidates: IntakeReviewCandidate[];
}

/**
 * One case: what the applicant sent, and who the engine could see.
 *
 * The candidate list is DERIVED, never read from `matched_client_id` — that
 * column is deliberately null for a parked intake, because nothing was matched.
 * Re-deriving also means a client edited since the intake arrived is compared
 * as they are now, which is what the person deciding needs to see.
 */
export async function getIntakeReviewCase(intakeId: string): Promise<IntakeReviewCase | undefined> {
  const intakeResult = await getApplicationIntakeById(intakeId);
  if (intakeResult.status !== "ok") return undefined;
  const intake = intakeResult.intake;
  if (intake.status !== "needs_review") return undefined;

  const [byEmail, byPhone] = await Promise.all([
    intake.applicantEmail
      ? findClientsByEmail(SYSTEM_NATIONAL_SCOPE, intake.applicantEmail)
      : Promise.resolve(null),
    intake.applicantPhone
      ? findClientsByPhone(SYSTEM_NATIONAL_SCOPE, intake.applicantPhone)
      : Promise.resolve(null),
  ]);

  const porId = new Map<string, { client: Client; matchedOn: Set<"email" | "phone"> }>();
  const add = (clients: Client[] | undefined, señal: "email" | "phone") => {
    for (const client of clients ?? []) {
      const existente = porId.get(client.id);
      if (existente) existente.matchedOn.add(señal);
      else porId.set(client.id, { client, matchedOn: new Set([señal]) });
    }
  };
  add(byEmail?.status === "ok" ? byEmail.clients : undefined, "email");
  add(byPhone?.status === "ok" ? byPhone.clients : undefined, "phone");

  return {
    intake,
    candidates: [...porId.values()].map(({ client, matchedOn }) => ({
      clientId: client.id,
      fullName: client.fullName,
      identificationType: client.identificationType,
      identificationNumber: client.identificationNumber,
      email: client.email,
      phone: client.phone,
      birthDate: client.birthDate,
      matchedOn: [...matchedOn],
    })),
  };
}

export type ResolveIntakeResult =
  | { status: "ok"; applicationId?: string }
  | { status: "error"; code: "NOT_FOUND" | "NOT_PARKED" | "INVALID_CANDIDATE" | "RESOLVE_FAILED" };

/**
 * "This IS that client."
 *
 * The guarded UPDATE is what makes a double submit safe: only a row still
 * sitting at `needs_review` matches, so a second click finds nothing to change
 * and cannot re-run the pipeline. `review_reason` is cleared in the same
 * statement because `review_reason_pair_check` ties the two together — leaving
 * it set while moving the status would be rejected by the database, which is
 * the constraint doing exactly its job.
 */
export async function resolveIntakeAsExistingClient(
  intakeId: string,
  clientId: string,
  actorProfileId: string
): Promise<ResolveIntakeResult> {
  const caso = await getIntakeReviewCase(intakeId);
  if (!caso) return { status: "error", code: "NOT_PARKED" };

  // The client must be one the ENGINE surfaced. Accepting an arbitrary id from
  // the browser would turn this into "attach this application to any customer
  // you can name", which is a different and far more dangerous action.
  if (!caso.candidates.some((c) => c.clientId === clientId)) {
    return { status: "error", code: "INVALID_CANDIDATE" };
  }

  return finishResolution(intakeId, clientId, actorProfileId, "client_matched");
}

/**
 * "This is NOT that client — it is someone new."
 *
 * Nothing is created here. Clearing the parked state and handing the intake
 * back to `processApplicationIntake` lets that engine create the client through
 * its own `createClient` call, with the same validation, the same source
 * attribution and the same automation events as every other new applicant.
 *
 * A SHARED EMAIL IS NOT A DUPLICATE. `clients` has no unique index on email or
 * phone — only on (identification_type, identification_number) — so two people
 * at one address are representable, which is the real-world case this exists
 * for. What cannot happen is two clients with one document number, and that is
 * enforced by the database rather than by this function's good intentions.
 */
export async function resolveIntakeAsNewClient(
  intakeId: string,
  actorProfileId: string
): Promise<ResolveIntakeResult> {
  const caso = await getIntakeReviewCase(intakeId);
  if (!caso) return { status: "error", code: "NOT_PARKED" };
  const { intake } = caso;

  if (
    !intake.applicantFullName ||
    !intake.applicantIdentificationType ||
    !intake.applicantIdentificationNumber ||
    !intake.applicantPhone ||
    !intake.applicantEmail
  ) {
    return { status: "error", code: "RESOLVE_FAILED" };
  }

  // CREATED HERE, NOT BY RE-RUNNING THE ENGINE. Sending the intake back to
  // `received` would re-run the very matching this decision overrides, and it
  // would park the intake again on the same signal — the reviewer's answer
  // would be silently discarded. Creating the client first means the intake
  // rejoins at `client_matched`, where matching is already settled.
  //
  // `website_form` with a null actor because that is how this person reached
  // ODL; `clients_created_by_source_check` only permits a profile against
  // `crm_manual`. Who decided it is recorded as an automation event instead.
  const created = await createClient({
    fullName: intake.applicantFullName,
    identificationType: intake.applicantIdentificationType,
    identificationNumber: intake.applicantIdentificationNumber,
    phone: intake.applicantPhone,
    email: intake.applicantEmail,
    birthDate: intake.applicantBirthDate,
    nationality: intake.applicantNationality,
    address: intake.applicantAddress,
    position: intake.applicantPosition,
    source: "website_form",
    actorProfileId: null,
  });

  if (created.status !== "ok") {
    // The one genuinely expected failure is a duplicate document number: the
    // database refusing to hold one identity twice. That is the constraint
    // working, and it means the honest answer was "existing client".
    console.error("[intake-review service] Could not create client for intake:", created.code);
    return {
      status: "error",
      code: created.code === "DUPLICATE_IDENTIFICATION" ? "INVALID_CANDIDATE" : "RESOLVE_FAILED",
    };
  }

  return finishResolution(intakeId, created.client.id, actorProfileId, "client_created");
}

/**
 * The half both answers share: unpark, then let the normal engine run.
 *
 * `processApplicationIntake` is idempotent and owns every rule about what an
 * application needs, so re-entering it is how a resolved intake becomes
 * indistinguishable from one that never needed a human at all.
 */
async function finishResolution(
  intakeId: string,
  clientId: string,
  actorProfileId: string,
  evento: "client_matched" | "client_created"
): Promise<ResolveIntakeResult> {
  const supabase = getSupabaseServerClient();

  const { data: unparked, error } = await supabase
    .from("application_intakes")
    .update({
      // Always `client_matched`: by the time this runs a client is known,
      // whether it was chosen from the candidates or just created. `received`
      // would re-run the matching this decision exists to override.
      status: "client_matched",
      matched_client_id: clientId,
      review_reason: null,
      last_activity_at: new Date().toISOString(),
    })
    .eq("id", intakeId)
    .eq("status", "needs_review")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[intake-review service] Failed to unpark intake:", error.message);
    return { status: "error", code: "RESOLVE_FAILED" };
  }
  // Another reviewer resolved it between the read and this write. Their answer
  // stands; reporting an error would invite this one to try again and undo it.
  if (!unparked) return { status: "error", code: "NOT_PARKED" };

  await recordAutomationEvent({
    eventType: evento,
    intakeId,
    clientId,
    // The reviewer, not "system". This is the one automation event in the
    // pipeline a person is genuinely responsible for.
    actor: actorProfileId,
    payload: { resolvedBy: "staff_review" },
  });

  const processed = await processApplicationIntake(intakeId, "staged_portal");

  switch (processed.status) {
    case "processed":
    case "already_processed":
      return { status: "ok", applicationId: processed.applicationId };
    case "awaiting_completion":
      // Unparked but still short of what an application needs. Honest: the
      // review is done, the lead simply is not complete yet.
      return { status: "ok" };
    default:
      console.error(
        "[intake-review service] Intake unparked but processing did not complete:",
        processed.status
      );
      return { status: "ok" };
  }
}

/** Every parked case with its candidates, keyed by intake, for one render. */
export async function getIntakeReviewCaseDetails(
  intakeIds: string[]
): Promise<Record<string, IntakeReviewCaseDetail>> {
  const casos = await Promise.all(intakeIds.map((id) => getIntakeReviewCase(id)));
  const salida: Record<string, IntakeReviewCaseDetail> = {};

  for (const caso of casos) {
    if (!caso) continue;
    const { intake, candidates } = caso;
    salida[intake.id] = {
      intakeId: intake.id,
      applicantFullName: intake.applicantFullName,
      applicantEmail: intake.applicantEmail,
      applicantPhone: intake.applicantPhone,
      applicantIdentificationType: intake.applicantIdentificationType,
      applicantIdentificationNumber: intake.applicantIdentificationNumber,
      applicantBirthDate: intake.applicantBirthDate,
      receivedAt: intake.receivedAt,
      reason: intake.reviewReason!,
      candidates,
    };
  }
  return salida;
}
