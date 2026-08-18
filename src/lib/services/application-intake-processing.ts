import "server-only";
import {
  claimApplicationIntakeForClient,
  claimApplicationIntakeForProcessing,
  completeApplicationIntake,
  getApplicationIntakeById,
  markApplicationIntakeNeedsReview,
} from "./application-intakes";
import { matchClientForIntake } from "./client-matching";
import { createApplication } from "./applications";
import { createClient, findClientByIdentification } from "./clients";
import { getAllProducts } from "./products";
import { recordAutomationEvent } from "./automation-events";
import type { ApplicationIntake, ApplicationIntakeReviewReason, ApplicationSource } from "@/types";

/**
 * The Application Intake pipeline's canonical, channel-neutral
 * orchestrator (Milestone 15B — see the Milestone 15A architecture
 * review's "Proposed Canonical Intake Pipeline" section). This module
 * contains ZERO website-specific, WhatsApp-specific, or email-specific
 * logic — every channel adapter (none exist yet) does nothing more than
 * call createApplicationIntake() and, eventually, this file's
 * processApplicationIntake(). That is the entire contract.
 *
 * ORCHESTRATION, NOT DUPLICATION: this file creates no Client, no
 * Application, no Product, and no Requirement Slot logic of its own — it
 * calls createClient/createApplication/getAllProducts exactly as every
 * other caller in this app does. createClient is only ever called when
 * Client matching finds no existing Client AND every field it requires
 * is present and valid on the intake — see resolveClient()'s doc comment
 * for the exact rule and why a missing field is never fabricated.
 *
 * RESUMABILITY: processApplicationIntake(intakeId) always starts by
 * reloading the intake's current row and branching on its actual status
 * — 'processed'/'needs_review' return immediately (idempotent no-ops),
 * 'received' runs the full pipeline, and 'client_matched' resumes
 * directly at Application-creation. A caller may safely call this
 * function again for the same intakeId after any failure, including a
 * process crash mid-pipeline.
 *
 * CONCURRENCY: two guarded, atomic UPDATEs on application_intakes are
 * the only synchronization primitive this pipeline uses — no new
 * Postgres RPC, no advisory locks (which would not survive across the
 * separate stateless PostgREST calls this service layer makes anyway).
 *   1. received -> client_matched (claimApplicationIntakeForClient)
 *   2. client_matched -> "claimed for processing" (claimApplicationIntakeForProcessing)
 * See 20260811000300_add_processing_claim_to_application_intakes.sql for
 * why guard 1 alone is not sufficient and guard 2 exists.
 */

export type ProcessApplicationIntakeResult =
  | { status: "processed"; applicationId: string }
  | { status: "already_processed"; applicationId: string }
  | { status: "needs_review"; reason: ApplicationIntakeReviewReason }
  | { status: "concurrent_processing" }
  | { status: "error"; code: "INTAKE_NOT_FOUND" | "PROCESSING_FAILED" };

type ProcessingAttemptResult = ProcessApplicationIntakeResult | { status: "retry" };

// Deliberately an explicit table, not a pass-through cast, even though
// it is an identity mapping today — Application.createdSource and
// ApplicationIntake.channel were deliberately unified onto the exact
// same ApplicationSource vocabulary (Milestone 15B brief, section 1),
// so there is currently nothing to translate. If either vocabulary ever
// diverges, this is the one place that needs to change.
const INTAKE_CHANNEL_TO_APPLICATION_SOURCE: Record<ApplicationSource, ApplicationSource> = {
  crm_manual: "crm_manual",
  website_form: "website_form",
  whatsapp: "whatsapp",
  email: "email",
  ai: "ai",
};

/**
 * Orchestrates one intake from its current status through to
 * 'processed' or 'needs_review'. See this module's doc comment for the
 * resumability and concurrency contract.
 */
export async function processApplicationIntake(intakeId: string): Promise<ProcessApplicationIntakeResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await runProcessingAttempt(intakeId);
    if (result.status !== "retry") {
      return result;
    }
  }
  throw new Error(
    `Intake ${intakeId} could not converge after a concurrent client-matching transition — call ` +
      "processApplicationIntake again."
  );
}

async function runProcessingAttempt(intakeId: string): Promise<ProcessingAttemptResult> {
  const loaded = await getApplicationIntakeById(intakeId);
  if (loaded.status === "error") {
    if (loaded.code === "NOT_FOUND") {
      return { status: "error", code: "INTAKE_NOT_FOUND" };
    }
    throw new Error(`Failed to load intake ${intakeId}: ${loaded.code}`);
  }
  const intake = loaded.intake;

  if (intake.status === "processed") {
    return { status: "already_processed", applicationId: intake.createdApplicationId! };
  }
  if (intake.status === "needs_review") {
    return { status: "needs_review", reason: intake.reviewReason! };
  }

  if (intake.status === "received") {
    const clientResolution = await resolveClient(intake);
    if (clientResolution.outcome === "needs_review") {
      return routeToNeedsReview(intakeId, clientResolution.reason);
    }

    const claimedForClient = await claimApplicationIntakeForClient(intakeId, clientResolution.clientId);
    if (claimedForClient.status === "error") {
      if (claimedForClient.code === "NOT_FOUND") {
        return { status: "error", code: "INTAKE_NOT_FOUND" };
      }
      if (claimedForClient.code === "ALREADY_CLAIMED") {
        // A concurrent attempt already resolved Client matching for this
        // exact intake first. By the time we retry, that transition has
        // already committed — reloading resolves the ambiguity in one
        // more attempt, unlike losing the processing claim below.
        return { status: "retry" };
      }
      throw new Error(
        `Failed to claim intake ${intakeId} for client ${clientResolution.clientId}: ${claimedForClient.code}`
      );
    }

    // "matched" vs "created" are mutually exclusive facts about how this
    // Client id was resolved — client_created fires only when this
    // pipeline actually inserted a new Client row; an existing Client
    // that was merely matched (including the post-race re-match in
    // resolveClientAfterDuplicateRace) always reports client_matched,
    // never both.
    await recordAutomationEvent({
      eventType: clientResolution.wasCreated ? "client_created" : "client_matched",
      intakeId,
      clientId: clientResolution.clientId,
      payload: {},
      actor: "system",
    });

    return runApplicationCreationStep(claimedForClient.intake);
  }

  // intake.status === "client_matched" — resume directly at Application
  // creation. This is reached both by the same call continuing on
  // (immediately above) and by an independent later call picking this
  // row back up after a prior attempt failed between the two steps.
  return runApplicationCreationStep(intake);
}

type ClientResolution =
  | { outcome: "resolved"; clientId: string; wasCreated: boolean }
  | { outcome: "needs_review"; reason: ApplicationIntakeReviewReason };

/**
 * Resolves which real Client this intake belongs to — see
 * client-matching.ts for the deterministic Cases A–E this delegates to.
 * A "matched" outcome resolves directly to that Client; a
 * "new_client_candidate" outcome (Case E — no identification/email/phone
 * match anywhere) is handed to createClientFromIntake below, which may
 * either create a real Client or, if the intake is missing anything
 * createClient requires, route to needs_review.
 */
async function resolveClient(intake: ApplicationIntake): Promise<ClientResolution> {
  const matchResult = await matchClientForIntake(intake);
  if (matchResult.status === "error") {
    throw new Error(`Client matching failed for intake ${intake.id}`);
  }

  if (matchResult.match.outcome === "matched") {
    return { outcome: "resolved", clientId: matchResult.match.clientId, wasCreated: false };
  }
  if (matchResult.match.outcome === "needs_review") {
    return { outcome: "needs_review", reason: matchResult.match.reason };
  }

  return createClientFromIntake(intake);
}

/**
 * Creates a new Client from an intake that Client matching found no
 * existing Client for (Milestone 15B correction, section 4/12).
 * createClient() requires fullName, identificationType,
 * identificationNumber, phone, email, position, nationality, address,
 * monthlySalary, and birthDate (see CreateClientInput in clients.ts) —
 * this function checks every one of those is present and non-empty on
 * the intake before ever calling createClient, and routes to
 * needs_review(insufficient_client_data) otherwise. Nothing is ever
 * fabricated to fill a gap, and no partial Client is ever created (see
 * Milestone 15B correction, section 5).
 *
 * MILESTONE 23: intake.employerName is now carried straight onto the
 * Client as employer_name. It always WAS captured on the intake row and
 * then discarded here, because the only employer field a Client had was
 * company_legacy_id — a code into a static list of ten fabricated
 * companies, which no website submission could ever legitimately produce.
 * Free-text employer removed that mismatch: the applicant typed a name,
 * and the name is what gets stored. Nothing is mapped, matched or guessed
 * at, so the Milestone 15B correction's rule (section 2) still holds —
 * this is now a pass-through, not an inference.
 *
 * Employer stays OPTIONAL and is deliberately absent from the required-
 * field check below: a submission without one still creates a Client.
 *
 * source is the intake's own channel, passed straight through as
 * Client.createdSource — the same unified ApplicationSource vocabulary
 * both already share (see clients_created_source_check, which already
 * allows all five values). actorProfileId is always null: no automated
 * channel is ever a human CRM actor, matching every other automated
 * write in this pipeline (Milestone 15B correction, section 7).
 */
async function createClientFromIntake(intake: ApplicationIntake): Promise<ClientResolution> {
  const hasAllRequiredFields =
    Boolean(intake.applicantFullName?.trim()) &&
    Boolean(intake.applicantIdentificationType) &&
    Boolean(intake.applicantIdentificationNumber?.trim()) &&
    Boolean(intake.applicantPhone?.trim()) &&
    Boolean(intake.applicantEmail?.trim()) &&
    Boolean(intake.applicantPosition?.trim()) &&
    Boolean(intake.applicantNationality?.trim()) &&
    Boolean(intake.applicantAddress?.trim()) &&
    Boolean(intake.applicantBirthDate) &&
    intake.monthlySalary !== undefined &&
    intake.monthlySalary >= 0;

  if (!hasAllRequiredFields) {
    return { outcome: "needs_review", reason: "insufficient_client_data" };
  }

  const createResult = await createClient({
    fullName: intake.applicantFullName!,
    identificationType: intake.applicantIdentificationType!,
    identificationNumber: intake.applicantIdentificationNumber!,
    phone: intake.applicantPhone!,
    email: intake.applicantEmail!,
    position: intake.applicantPosition!,
    monthlySalary: intake.monthlySalary!,
    birthDate: intake.applicantBirthDate!,
    nationality: intake.applicantNationality!,
    address: intake.applicantAddress!,
    employerName: intake.employerName,
    source: intake.channel,
    actorProfileId: null,
  });

  if (createResult.status === "ok") {
    return { outcome: "resolved", clientId: createResult.client.id, wasCreated: true };
  }

  if (createResult.code === "DUPLICATE_IDENTIFICATION") {
    return resolveClientAfterDuplicateRace(intake);
  }

  throw new Error(`Failed to create client for intake ${intake.id}: ${createResult.code}`);
}

/**
 * Handles createClientFromIntake's DUPLICATE_IDENTIFICATION result
 * (Milestone 15B correction, section 6): another process created a
 * Client with this exact (identification_type, identification_number)
 * between this pipeline's own Client-matching read and its insert
 * attempt. Never creates a second Client for the same identification —
 * clients_identification_type_number_key (the real DB uniqueness
 * constraint) is left untouched and fully authoritative. Instead,
 * re-runs the same authoritative identification lookup Client matching
 * itself relies on; since that constraint guarantees at most one row can
 * ever match, finding one here is by construction unambiguous and safe
 * to use. The only way this can still fail to resolve is a genuinely
 * anomalous state (createClient just reported a collision on this exact
 * identification, yet a fresh lookup finds nothing) — not safe to guess
 * through, so it routes to needs_review rather than retrying indefinitely.
 */
async function resolveClientAfterDuplicateRace(intake: ApplicationIntake): Promise<ClientResolution> {
  const lookup = await findClientByIdentification(
    intake.applicantIdentificationType!,
    intake.applicantIdentificationNumber!
  );
  if (lookup.status === "error") {
    throw new Error(
      `Failed to re-resolve client identification for intake ${intake.id} after a duplicate-identification race`
    );
  }
  if (lookup.client) {
    return { outcome: "resolved", clientId: lookup.client.id, wasCreated: false };
  }

  return { outcome: "needs_review", reason: "conflicting_client_identity" };
}

/**
 * Resumable from either a fresh Client match or an intake already
 * sitting at 'client_matched'. Always claims the processing guard first
 * — see claimApplicationIntakeForProcessing's doc comment for why this
 * is required before any Application is created, not merely before the
 * final status write.
 */
async function runApplicationCreationStep(intake: ApplicationIntake): Promise<ProcessApplicationIntakeResult> {
  const claimedForProcessing = await claimApplicationIntakeForProcessing(intake.id);
  if (claimedForProcessing.status === "error") {
    if (claimedForProcessing.code === "NOT_FOUND") {
      return { status: "error", code: "INTAKE_NOT_FOUND" };
    }
    if (claimedForProcessing.code === "ALREADY_CLAIMED") {
      return reportStateAfterLostClaim(intake.id);
    }
    throw new Error(`Failed to claim intake ${intake.id} for processing: ${claimedForProcessing.code}`);
  }

  const claimedIntake = claimedForProcessing.intake;

  if (!claimedIntake.requestedProductCode) {
    return routeToNeedsReview(intake.id, "missing_product_code");
  }
  if (!(claimedIntake.requestedAmount && claimedIntake.requestedAmount > 0)) {
    return routeToNeedsReview(intake.id, "missing_requested_amount");
  }
  if (!(claimedIntake.requestedTermMonths && claimedIntake.requestedTermMonths > 0)) {
    return routeToNeedsReview(intake.id, "missing_requested_term_months");
  }

  const productsResult = await getAllProducts();
  if (productsResult.status === "error") {
    throw new Error(`Failed to load products while processing intake ${intake.id}`);
  }
  const product = productsResult.products.find((p) => p.code === claimedIntake.requestedProductCode);
  if (!product) {
    return routeToNeedsReview(intake.id, "product_not_found");
  }
  if (product.status !== "active") {
    return routeToNeedsReview(intake.id, "product_inactive");
  }

  const createResult = await createApplication({
    clientId: claimedIntake.matchedClientId!,
    productId: product.id,
    requestedAmount: claimedIntake.requestedAmount,
    requestedTermMonths: claimedIntake.requestedTermMonths,
    source: INTAKE_CHANNEL_TO_APPLICATION_SOURCE[claimedIntake.channel],
    actorProfileId: null,
  });

  if (createResult.status === "error") {
    throw new Error(`Failed to create application for intake ${intake.id}: ${createResult.code}`);
  }
  if (createResult.status === "partial") {
    console.error(
      `[application-intake-processing] Application ${createResult.application.id} created for intake ${intake.id} ` +
        "but its requirement slot snapshot failed — safe to retry createRequirementSlotsForApplication directly " +
        "with this application id."
    );
  }

  const application = createResult.application;

  await recordAutomationEvent({
    eventType: "application_created",
    intakeId: intake.id,
    clientId: claimedIntake.matchedClientId!,
    applicationId: application.id,
    payload: {},
    actor: "system",
  });

  const completed = await completeApplicationIntake(intake.id, application.id);
  if (completed.status === "error") {
    // The processing claim held above guarantees no other attempt could
    // have reached this same point concurrently — an INVALID_TRANSITION
    // here would mean this row's state changed through some path outside
    // this pipeline's own guards, which is a genuine anomaly, not a race
    // to retry through (retrying could create a second Application).
    throw new Error(
      `Failed to complete intake ${intake.id} after creating application ${application.id}: ${completed.code}`
    );
  }

  return { status: "processed", applicationId: application.id };
}

/**
 * Called when claimApplicationIntakeForProcessing reports ALREADY_CLAIMED
 * — either another attempt is mid-flight right now, or a prior attempt
 * already finished. Reloads the row and reports whichever is actually
 * true instead of guessing.
 */
async function reportStateAfterLostClaim(intakeId: string): Promise<ProcessApplicationIntakeResult> {
  const reloaded = await getApplicationIntakeById(intakeId);
  if (reloaded.status === "error") {
    throw new Error(`Failed to reload intake ${intakeId} after losing the processing claim: ${reloaded.code}`);
  }
  if (reloaded.intake.status === "processed") {
    return { status: "already_processed", applicationId: reloaded.intake.createdApplicationId! };
  }
  if (reloaded.intake.status === "needs_review") {
    return { status: "needs_review", reason: reloaded.intake.reviewReason! };
  }
  // Still client_matched: another attempt currently holds the claim and
  // has not finished yet. Do not spin waiting for it — report plainly so
  // the caller can decide whether to try again later.
  return { status: "concurrent_processing" };
}

/**
 * Records an intake_needs_review automation event, then transitions the
 * intake via markApplicationIntakeNeedsReview — shared by every
 * business-level failure path above (Client matching, missing Product,
 * missing amount/term, unresolvable Product).
 */
async function routeToNeedsReview(
  intakeId: string,
  reason: ApplicationIntakeReviewReason
): Promise<ProcessApplicationIntakeResult> {
  await recordAutomationEvent({
    eventType: "intake_needs_review",
    intakeId,
    payload: { reason },
    actor: "system",
  });

  const marked = await markApplicationIntakeNeedsReview(intakeId, reason);
  if (marked.status === "ok") {
    return { status: "needs_review", reason };
  }
  if (marked.code === "NOT_FOUND") {
    return { status: "error", code: "INTAKE_NOT_FOUND" };
  }
  if (marked.code === "ALREADY_TERMINAL") {
    // A concurrent attempt already moved this intake to its own terminal
    // state first — report what actually happened, not what this call
    // attempted.
    return reportStateAfterLostClaim(intakeId);
  }
  throw new Error(`Failed to mark intake ${intakeId} as needs_review (${reason}): ${marked.code}`);
}
