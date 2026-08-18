"use server";

import {
  createClient,
  getClientById,
  updateClientProfile,
  setClientStatus,
  setClientRestricted,
} from "@/lib/services/clients";
import { canCreateUnassignedEntity } from "@/lib/services/branch-scope-query";
import { getClientTransferContext, transferClientBranch } from "@/lib/services/branch-transfers";
import { requireCapability } from "@/lib/auth/authorize";
import { CLIENT_STATUS_VALUES } from "@/lib/config/client-status";
import type { Client, ClientStatus, IdentificationType } from "@/types";

/**
 * Thin Server Action wrappers around src/lib/services/clients.ts, matching
 * the exact same shape as every other Server Action in this app (see
 * src/app/(app)/solicitudes/actions.ts#setSolicitudApplicationStatus): each
 * function only validates input, authenticates the caller via
 * getCurrentProfile(), delegates to the Client service, and maps the
 * outcome to a safe, client-facing result. No business logic lives here —
 * this file exists only because src/lib/services/clients.ts is
 * server-only and therefore unreachable from the "use client" components
 * this milestone adds (real-client-form-dialog.tsx, clients-table.tsx).
 * Milestone 14C — see the Milestone 14A architecture review.
 *
 * Every mutation is attributed to the caller's own resolved profile id and
 * hardcoded to source "crm_manual" — never client-supplied — since these
 * actions are reachable only from an authenticated CRM session, matching
 * every other manual-mutation action in this app.
 *
 * Milestone 16: identity still comes from getCurrentProfile(), but each
 * action now reaches it through requireCapability(), which additionally
 * proves the caller is ALLOWED to perform the operation before any input is
 * validated or any record is read. Client status is treated as an
 * administrative change (see setClientStatusAction's own note below) and
 * therefore carries a different capability from ordinary profile editing.
 */

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENTIFICATION_TYPES: IdentificationType[] = ["cedula", "pasaporte"];

export interface ClientProfileFields {
  fullName: string;
  identificationType: IdentificationType;
  identificationNumber: string;
  phone: string;
  email: string;
  /** Free-text employer (Milestone 23) — the only employer field the CRM
   * writes. Optional; omitted means not recorded. */
  employerName?: string;
  /** LEGACY pass-through, edit path only. Never sent to createClient — see
   * createClientAction. Present so updating a fixture client does not erase
   * the static company code that still renders its employer. */
  companyLegacyId?: string;
  position: string;
  monthlySalary: number;
  birthDate: string;
  nationality: string;
  address: string;
  observations?: string;
}

function hasValidProfileFields(input: ClientProfileFields): boolean {
  return (
    isNonEmptyString(input.fullName) &&
    (IDENTIFICATION_TYPES as string[]).includes(input.identificationType) &&
    isNonEmptyString(input.identificationNumber) &&
    isNonEmptyString(input.phone) &&
    isNonEmptyString(input.email) &&
    isNonEmptyString(input.position) &&
    isNonEmptyString(input.nationality) &&
    isNonEmptyString(input.address) &&
    isNonEmptyString(input.birthDate) &&
    typeof input.monthlySalary === "number" &&
    input.monthlySalary >= 0
  );
}

export type CreateClientActionResult =
  | { status: "success"; client: Client }
  | {
      status: "error";
      code:
        | "INVALID_INPUT"
        | "UNAUTHENTICATED"
        | "FORBIDDEN"
        | "DUPLICATE_IDENTIFICATION"
        | "INSERT_FAILED";
    };

export async function createClientAction(input: ClientProfileFields): Promise<CreateClientActionResult> {
  const auth = await requireCapability("client:create");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!hasValidProfileFields(input)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  // ==========================================================================
  // MILESTONE 25B-2 — WHO MAY CREATE A CLIENT, AND WHY THE ANSWER IS "NATIONAL"
  // ==========================================================================
  //
  // createClient() does not write branch_id and has no input to write it from:
  // no CRM surface carries a trusted branch context yet. Every client created
  // here is therefore UNASSIGNED, and 25B-2 deliberately does NOT invent an
  // owner for it — not the caller's first membership, not headquarters, not
  // the first active branch. A guessed owner is worse than none, because it is
  // indistinguishable from a real one afterwards.
  //
  // Given that, "may I create?" reduces to "may I operate on an unassigned
  // record?", and the answer is the NULL rule: national only. A branch-scoped
  // user permitted to create here would immediately lose the client they just
  // created — unable to open, edit, or raise an application against it — and
  // would be injecting rows only national scope can ever see.
  //
  // FORBIDDEN, not NOT_FOUND: this describes the CALLER, not a target. Nothing
  // about any existing record is revealed.
  //
  // 25C lifts this by giving the creation form an explicit branch context.
  if (!canCreateUnassignedEntity(auth.profile.branchScope)) {
    return { status: "error", code: "FORBIDDEN" };
  }

  const result = await createClient({
    fullName: input.fullName,
    identificationType: input.identificationType,
    identificationNumber: input.identificationNumber,
    phone: input.phone,
    email: input.email,
    // MILESTONE 23: companyLegacyId is deliberately NOT forwarded. It is
    // still part of ClientProfileFields because the EDIT form must hand a
    // fixture row's existing code back unchanged, but a newly created client
    // must never acquire one — CreateClientInput has no such field at all.
    employerName: input.employerName,
    position: input.position,
    monthlySalary: input.monthlySalary,
    birthDate: input.birthDate,
    nationality: input.nationality,
    address: input.address,
    observations: input.observations,
    source: "crm_manual",
    actorProfileId: auth.profile.id,
  });

  if (result.status !== "ok") {
    const code = result.code === "INVALID_ACTOR" ? "INVALID_INPUT" : result.code;
    return { status: "error", code };
  }

  return { status: "success", client: result.client };
}

export interface UpdateClientProfileActionInput extends ClientProfileFields {
  clientId: string;
}

export type UpdateClientProfileActionResult =
  | { status: "success"; client: Client }
  | {
      status: "error";
      code:
        | "INVALID_INPUT"
        | "UNAUTHENTICATED"
        | "FORBIDDEN"
        | "CLIENT_NOT_FOUND"
        | "DUPLICATE_IDENTIFICATION"
        | "UPDATE_FAILED";
    };

export async function updateClientProfileAction(
  input: UpdateClientProfileActionInput
): Promise<UpdateClientProfileActionResult> {
  const auth = await requireCapability("client:update");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(input.clientId) || !UUID_PATTERN.test(input.clientId) || !hasValidProfileFields(input)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  // ==========================================================================
  // MILESTONE 25B-2 — TARGET SCOPE, RESOLVED SERVER-SIDE
  // ==========================================================================
  //
  // input.clientId IDENTIFIES a target; it does not AUTHORIZE one. The client
  // is re-read through the caller's own effective branch scope, so a crafted
  // request naming a client in another branch resolves to nothing and gets the
  // same CLIENT_NOT_FOUND a nonexistent id would — never a distinct code that
  // would confirm the record exists somewhere.
  //
  // This is the first of two independent checks. The second is inside
  // record_client_profile_update itself, which re-resolves the branch in the
  // same transaction as the write (Milestone 25B-2 migration). This one gives
  // the correct public error contract; that one is the boundary that a bug in
  // this file cannot get past.
  const targetResult = await getClientById(auth.profile.branchScope, input.clientId);
  if (targetResult.status !== "ok") {
    return { status: "error", code: "CLIENT_NOT_FOUND" };
  }

  // Milestone 20: the caller's own resolved profile is now threaded through
  // so the audit event this write produces names a real human. Authorization
  // is untouched — auth is still the requireCapability() call above, and this
  // action's guard, capability and result codes are unchanged.
  const result = await updateClientProfile(
    input.clientId,
    {
      fullName: input.fullName,
      identificationType: input.identificationType,
      identificationNumber: input.identificationNumber,
      phone: input.phone,
      email: input.email,
      address: input.address,
      employerName: input.employerName,
      companyLegacyId: input.companyLegacyId,
      position: input.position,
      monthlySalary: input.monthlySalary,
      birthDate: input.birthDate,
      nationality: input.nationality,
      observations: input.observations,
    },
    auth.profile.id
  );

  if (result.status !== "ok") {
    return { status: "error", code: result.code };
  }

  return { status: "success", client: result.client };
}

export interface SetClientStatusActionInput {
  clientId: string;
  status: ClientStatus;
}

export type SetClientStatusActionResult =
  | { status: "success"; client: Client }
  | {
      status: "error";
      code: "INVALID_INPUT" | "UNAUTHENTICATED" | "FORBIDDEN" | "CLIENT_NOT_FOUND" | "UPDATE_FAILED";
    };

/** No transition-legality graph to enforce here (unlike
 * setSolicitudApplicationStatus) — per the Milestone 14A architecture
 * review, client status changes are administrative; every value in
 * CLIENT_STATUS_VALUES is always a legal target from any other.
 *
 * That "administrative" character is exactly why this carries
 * `client:set_status` rather than `client:update` (Milestone 16): an
 * advisor who may correct a client's phone number is not thereby entitled
 * to deactivate the client record. */
export async function setClientStatusAction(
  input: SetClientStatusActionInput
): Promise<SetClientStatusActionResult> {
  const auth = await requireCapability("client:set_status");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (
    !isNonEmptyString(input.clientId) ||
    !UUID_PATTERN.test(input.clientId) ||
    !(CLIENT_STATUS_VALUES as string[]).includes(input.status)
  ) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  // MILESTONE 25B-2 — target scope resolved server-side; see
  // updateClientProfileAction for the full rationale.
  const targetResult = await getClientById(auth.profile.branchScope, input.clientId);
  if (targetResult.status !== "ok") {
    return { status: "error", code: "CLIENT_NOT_FOUND" };
  }

  // Milestone 20: actor threaded through for the audit event (see above).
  const result = await setClientStatus(input.clientId, input.status, auth.profile.id);
  if (result.status !== "ok") {
    const code = result.code === "INVALID_STATUS" ? "INVALID_INPUT" : result.code;
    return { status: "error", code };
  }

  return { status: "success", client: result.client };
}

export interface SetClientRestrictedActionInput {
  clientId: string;
  restricted: boolean;
}

export type SetClientRestrictedActionResult =
  | { status: "success"; client: Client }
  | {
      status: "error";
      code: "INVALID_INPUT" | "UNAUTHENTICATED" | "FORBIDDEN" | "CLIENT_NOT_FOUND" | "UPDATE_FAILED";
    };

/**
 * Restricts or unrestricts a client (Milestone 23) — the first caller
 * setClientRestricted has ever had.
 *
 * WHAT THIS IS. `clients.restricted` is a compliance/risk flag, deliberately
 * ORTHOGONAL to `clients.status`: a restricted client may still be `activo`.
 * Restricting records a human judgment that this file needs special care. It
 * is a flag and a trail, nothing more.
 *
 * WHAT THIS IS NOT, and must not become: it is not a blacklist engine, not an
 * APC lookup, not risk scoring, and it blocks nothing automatically. No code
 * anywhere reads `restricted` to deny an operation, and Milestone 23 does not
 * add any such rule — automated eligibility belongs to the dormant loan-
 * criteria engine, as a deliberate Phase 2 decision.
 *
 * NO REASON FIELD, deliberately. The schema has no restriction_reason column
 * and this milestone does not invent one: staff record the why in the client's
 * `observations` or in a dossier note, both of which already exist, are
 * already attributed to their author, and are already editable — unlike an
 * audit event, which could never be corrected.
 *
 * CAPABILITY: `client:set_restriction`, held by administrador and gerente.
 * Separate from `client:set_status` even though the holders match today — see
 * that capability's note for why flagging a compliance risk and moving a
 * lifecycle status should be separable.
 *
 * AUDIT: the mutation and its `client_restriction_changed` event are written
 * atomically inside record_client_restriction_change, which stores only the
 * boolean before/after — no client PII of any kind. Re-applying the state the
 * client is already in succeeds and writes no event.
 */
export async function setClientRestrictedAction(
  input: SetClientRestrictedActionInput
): Promise<SetClientRestrictedActionResult> {
  const auth = await requireCapability("client:set_restriction");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(input.clientId) || !UUID_PATTERN.test(input.clientId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (typeof input.restricted !== "boolean") {
    return { status: "error", code: "INVALID_INPUT" };
  }

  // MILESTONE 25B-2 — target scope resolved server-side; see
  // updateClientProfileAction for the full rationale.
  const targetResult = await getClientById(auth.profile.branchScope, input.clientId);
  if (targetResult.status !== "ok") {
    return { status: "error", code: "CLIENT_NOT_FOUND" };
  }

  const result = await setClientRestricted(input.clientId, input.restricted, auth.profile.id);
  if (result.status !== "ok") {
    return { status: "error", code: result.code };
  }

  return { status: "success", client: result.client };
}

// ============================================================================
// transferClientBranchAction (Milestone 25B-3)
// ============================================================================

export interface TransferClientBranchActionInput {
  clientId: string;
  destinationBranchId: string;
}

export type TransferClientBranchActionResult =
  | { status: "success"; client: Client }
  | {
      status: "error";
      code:
        | "INVALID_INPUT"
        | "UNAUTHENTICATED"
        | "FORBIDDEN"
        /** The client does not exist, OR is outside the caller's branch reach.
         * One code for both, deliberately — see the service. */
        | "CLIENT_NOT_FOUND"
        /** The destination is missing, inactive, or outside the caller's reach.
         * Also one code for all three. */
        | "INVALID_DESTINATION"
        | "TRANSFER_FAILED";
    };

/**
 * Moves a client to another branch (Milestone 25B-3).
 *
 * CAPABILITY: `branch:transfer` — delegatable, and held by administrador and
 * gerente. Note carefully what delegating it does and does not do: it grants
 * the ACTION, never the REACH. A gerente who receives `branch:transfer` can
 * still only move a client between branches they already hold, because the
 * database checks the caller's own effective scope on BOTH the source and the
 * destination. A capability has never created data scope in this system and
 * this action does not become the exception.
 *
 * WHY BOTH SIDES. Moving a record out of a branch you cannot see would be
 * exfiltration; moving one into a branch you cannot see would be dumping. Only
 * an administrador — national by role — can do either, which is exactly how an
 * unassigned legacy or public-intake client gets routed into a real branch.
 *
 * THE DESTINATION ID IS NOT TRUSTED because it came from a select menu. The
 * menu is narrowed by getTransferDestinationBranches() for honest users;
 * transfer_client_branch re-derives the authorization inside the write's own
 * transaction for everyone else.
 *
 * THE CLIENT'S APPLICATIONS DO NOT MOVE. Client and application ownership are
 * independent facts, and there is no hidden cascade — see the service.
 */
export async function transferClientBranchAction(
  input: TransferClientBranchActionInput
): Promise<TransferClientBranchActionResult> {
  const auth = await requireCapability("branch:transfer");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(input.clientId) || !UUID_PATTERN.test(input.clientId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (
    !isNonEmptyString(input.destinationBranchId) ||
    !UUID_PATTERN.test(input.destinationBranchId)
  ) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const result = await transferClientBranch(
    auth.profile.branchScope,
    input.clientId,
    input.destinationBranchId,
    auth.profile.id
  );

  if (result.status !== "ok") {
    const code = result.code === "NOT_FOUND" ? "CLIENT_NOT_FOUND" : result.code;
    return { status: "error", code };
  }

  return { status: "success", client: result.client };
}

export type GetClientTransferOptionsActionResult =
  | { status: "success"; currentBranchName: string | null; destinations: { id: string; name: string }[] }
  | { status: "error"; code: "INVALID_INPUT" | "UNAUTHENTICATED" | "FORBIDDEN" | "CLIENT_NOT_FOUND" };

/** Everything the transfer dialog renders, resolved server-side (25B-3).
 *
 * A READ action, guarded by the SAME capability as the transfer itself: the
 * list of branches a person may move records into is exactly as sensitive as
 * the move, and someone who cannot transfer has no reason to enumerate
 * destinations. */
export async function getClientTransferOptionsAction(
  clientId: string
): Promise<GetClientTransferOptionsActionResult> {
  const auth = await requireCapability("branch:transfer");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }
  if (!isNonEmptyString(clientId) || !UUID_PATTERN.test(clientId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const result = await getClientTransferContext(auth.profile.branchScope, clientId);
  if (result.status !== "ok") {
    return { status: "error", code: "CLIENT_NOT_FOUND" };
  }
  return {
    status: "success",
    currentBranchName: result.context.currentBranchName,
    destinations: result.context.destinations,
  };
}
