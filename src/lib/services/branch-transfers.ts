import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getClientById } from "@/lib/services/clients";
import { getApplicationById } from "@/lib/services/applications";
import { getTransferDestinationBranches } from "@/lib/services/branches";
import { applyBranchScope, isEmptyScope } from "@/lib/services/branch-scope-query";
import type { Application, BranchScope, Client } from "@/types";

/**
 * ============================================================================
 * BRANCH TRANSFERS — THE ONLY OPERATION THAT CROSSES THE BOUNDARY (25B-3)
 * ============================================================================
 *
 * Every other operational mutation in this CRM works INSIDE a branch. These two
 * exist to move a record BETWEEN branches, which means their entire purpose is
 * to change who can see something. That is why they are the most tightly
 * authorized operations in the system and why they live in their own module
 * instead of being bolted onto clients.ts and applications.ts: a transfer is
 * not another field edit, and it should not be one import away from being
 * mistaken for one.
 *
 * TWO OPERATIONS, DELIBERATELY NOT ONE. `clients.branch_id` and
 * `applications.branch_id` are independent ownership facts (25A). Transferring
 * a client does NOT move that client's applications, and transferring an
 * application does NOT move its client. There is no bulk "move everything"
 * function here and none may be added — if ODL ever wants a coordinated move,
 * it is a UI that calls both of these explicitly, so that every branch change
 * remains a separate, individually audited decision.
 *
 * ----------------------------------------------------------------------------
 * THIS LAYER IS NOT THE ENFORCEMENT
 * ----------------------------------------------------------------------------
 * Both functions check the entity through the caller's own scope before calling
 * their RPC. That check exists to produce the right error contract quickly, NOT
 * to authorize the write. The database re-derives both the source and the
 * destination authorization inside the write's own transaction — see
 * supabase/migrations/20260818072951_milestone_25b3_branch_transfers.sql. If
 * this file's check were deleted tomorrow the boundary would still hold.
 *
 * ----------------------------------------------------------------------------
 * WHY THE ACTOR CAN ALWAYS STILL SEE THE RECORD AFTERWARDS
 * ----------------------------------------------------------------------------
 * A transfer requires scope over BOTH sides, so whoever performs one
 * necessarily holds the destination too. Re-reading the entity through the same
 * scope after the move is therefore always valid, which is what lets these
 * functions return the refreshed row exactly as setClientStatus and
 * assignApplicationAdvisor do.
 */

export type TransferResultCode =
  /** The entity does not exist, or is outside the caller's reach. ONE code for
   * both on purpose: a distinct "you may not touch this" would confirm that a
   * record exists in somebody else's branch. Same rule as 25B-2. */
  | "NOT_FOUND"
  /** The destination is missing, inactive, or outside the caller's reach —
   * again collapsed to one code so the error cannot be used to enumerate which
   * branches exist or which ones the caller lacks. */
  | "INVALID_DESTINATION"
  | "TRANSFER_FAILED";

export type TransferClientBranchResult =
  | { status: "ok"; client: Client }
  | { status: "error"; code: TransferResultCode };

export type TransferApplicationBranchResult =
  | { status: "ok"; application: Application }
  | { status: "error"; code: TransferResultCode };

/**
 * Maps the transfer RPCs' SQLSTATEs to this module's vocabulary.
 *
 *   42501 -> the actor cannot reach the SOURCE (or no actor was supplied).
 *            Reported as NOT_FOUND, never as a distinct "forbidden": an
 *            unreachable record must look exactly like an absent one.
 *   22023 -> the DESTINATION is missing, inactive, null, or out of reach.
 */
function mapTransferError(code: string | undefined): TransferResultCode {
  if (code === "42501") return "NOT_FOUND";
  if (code === "22023") return "INVALID_DESTINATION";
  return "TRANSFER_FAILED";
}

/**
 * Moves a client to another branch.
 *
 * NO-OP IS A SUCCESS. Transferring a client to the branch it already occupies
 * returns the client unchanged and writes no audit event — the RPC detects it
 * before touching anything. A no-op must not litter the activity feed.
 *
 * THE CLIENT'S APPLICATIONS DO NOT MOVE. Notes and alerts do follow, but only
 * because they derive their branch from `clients.branch_id` through an `!inner`
 * embed — no child row is copied, moved or rewritten.
 */
export async function transferClientBranch(
  scope: BranchScope,
  clientId: string,
  destinationBranchId: string,
  actorProfileId: string
): Promise<TransferClientBranchResult> {
  // Early contract check only. The RPC repeats it authoritatively.
  const current = await getClientById(scope, clientId);
  if (current.status !== "ok") {
    return { status: "error", code: "NOT_FOUND" };
  }

  const supabase = getSupabaseServerClient();
  const { data: transferredId, error } = await supabase.rpc("transfer_client_branch", {
    p_client_id: clientId,
    p_destination_branch_id: destinationBranchId,
    p_actor_profile_id: actorProfileId,
  });

  if (error) {
    const code = mapTransferError(error.code);
    if (code === "TRANSFER_FAILED") {
      console.error("[branch-transfers service] Failed to transfer client branch:", error.message);
    }
    return { status: "error", code };
  }
  if (!transferredId) {
    return { status: "error", code: "NOT_FOUND" };
  }

  // Safe to re-read through the SAME scope: performing a transfer proves the
  // caller holds the destination. See the module header.
  const refreshed = await getClientById(scope, clientId);
  if (refreshed.status !== "ok") {
    return { status: "error", code: "TRANSFER_FAILED" };
  }
  return { status: "ok", client: refreshed.client };
}

/**
 * Moves an application to another branch, re-evaluating its advisor.
 *
 * THE ADVISOR MAY BE CLEARED BY THIS CALL, and callers must expect it. An
 * assigned advisor whose own branch reach does not cover the destination is
 * unassigned atomically inside the same transaction, because an application
 * owned by somebody who cannot open it is a broken invariant, not a valid
 * state. No replacement is ever chosen automatically — deciding who owns a file
 * is a human judgment.
 *
 * The returned Application reflects that: `assignedAdvisorProfileId` will be
 * undefined when the advisor was cleared.
 */
export async function transferApplicationBranch(
  scope: BranchScope,
  applicationId: string,
  destinationBranchId: string,
  actorProfileId: string
): Promise<TransferApplicationBranchResult> {
  const current = await getApplicationById(scope, applicationId);
  if (current.status !== "ok") {
    return { status: "error", code: "NOT_FOUND" };
  }

  const supabase = getSupabaseServerClient();
  const { data: transferredId, error } = await supabase.rpc("transfer_application_branch", {
    p_application_id: applicationId,
    p_destination_branch_id: destinationBranchId,
    p_actor_profile_id: actorProfileId,
  });

  if (error) {
    const code = mapTransferError(error.code);
    if (code === "TRANSFER_FAILED") {
      console.error(
        "[branch-transfers service] Failed to transfer application branch:",
        error.message
      );
    }
    return { status: "error", code };
  }
  if (!transferredId) {
    return { status: "error", code: "NOT_FOUND" };
  }

  const refreshed = await getApplicationById(scope, applicationId);
  if (refreshed.status !== "ok") {
    return { status: "error", code: "TRANSFER_FAILED" };
  }
  return { status: "ok", application: refreshed.application };
}

/**
 * What the transfer dialog needs to render, resolved entirely server-side.
 *
 * `currentBranchName` is null when the record is UNASSIGNED — the UI renders
 * that as "Sin asignar" / "Unassigned" rather than inventing a branch. Only
 * NAMES cross to the browser; branch ids appear solely as opaque option values
 * the user never sees, and the id the user picks is re-authorized by the RPC
 * regardless.
 */
export interface BranchTransferContext {
  currentBranchName: string | null;
  destinations: { id: string; name: string }[];
}

export type GetBranchTransferContextResult =
  | { status: "ok"; context: BranchTransferContext }
  | { status: "error"; code: "NOT_FOUND" | "QUERY_FAILED" };

async function buildTransferContext(
  scope: BranchScope,
  currentBranchId: string | null
): Promise<GetBranchTransferContextResult> {
  const destinationsResult = await getTransferDestinationBranches(scope);
  if (destinationsResult.status !== "ok") {
    return { status: "error", code: "QUERY_FAILED" };
  }

  // The record's CURRENT branch is resolved from the destination list, which is
  // already scope-filtered — so a name is shown only for a branch the caller
  // may reach anyway, and no extra query is issued. A caller who somehow holds
  // a record whose branch is outside their scope sees "unassigned" rather than
  // a name they have no business reading; that combination is unreachable
  // today, since the record itself would not have resolved.
  const current = currentBranchId
    ? (destinationsResult.branches.find((branch) => branch.id === currentBranchId) ?? null)
    : null;

  return {
    status: "ok",
    context: {
      currentBranchName: current?.name ?? null,
      // The source is removed from the options: offering it would only produce
      // a no-op. The RPC still handles a no-op safely — this is a courtesy, not
      // a control.
      destinations: destinationsResult.branches
        .filter((branch) => branch.id !== currentBranchId)
        .map((branch) => ({ id: branch.id, name: branch.name })),
    },
  };
}

/** Transfer dialog context for one client. */
export async function getClientTransferContext(
  scope: BranchScope,
  clientId: string
): Promise<GetBranchTransferContextResult> {
  if (isEmptyScope(scope)) return { status: "error", code: "NOT_FOUND" };

  const supabase = getSupabaseServerClient();
  const { data, error } = await applyBranchScope(
    supabase.from("clients").select("id, branch_id").eq("id", clientId),
    scope
  ).maybeSingle<{ id: string; branch_id: string | null }>();

  if (error) {
    console.error("[branch-transfers service] Failed to read client branch:", error.message);
    return { status: "error", code: "QUERY_FAILED" };
  }
  if (!data) return { status: "error", code: "NOT_FOUND" };

  return buildTransferContext(scope, data.branch_id);
}

/** Transfer dialog context for one application. */
export async function getApplicationTransferContext(
  scope: BranchScope,
  applicationId: string
): Promise<GetBranchTransferContextResult> {
  if (isEmptyScope(scope)) return { status: "error", code: "NOT_FOUND" };

  const supabase = getSupabaseServerClient();
  const { data, error } = await applyBranchScope(
    supabase.from("applications").select("id, branch_id").eq("id", applicationId),
    scope
  ).maybeSingle<{ id: string; branch_id: string | null }>();

  if (error) {
    console.error("[branch-transfers service] Failed to read application branch:", error.message);
    return { status: "error", code: "QUERY_FAILED" };
  }
  if (!data) return { status: "error", code: "NOT_FOUND" };

  return buildTransferContext(scope, data.branch_id);
}
