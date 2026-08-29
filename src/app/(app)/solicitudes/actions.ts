"use server";

import { revalidatePath } from "next/cache";

import {
  assignApplicationAdvisor,
  createApplication,
  getApplicationById,
  setApplicationStatus,
} from "@/lib/services/applications";
import { canCreateUnassignedEntity } from "@/lib/services/branch-scope-query";
import {
  getApplicationTransferContext,
  transferApplicationBranch,
} from "@/lib/services/branch-transfers";
import { getApplicationCreatableProducts } from "@/lib/services/products";
import { getClientById } from "@/lib/services/clients";
import { requireCapability } from "@/lib/auth/authorize";
import {
  completeFollowUpAction,
  getFollowUpsByApplicationId,
  logFollowUp,
} from "@/lib/services/follow-ups";
import { CONTACT_METHODS, CONTACT_OUTCOMES } from "@/lib/config/follow-up";
import { APPLICATION_STATUS_TRANSITIONABLE } from "@/lib/config/application";
import {
  addReviewObservation,
  completeReview,
  getApplicationReview,
  reopenReview,
  setReviewItemState,
  setReviewRecommendation,
  type ApplicationReviewView,
  type CompletionBlocker,
} from "@/lib/services/application-review";
import {
  recommendationRequiresNote,
  REVIEW_ITEM_STATES,
  REVIEW_OBSERVATION_CATEGORIES,
  REVIEW_RECOMMENDATIONS,
  type ReviewItemState,
  type ReviewObservationCategory,
  type ReviewRecommendation,
} from "@/lib/config/application-review";
import type {
  Application,
  BranchScope,
  ApplicationFollowUp,
  ApplicationStatus,
  ContactMethod,
  ContactOutcome,
} from "@/types";

/**
 * Thin Server Action wrapper around src/lib/services/applications.ts,
 * matching the same shape as every other Server Action in this app
 * (src/app/(app)/expedientes/actions.ts's setDossierRequirementSlotStatus
 * is the closest precedent): validates input, authenticates the caller,
 * delegates to the service, maps the outcome to a safe, client-facing
 * result. Milestone 13C — see the Milestone 13A architecture review and
 * its final validation.
 *
 * Only the mutations this app's UI actually needs. No read action — the
 * initial Solicitudes list load (and, as of Milestone 17, the client and
 * creatable-product lists the creation dialog needs) are direct Server
 * Component -> service calls (src/app/(app)/solicitudes/page.tsx,
 * src/app/(app)/clientes/page.tsx), per the Milestone 13A validation's
 * "Read Server Action" question; one is added later only if a genuine
 * client-triggered refetch need appears.
 *
 * MILESTONE 17 adds createSolicitudApplication — the CRM's manual
 * application-origination entry point, and the second caller of
 * src/lib/services/applications.ts#createApplication after the Application
 * Intake pipeline. Both routes converge on that one unmodified service, so
 * a manually-filed application and a website-filed one are byte-identical
 * in how they are created and how their Requirement Slots are snapshotted.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export interface SetSolicitudApplicationStatusInput {
  applicationId: string;
  status: ApplicationStatus;
}

export type SetSolicitudApplicationStatusResult =
  | { status: "success"; application: Application }
  | {
      status: "error";
      code:
        | "INVALID_INPUT"
        | "UNAUTHENTICATED"
        | "FORBIDDEN"
        | "INVALID_ACTOR"
        | "NOT_FOUND"
        | "INVALID_TRANSITION"
        | "UPDATE_FAILED";
    };

/**
 * Never accepts statusChangedByProfileId from the client — always the
 * caller's own getCurrentProfile(), and source is hardcoded to
 * 'crm_manual', since this action is reachable only from an authenticated
 * CRM session, matching every other manual status-change action in this
 * app.
 *
 * Legality of the specific from-state -> to-state transition is enforced
 * server-side by setApplicationStatus itself (APPLICATION_STATUS_
 * TRANSITIONS) — never duplicated here. The check in this action is only
 * "is this a status a staff member may ever deliberately target at all"
 * (APPLICATION_STATUS_TRANSITIONABLE excludes 'new', which is never a
 * legal target from any state), so a request for an always-illegal target
 * returns a clear INVALID_INPUT before the service is even called; a
 * request that's illegal only from the application's CURRENT state (e.g.
 * a stale client trying to move an already-approved application) reaches
 * the service and comes back as INVALID_TRANSITION instead.
 *
 * Milestone 16 — capability `application:set_status`, held only by
 * administrador and gerente. This action's legal targets
 * (APPLICATION_STATUS_TRANSITIONABLE) include `approved` and
 * `not_eligible`, i.e. the lending determination itself, and there is no
 * per-target granularity to grant a lesser role only the harmless moves.
 * Until this action is split by target status, the whole capability is
 * therefore held at the level the most consequential target demands. See
 * the Milestone 16 report's ambiguity notes.
 */
export async function setSolicitudApplicationStatus(
  input: SetSolicitudApplicationStatusInput
): Promise<SetSolicitudApplicationStatusResult> {
  const auth = await requireCapability("application:set_status");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(input.applicationId) || !UUID_PATTERN.test(input.applicationId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!(APPLICATION_STATUS_TRANSITIONABLE as string[]).includes(input.status)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  // MILESTONE 25B-2 — the application is re-read through the caller's own
  // effective branch scope, so an id naming an application in another branch
  // resolves to nothing. NOT_FOUND is the service's existing code for an
  // unknown application, so out-of-scope and nonexistent are indistinguishable.
  // record_application_status_change repeats this check inside the write's own
  // transaction; this layer exists for the error contract, that one for the
  // boundary.
  const targetResult = await getApplicationById(auth.profile.branchScope, input.applicationId);
  if (targetResult.status !== "ok") {
    return { status: "error", code: "NOT_FOUND" };
  }

  const result = await setApplicationStatus(
    input.applicationId,
    input.status,
    "crm_manual",
    auth.profile.id
  );
  if (result.status !== "ok") {
    return { status: "error", code: result.code };
  }

  return { status: "success", application: result.application };
}

/** Hard ceiling mirroring applications_requested_term_months_check — the
 * database constraint stays authoritative; this re-states it so a bad
 * value returns INVALID_INPUT instead of a raw constraint violation, the
 * same posture createApplication() itself already takes. */
const MAX_TERM_MONTHS = 360;

export interface CreateSolicitudApplicationInput {
  clientId: string;
  productId: string;
  requestedAmount: number;
  requestedTermMonths: number;
}

export type CreateSolicitudApplicationResult =
  | { status: "success"; application: Application }
  /** The application EXISTS and is valid, but its Requirement Slot
   * snapshot failed — surfaced distinctly, never folded into "success".
   * See this action's doc comment. */
  | { status: "partial"; application: Application; code: "SLOT_SNAPSHOT_FAILED" }
  | {
      status: "error";
      code:
        | "INVALID_INPUT"
        | "UNAUTHENTICATED"
        | "FORBIDDEN"
        | "CLIENT_NOT_FOUND"
        | "PRODUCT_NOT_AVAILABLE"
        | "INVALID_ACTOR"
        | "CREATE_FAILED";
    };

/**
 * Creates a real Application from inside the CRM (Milestone 17) — the
 * single Server Action behind BOTH entry points (Solicitudes' "Nueva
 * solicitud" and the Clientes row action). There is no second
 * implementation of this anywhere.
 *
 * DELEGATES, NEVER DUPLICATES: the actual insert, and the Requirement Slot
 * snapshot that must accompany it, are done entirely by
 * src/lib/services/applications.ts#createApplication, which is UNMODIFIED
 * by this milestone and shared with the Application Intake pipeline. This
 * action therefore never touches `requirement_slots`, never generates an
 * application_number (a column default), never sets `status` or
 * `status_changed_at` (the 'new' default, guarded by
 * applications_status_new_pair_check), and never assigns an advisor
 * (Milestone 17 decision P4 — assigned_advisor_profile_id stays NULL).
 *
 * ORDERING (Milestone 16 rule): requireCapability() is the FIRST
 * statement — before input validation, before the client lookup, before
 * the product lookup. An unauthorized caller must not be able to tell
 * CLIENT_NOT_FOUND from PRODUCT_NOT_AVAILABLE from INVALID_INPUT and use
 * this action to probe for records they may not touch.
 *
 * PRODUCT ELIGIBILITY IS RE-CHECKED SERVER-SIDE, deliberately against the
 * exact same getApplicationCreatableProducts() the UI renders from — not a
 * looser "is it active" check. A hand-crafted request naming an inactive
 * product, a draft product, or an active product with zero active
 * requirement templates gets PRODUCT_NOT_AVAILABLE and creates nothing.
 * Client-side filtering is a convenience; this is the enforcement.
 *
 * PARTIAL RESULT: createApplication may return "partial" when the slot
 * snapshot fails after the application row committed. This action passes
 * that through as its own distinct "partial" status rather than reporting
 * success. It performs NO destructive rollback — this schema never hard-
 * deletes, and the existing recovery path (re-running
 * createRequirementSlotsForApplication, whose upsert is idempotent) stays
 * available. Note this is now unreachable through normal use, since a
 * product with zero active templates cannot be selected in the first
 * place; it remains handled because a template can be deactivated between
 * the page render and the submit.
 */
export async function createSolicitudApplication(
  input: CreateSolicitudApplicationInput
): Promise<CreateSolicitudApplicationResult> {
  const auth = await requireCapability("application:create");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(input.clientId) || !UUID_PATTERN.test(input.clientId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!isNonEmptyString(input.productId) || !UUID_PATTERN.test(input.productId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!Number.isFinite(input.requestedAmount) || input.requestedAmount <= 0) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (
    !Number.isInteger(input.requestedTermMonths) ||
    input.requestedTermMonths < 1 ||
    input.requestedTermMonths > MAX_TERM_MONTHS
  ) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const clientResult = await getClientById(auth.profile.branchScope, input.clientId);
  if (clientResult.status !== "ok") {
    return { status: "error", code: "CLIENT_NOT_FOUND" };
  }

  // MILESTONE 25B-2 — createApplication() writes no branch_id, so the new
  // application is UNASSIGNED regardless of which branch its client sits in.
  // A branch-scoped creator would therefore lose the file the moment it was
  // created. Same rule and same reasoning as createClientAction; 25C lifts it
  // by supplying a real branch context. FORBIDDEN describes the caller and
  // reveals nothing about the client, which was already proven in scope above.
  if (!canCreateUnassignedEntity(auth.profile.branchScope)) {
    return { status: "error", code: "FORBIDDEN" };
  }

  const productsResult = await getApplicationCreatableProducts();
  if (productsResult.status === "error") {
    return { status: "error", code: "CREATE_FAILED" };
  }
  if (!productsResult.products.some((product) => product.id === input.productId)) {
    // Covers all three rejection cases at once — inactive, draft, and
    // "active but has no active requirement template" — because it asks
    // the same single question the UI asked. Deliberately one opaque code:
    // the caller is not told WHICH condition failed.
    return { status: "error", code: "PRODUCT_NOT_AVAILABLE" };
  }

  const result = await createApplication({
    clientId: input.clientId,
    productId: input.productId,
    requestedAmount: input.requestedAmount,
    requestedTermMonths: input.requestedTermMonths,
    source: "crm_manual",
    actorProfileId: auth.profile.id,
    // MILESTONE 26B-23A — OPENING A FORM IS NOT RECEIVING AN APPLICATION.
    //
    // This said "formal", on the reasoning that staff filling this in ARE
    // receiving the application. That is true at the END of the task and wrong
    // at the start: the dialog asks for a client, a product and an amount, and
    // then the person still has to gather documents that may take days to
    // arrive. Numbering at that first click spent an official consecutive on
    // work barely begun, and an abandoned dialog burned a number ODL can never
    // reuse — the numbers are consecutive, so a gap is permanent and visible.
    //
    // A draft holds exactly the same requirement slots and accepts exactly the
    // same documents; the only thing it lacks is the number, which is the one
    // thing that should wait. 26B-23B adds the explicit "Formalizar solicitud"
    // that allocates it through the same `submit_application` the portal uses.
    lifecycle: "draft",
  });

  if (result.status === "error") {
    const code = result.code === "INSERT_FAILED" ? "CREATE_FAILED" : result.code;
    return { status: "error", code };
  }
  if (result.status === "partial") {
    return { status: "partial", application: result.application, code: result.code };
  }

  return { status: "success", application: result.application };
}

export interface AssignSolicitudAdvisorInput {
  applicationId: string;
  /** `profiles.id`, or null to UNASSIGN. Null is a legitimate value, not a
   * missing one — see this action's doc comment. */
  advisorProfileId: string | null;
}

export type AssignSolicitudAdvisorResult =
  | { status: "success"; application: Application }
  | {
      status: "error";
      code:
        | "INVALID_INPUT"
        | "UNAUTHENTICATED"
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "INVALID_ADVISOR"
        | "UPDATE_FAILED";
    };

/**
 * Assigns, reassigns or unassigns the advisor who owns an application
 * (Milestone 23) — the first caller assignApplicationAdvisor has ever had.
 *
 * CAPABILITY: `application:assign_advisor`, held by administrador and gerente.
 * Deliberately NOT `application:set_status` — see that capability's note in
 * src/lib/auth/capabilities.ts for why deciding WHO WORKS a file must be able
 * to move independently of the lending determination.
 *
 * ORDERING (Milestone 16 rule): requireCapability() is the FIRST statement,
 * before input validation and before the service call, so an unauthorized
 * caller cannot use the difference between NOT_FOUND and INVALID_ADVISOR to
 * probe for records or staff they may not see.
 *
 * NULL IS AN ACCEPTED VALUE, NOT AN OMISSION. Unassigning is a real operation
 * the column has always permitted, so `advisorProfileId: null` is validated as
 * legitimate input rather than rejected as missing. Anything that is neither
 * null nor a well-formed UUID is INVALID_INPUT.
 *
 * ELIGIBILITY IS ENFORCED IN THE DATABASE, not here. The RPC refuses a
 * nonexistent or deactivated profile and the service maps that to
 * INVALID_ADVISOR. This action deliberately does not re-implement that check:
 * the UI's option list is a convenience, the function's guard is the
 * enforcement, and duplicating it here would create a second rule to keep in
 * sync.
 *
 * AUDIT: the mutation and its `application_advisor_assigned` event are written
 * atomically inside record_application_advisor_assignment. A no-op
 * reassignment succeeds and writes no event.
 */
export async function assignSolicitudAdvisor(
  input: AssignSolicitudAdvisorInput
): Promise<AssignSolicitudAdvisorResult> {
  const auth = await requireCapability("application:assign_advisor");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(input.applicationId) || !UUID_PATTERN.test(input.applicationId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (input.advisorProfileId !== null) {
    if (!isNonEmptyString(input.advisorProfileId) || !UUID_PATTERN.test(input.advisorProfileId)) {
      return { status: "error", code: "INVALID_INPUT" };
    }
  }

  // ==========================================================================
  // MILESTONE 25B-2 — TWO INDEPENDENT QUESTIONS, ONLY ONE OF THEM ASKED HERE
  // ==========================================================================
  //
  // (A) MAY THIS CALLER OPERATE ON THIS APPLICATION? That is the caller's own
  //     effective branch scope, checked right here. A gerente holding
  //     `application:assign_advisor` may still only assign inside their own
  //     branches: a delegated capability says WHAT you may do, never WHERE.
  //
  // (B) IS THIS ADVISOR ELIGIBLE FOR THIS APPLICATION? That is the ADVISOR's
  //     own role, active flag, auth link and branch reach — never the caller's
  //     — and it is deliberately NOT re-implemented here. It lives in
  //     record_application_advisor_assignment, with the directory in
  //     getAssignableAdvisorsForApplications() offering exactly the same set.
  //     Duplicating it in this file would create a second rule to keep in sync.
  const targetResult = await getApplicationById(auth.profile.branchScope, input.applicationId);
  if (targetResult.status !== "ok") {
    return { status: "error", code: "NOT_FOUND" };
  }

  const result = await assignApplicationAdvisor(
    input.applicationId,
    input.advisorProfileId,
    auth.profile.id
  );
  if (result.status !== "ok") {
    return { status: "error", code: result.code };
  }

  return { status: "success", application: result.application };
}

// ============================================================================
// transferApplicationBranchAction (Milestone 25B-3)
// ============================================================================

export interface TransferApplicationBranchActionInput {
  applicationId: string;
  destinationBranchId: string;
}

export type TransferApplicationBranchActionResult =
  | {
      status: "success";
      application: Application;
      /** True when the move made the assigned advisor ineligible and the
       * database cleared them. The UI surfaces this so the manager learns the
       * file now has no owner — silently dropping an assignment would be worse
       * than the reassignment it forces. */
      advisorCleared: boolean;
    }
  | {
      status: "error";
      code:
        | "INVALID_INPUT"
        | "UNAUTHENTICATED"
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "INVALID_DESTINATION"
        | "TRANSFER_FAILED";
    };

/**
 * Moves an application to another branch (Milestone 25B-3).
 *
 * CAPABILITY: `branch:transfer`. As with the client transfer, delegating it
 * grants the ACTION and never the REACH — the database requires the caller's
 * own effective scope to cover BOTH the source and the destination, so a
 * gerente moves files only between branches they already hold, and only an
 * administrador (national by role) can route an unassigned application.
 *
 * THE ADVISOR MAY BE CLEARED BY THIS CALL. An advisor whose own branch reach
 * does not cover the destination is unassigned atomically with the move,
 * because an application owned by somebody who cannot open it is a broken
 * invariant rather than a valid state. No replacement is chosen automatically.
 * `advisorCleared` reports it by comparing the assignment before and after —
 * the database is the one that decides, this only observes the outcome.
 *
 * THE CLIENT DOES NOT MOVE. Application and client ownership are independent
 * facts; transferring a file never silently relocates the person.
 */
export async function transferApplicationBranchAction(
  input: TransferApplicationBranchActionInput
): Promise<TransferApplicationBranchActionResult> {
  const auth = await requireCapability("branch:transfer");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(input.applicationId) || !UUID_PATTERN.test(input.applicationId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (
    !isNonEmptyString(input.destinationBranchId) ||
    !UUID_PATTERN.test(input.destinationBranchId)
  ) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  // Read the current assignment BEFORE the move, through the caller's own
  // scope, so `advisorCleared` can be reported truthfully. Out of scope stops
  // here with the same NOT_FOUND a nonexistent id produces.
  const before = await getApplicationById(auth.profile.branchScope, input.applicationId);
  if (before.status !== "ok") {
    return { status: "error", code: "NOT_FOUND" };
  }
  const advisorBefore = before.application.assignedAdvisorProfileId;

  const result = await transferApplicationBranch(
    auth.profile.branchScope,
    input.applicationId,
    input.destinationBranchId,
    auth.profile.id
  );

  if (result.status !== "ok") {
    return { status: "error", code: result.code };
  }

  return {
    status: "success",
    application: result.application,
    advisorCleared:
      advisorBefore !== undefined && result.application.assignedAdvisorProfileId === undefined,
  };
}

export type GetApplicationTransferOptionsActionResult =
  | { status: "success"; currentBranchName: string | null; destinations: { id: string; name: string }[] }
  | { status: "error"; code: "INVALID_INPUT" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" };

/** Transfer dialog context for one application (25B-3). Guarded by the same
 * capability as the transfer — see the client equivalent. */
export async function getApplicationTransferOptionsAction(
  applicationId: string
): Promise<GetApplicationTransferOptionsActionResult> {
  const auth = await requireCapability("branch:transfer");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }
  if (!isNonEmptyString(applicationId) || !UUID_PATTERN.test(applicationId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const result = await getApplicationTransferContext(auth.profile.branchScope, applicationId);
  if (result.status !== "ok") {
    return { status: "error", code: "NOT_FOUND" };
  }
  return {
    status: "success",
    currentBranchName: result.context.currentBranchName,
    destinations: result.context.destinations,
  };
}

// ============================================================================
// FOLLOW-UP ACTIONS (Milestone 26B-6)
// ============================================================================
//
// The operational layer: recording what ODL did about a customer, and what it
// promised to do next.
//
// CAPABILITY: `note:create`, reused deliberately rather than invented. Logging
// a call is the same class of act as writing an internal note — collaborative
// dossier work — and it is held by administrador, gerente, compliance AND asesor,
// which is exactly the set who must be able to record their own calls. Adding a
// `follow_up:create` capability would have produced a second permission with
// the same holders and the same meaning.
//
// Assignment keeps `application:assign_advisor` (administrador, gerente) and is
// entirely unchanged: deciding WHO OWNS a file is a supervisory act, deciding
// what happened on a phone call is not.
//
// ORDERING, as everywhere else: requireCapability() first, before validation
// and before any read, so an unauthorized caller cannot use the difference
// between NOT_FOUND and INVALID_INPUT to probe for processes they cannot see.
//
// NOTHING HERE SENDS ANYTHING. These record outward contact a human already
// made by phone, WhatsApp or email.

export interface LogFollowUpActionInput {
  applicationId: string;
  contactMethod: ContactMethod;
  outcome: ContactOutcome;
  note?: string;
  nextAction?: string;
  /** ISO instant. Both this and nextAction, or neither. */
  nextActionAt?: string;
}

export type LogFollowUpActionResult =
  | { status: "success"; followUp: ApplicationFollowUp }
  | {
      status: "error";
      code: "UNAUTHENTICATED" | "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND" | "SAVE_FAILED";
    };

export async function logFollowUpAction(
  input: LogFollowUpActionInput
): Promise<LogFollowUpActionResult> {
  const auth = await requireCapability("note:create");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(input.applicationId) || !UUID_PATTERN.test(input.applicationId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!CONTACT_METHODS.includes(input.contactMethod)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!CONTACT_OUTCOMES.includes(input.outcome)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  // MAY THIS CALLER OPERATE ON THIS PROCESS? The caller's own effective branch
  // scope, checked here against the owning application. A capability says WHAT
  // you may do, never WHERE — so holding note:create does not let an advisor
  // log calls against another branch's prospects.
  //
  // Deliberately NOT filtered to formal applications: the whole point of 26B-6
  // is working a lead before it is submitted, and a draft is a real process.
  const target = await getApplicationById(auth.profile.branchScope, input.applicationId);
  if (target.status !== "ok") {
    return { status: "error", code: "NOT_FOUND" };
  }

  const result = await logFollowUp({
    applicationId: input.applicationId,
    authorProfileId: auth.profile.id,
    contactMethod: input.contactMethod,
    outcome: input.outcome,
    note: input.note,
    nextAction: input.nextAction,
    nextActionAt: input.nextActionAt,
  });

  if (result.status !== "ok") {
    return {
      status: "error",
      code: result.code === "INVALID_INPUT" ? "INVALID_INPUT" : "SAVE_FAILED",
    };
  }

  return { status: "success", followUp: result.followUp };
}

export type CompleteFollowUpActionResultShape =
  | { status: "success"; followUp: ApplicationFollowUp }
  | {
      status: "error";
      code: "UNAUTHENTICATED" | "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND" | "SAVE_FAILED";
    };

/**
 * Mark a promised action done.
 *
 * The application id travels with the request so the branch check has something
 * to check: a follow-up id alone would authorize by knowing a UUID, which is
 * not authorization. The service still verifies the follow-up belongs to a row
 * that is genuinely uncompleted.
 */
export async function completeFollowUpActionAction(input: {
  applicationId: string;
  followUpId: string;
}): Promise<CompleteFollowUpActionResultShape> {
  const auth = await requireCapability("note:create");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(input.applicationId) || !UUID_PATTERN.test(input.applicationId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!isNonEmptyString(input.followUpId) || !UUID_PATTERN.test(input.followUpId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const target = await getApplicationById(auth.profile.branchScope, input.applicationId);
  if (target.status !== "ok") {
    return { status: "error", code: "NOT_FOUND" };
  }

  // Belt and braces: confirm the follow-up really hangs off the application the
  // caller was authorized against, so a valid application id cannot be paired
  // with someone else's follow-up id.
  const existing = await getFollowUpsByApplicationId(auth.profile.branchScope, input.applicationId);
  if (existing.status !== "ok" || !existing.followUps.some((f) => f.id === input.followUpId)) {
    return { status: "error", code: "NOT_FOUND" };
  }

  const result = await completeFollowUpAction(input.followUpId, auth.profile.id);
  if (result.status !== "ok") {
    return {
      status: "error",
      code: result.code === "NOT_FOUND" ? "NOT_FOUND" : "SAVE_FAILED",
    };
  }

  return { status: "success", followUp: result.followUp };
}

// ============================================================================
// MANUAL REVIEW ACTIONS (Milestone 26B-10)
// ============================================================================
//
// CAPABILITY: `evidence:review`, reused rather than invented. It already means
// "may reach a conclusion about this application's evidence" and is held by
// administrador, gerente and compliance — precisely the people who perform a
// compliance and credit review. A new `review:perform` capability would have
// been a second permission with the same name in a different spelling and the
// same three holders.
//
// THE DECISION IS NOT HERE. Approving or rejecting the LOAN stays
// setSolicitudApplicationStatus above, gated on `application:set_status`
// (administrador, gerente only). A compliance reviewer may therefore complete a review
// recommending approval and still be unable to approve anything — which is the
// separation the milestone asks for, expressed as two capabilities rather than
// as a rule inside one.
//
// ORDERING, as everywhere else: requireCapability() FIRST, before validation
// and before any read, so an unauthorized caller cannot use the difference
// between NOT_FOUND and INVALID_INPUT to probe for applications they cannot
// see. Branch scope is then re-checked inside every service call — a capability
// says WHAT you may do, never WHERE.
//
// THE ACTOR IS NEVER TAKEN FROM THE REQUEST. Every reviewer identity written by
// these actions is auth.profile.id, resolved server-side from the session. The
// client cannot name who performed a review.

export type ReviewActionResult =
  | { status: "success"; review: ApplicationReviewView }
  | { status: "blocked"; blockers: CompletionBlocker[] }
  | {
      status: "error";
      code: "UNAUTHENTICATED" | "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND" | "SAVE_FAILED";
    };

/** Re-reads the review after a successful mutation so the client renders what
 * the database now holds, rather than patching its own copy and drifting. */
async function reviewSuccess(
  scope: BranchScope,
  applicationId: string
): Promise<ReviewActionResult> {
  const refreshed = await getApplicationReview(scope, applicationId);
  if (refreshed.status !== "ok") return { status: "error", code: "SAVE_FAILED" };
  return { status: "success", review: refreshed.review };
}

/** Maps the service's codes onto the action contract. NOT_ACCESSIBLE becomes
 * NOT_FOUND deliberately: out-of-scope and nonexistent must be
 * indistinguishable, or this action becomes an existence oracle. */
function reviewError(code: "NOT_ACCESSIBLE" | "NOT_FOUND" | "INVALID" | "UPDATE_FAILED") {
  if (code === "NOT_ACCESSIBLE" || code === "NOT_FOUND") {
    return { status: "error", code: "NOT_FOUND" } as const;
  }
  if (code === "INVALID") return { status: "error", code: "INVALID_INPUT" } as const;
  return { status: "error", code: "SAVE_FAILED" } as const;
}

export async function getApplicationReviewAction(applicationId: string): Promise<ReviewActionResult> {
  const auth = await requireCapability("evidence:review");
  if (auth.status === "denied") return { status: "error", code: auth.code };
  if (!isNonEmptyString(applicationId) || !UUID_PATTERN.test(applicationId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  return reviewSuccess(auth.profile.branchScope, applicationId);
}

export async function setReviewItemStateAction(input: {
  applicationId: string;
  itemCode: string;
  state: ReviewItemState;
  note?: string;
}): Promise<ReviewActionResult> {
  const auth = await requireCapability("evidence:review");
  if (auth.status === "denied") return { status: "error", code: auth.code };

  if (!isNonEmptyString(input.applicationId) || !UUID_PATTERN.test(input.applicationId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  // The state vocabulary is closed. An unrecognised value is rejected here
  // rather than handed to the database to refuse, and the item code is checked
  // against the catalogue inside the service.
  if (!(REVIEW_ITEM_STATES as readonly string[]).includes(input.state)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const result = await setReviewItemState(
    auth.profile.branchScope,
    input.applicationId,
    input.itemCode,
    input.state,
    input.note ?? null,
    auth.profile.id
  );
  if (result.status !== "ok") return reviewError(result.code);
  return reviewSuccess(auth.profile.branchScope, input.applicationId);
}

export async function addReviewObservationAction(input: {
  applicationId: string;
  category: ReviewObservationCategory;
  body: string;
}): Promise<ReviewActionResult> {
  const auth = await requireCapability("evidence:review");
  if (auth.status === "denied") return { status: "error", code: auth.code };

  if (!isNonEmptyString(input.applicationId) || !UUID_PATTERN.test(input.applicationId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!(REVIEW_OBSERVATION_CATEGORIES as readonly string[]).includes(input.category)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!isNonEmptyString(input.body)) return { status: "error", code: "INVALID_INPUT" };
  // The column is unbounded text; this is the practical ceiling so one paste
  // cannot become an unremovable wall in an append-only table.
  if (input.body.trim().length > 4000) return { status: "error", code: "INVALID_INPUT" };

  const result = await addReviewObservation(
    auth.profile.branchScope,
    input.applicationId,
    input.category,
    input.body,
    auth.profile.id
  );
  if (result.status !== "ok") return reviewError(result.code);
  return reviewSuccess(auth.profile.branchScope, input.applicationId);
}

/**
 * Records the reviewer's recommendation.
 *
 * A RECOMMENDATION IS NOT A DECISION and this action proves it: it holds
 * `evidence:review`, not `application:set_status`, and it never calls
 * setApplicationStatus. The application's status is untouched by every path
 * through here.
 */
export async function setReviewRecommendationAction(input: {
  applicationId: string;
  recommendation: ReviewRecommendation;
  note?: string;
}): Promise<ReviewActionResult> {
  const auth = await requireCapability("evidence:review");
  if (auth.status === "denied") return { status: "error", code: auth.code };

  if (!isNonEmptyString(input.applicationId) || !UUID_PATTERN.test(input.applicationId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!(REVIEW_RECOMMENDATIONS as readonly string[]).includes(input.recommendation)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  // Mirrors the CHECK constraint so the reviewer is told what is missing
  // instead of receiving a constraint violation.
  if (recommendationRequiresNote(input.recommendation) && !isNonEmptyString(input.note)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const result = await setReviewRecommendation(
    auth.profile.branchScope,
    input.applicationId,
    input.recommendation,
    input.note ?? null,
    auth.profile.id
  );
  if (result.status !== "ok") return reviewError(result.code);
  return reviewSuccess(auth.profile.branchScope, input.applicationId);
}

/**
 * Marks the review finished.
 *
 * `blocked` is a first-class outcome, not an error: the reviewer is told which
 * conditions are unmet so they can go and meet them. The service re-evaluates
 * those conditions against the live record — this action does not pre-judge
 * them, and a client that hides the button cannot be relied upon.
 */
export async function completeReviewAction(applicationId: string): Promise<ReviewActionResult> {
  const auth = await requireCapability("evidence:review");
  if (auth.status === "denied") return { status: "error", code: auth.code };
  if (!isNonEmptyString(applicationId) || !UUID_PATTERN.test(applicationId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const result = await completeReview(auth.profile.branchScope, applicationId, auth.profile.id);
  if (result.status === "blocked") return { status: "blocked", blockers: result.blockers };
  if (result.status !== "ok") {
    return reviewError(result.code === "NOT_ACCESSIBLE" ? "NOT_ACCESSIBLE" : result.code);
  }
  return reviewSuccess(auth.profile.branchScope, applicationId);
}

/** Reopens a completed review. The reason is required and is recorded in the
 * append-only event log — see reopenReview. */
export async function reopenReviewAction(input: {
  applicationId: string;
  reason: string;
}): Promise<ReviewActionResult> {
  const auth = await requireCapability("evidence:review");
  if (auth.status === "denied") return { status: "error", code: auth.code };

  if (!isNonEmptyString(input.applicationId) || !UUID_PATTERN.test(input.applicationId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!isNonEmptyString(input.reason)) return { status: "error", code: "INVALID_INPUT" };

  const result = await reopenReview(
    auth.profile.branchScope,
    input.applicationId,
    input.reason,
    auth.profile.id
  );
  if (result.status !== "ok") return reviewError(result.code);
  return reviewSuccess(auth.profile.branchScope, input.applicationId);
}

/**
 * ============================================================================
 * MILESTONE 26B-19 — RESOLVING A PARKED IDENTITY
 * ============================================================================
 *
 * Two answers to one question, both gated on `intake:resolve` and both doing
 * their real work server-side. The browser sends an intake id and, for the
 * first, which candidate the reviewer picked — never a client to attach freely,
 * never a status, never a review reason.
 *
 * ORDERING, as everywhere else in this file: requireCapability() first, input
 * validation second, work third. A caller without the capability must not be
 * able to learn whether an id is valid by the shape of the refusal.
 */
export type ResolveIntakeActionResult =
  | { status: "ok" }
  | { status: "error"; code: string };

export async function resolveIntakeAsExistingClientAction(input: {
  intakeId: string;
  clientId: string;
}): Promise<ResolveIntakeActionResult> {
  const auth = await requireCapability("intake:resolve");
  if (auth.status === "denied") return { status: "error", code: auth.code };

  if (!isNonEmptyString(input.intakeId) || !UUID_PATTERN.test(input.intakeId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!isNonEmptyString(input.clientId) || !UUID_PATTERN.test(input.clientId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const { resolveIntakeAsExistingClient } = await import("@/lib/services/intake-review");
  const result = await resolveIntakeAsExistingClient(
    input.intakeId,
    input.clientId,
    auth.profile.id
  );
  if (result.status !== "ok") return { status: "error", code: result.code };

  revalidatePath("/solicitudes");
  return { status: "ok" };
}

export async function resolveIntakeAsNewClientAction(input: {
  intakeId: string;
}): Promise<ResolveIntakeActionResult> {
  const auth = await requireCapability("intake:resolve");
  if (auth.status === "denied") return { status: "error", code: auth.code };

  if (!isNonEmptyString(input.intakeId) || !UUID_PATTERN.test(input.intakeId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const { resolveIntakeAsNewClient } = await import("@/lib/services/intake-review");
  const result = await resolveIntakeAsNewClient(input.intakeId, auth.profile.id);
  if (result.status !== "ok") return { status: "error", code: result.code };

  revalidatePath("/solicitudes");
  return { status: "ok" };
}

/**
 * ============================================================================
 * MILESTONE 26B-23B — "FORMALIZAR SOLICITUD"
 * ============================================================================
 *
 * Turns a staff-created draft into a received application. Formalising is NOT
 * approving: the application lands in `in_review`, exactly where a portal
 * submission lands, and every credit decision still happens afterwards through
 * `application:set_status`.
 *
 * WHICH CAPABILITY, AND WHY NOT set_status. Originating an application and
 * deciding one are different authorities — 26B-10 separated them precisely so a
 * gerente or asesor can file a request they may not rule on. Formalising is the
 * end of origination, not the start of adjudication, so it sits with
 * `application:create`: whoever could create the draft can finish creating it.
 * Reaching for `application:set_status` would quietly bar the advisors who do
 * this work all day, for an act that decides nothing.
 *
 * THE BROWSER SUPPLIES ONE ID AND NOTHING ELSE. No number, no source, no
 * status, no actor. The actor comes from the session, the source is fixed here,
 * and the number is allocated by the database — a client that names any of them
 * is simply not listened to.
 */
export type FormalizeSolicitudApplicationResult =
  | { status: "success"; applicationNumber: string }
  | {
      status: "error";
      code: "INVALID_INPUT" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "NOT_DRAFT" | "FORMALIZE_FAILED";
    };

export async function formalizeSolicitudApplication(
  applicationId: string
): Promise<FormalizeSolicitudApplicationResult> {
  const auth = await requireCapability("application:create");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(applicationId) || !UUID_PATTERN.test(applicationId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const { formalizeApplication } = await import("@/lib/services/applications");
  const result = await formalizeApplication(
    auth.profile.branchScope,
    applicationId,
    auth.profile.id
  );

  if (result.status !== "ok") {
    return { status: "error", code: result.code };
  }

  // The application leaves the drafts and joins the formal register, so both
  // the list and the dossier that showed it as a draft have to be re-read.
  revalidatePath("/solicitudes");
  revalidatePath(`/solicitudes/${applicationId}`);

  return { status: "success", applicationNumber: result.applicationNumber };
}
