"use server";

import {
  assignApplicationAdvisor,
  createApplication,
  getApplicationById,
  setApplicationStatus,
} from "@/lib/services/applications";
import { canCreateUnassignedEntity } from "@/lib/services/branch-scope-query";
import { getApplicationCreatableProducts } from "@/lib/services/products";
import { getClientById } from "@/lib/services/clients";
import { requireCapability } from "@/lib/auth/authorize";
import { APPLICATION_STATUS_TRANSITIONABLE } from "@/lib/config/application";
import type { Application, ApplicationStatus } from "@/types";

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
