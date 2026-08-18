import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { BranchMembership, BranchScopeMode } from "@/types";

/**
 * ============================================================================
 * STAFF BRANCH MEMBERSHIPS — THE ONLY WRITE PATH (Milestone 25A)
 * ============================================================================
 *
 * Which branches a staff member may act on. Unioned with
 * profiles.branch_scope_mode to produce their effective branch scope.
 *
 * `service_role` holds SELECT and nothing else; every mutation goes through a
 * SECURITY DEFINER RPC, so a membership can never be written without its audit
 * event. Same posture as capability-grants.ts.
 *
 * THE INVARIANTS THESE FUNCTIONS RELY ON (all enforced in the database, not
 * here — this layer maps errors, it does not re-implement rules):
 *
 *   B1  assign only to branches inside the actor's own scope
 *   B2  the target's CURRENT memberships must be a subset of the actor's scope
 *   B3  nobody modifies their own memberships, primary branch or scope mode
 *   B4  only an administrador sets branch_scope_mode
 *   B5  only an administrador modifies an administrador
 *   B6  branch:manage never expands the actor's own branch scope
 *
 * B3 and B6 together are what make delegation safe: a gerente holding
 * `branch:manage` can administer the branches they already belong to and can
 * never add themselves to another one, create one, or become national.
 */

interface MembershipRow {
  profile_id: string;
  branch_id: string;
  is_primary: boolean;
}

export type GetBranchMembershipsResult =
  | { status: "ok"; memberships: BranchMembership[] }
  | { status: "error" };

function toMemberships(rows: MembershipRow[]): BranchMembership[] {
  return rows.map((row) => ({
    profileId: row.profile_id,
    branchId: row.branch_id,
    isPrimary: row.is_primary,
  }));
}

/**
 * Every membership for every profile — one read for the whole Usuarios y roles
 * screen rather than a query per row. The table holds only real assignments, so
 * it stays small: at 50 branches and 200 staff it is still a few hundred rows.
 *
 * Uses the admin client because an administrator is reading OTHER people's
 * memberships. A user resolving their OWN branch scope never comes through
 * here — getCurrentProfile() does that with the authenticated, RLS-scoped
 * client against profile_branch_memberships_select_own.
 */
export async function getAllBranchMemberships(): Promise<GetBranchMembershipsResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("profile_branch_memberships")
      .select("profile_id, branch_id, is_primary");

    if (error) {
      console.error("[branch-memberships service] Failed to load memberships:", error.message);
      return { status: "error" };
    }
    return { status: "ok", memberships: toMemberships((data ?? []) as MembershipRow[]) };
  } catch (error) {
    console.error(
      "[branch-memberships service] Unexpected failure loading memberships:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

export type BranchMembershipMutationResult =
  | { status: "ok" }
  | {
      status: "error";
      code:
        | "FORBIDDEN"
        | "INVALID_INPUT"
        | "PROFILE_NOT_FOUND"
        | "MUTATION_FAILED";
    };

/**
 *   42501 -> B1/B2/B5/B6 — out of scope, or target outranks the actor
 *   22023 -> B3 (self-modification), inactive/absent branch, or a missing
 *            membership when setting primary. All surface as INVALID_INPUT:
 *            they are argument problems, not authorization failures, and the
 *            caller is deliberately not told which — an error must not become
 *            a probe for which branches or memberships exist.
 */
function mapRpcError(code: string | undefined): BranchMembershipMutationResult {
  if (code === "42501") return { status: "error", code: "FORBIDDEN" };
  if (code === "22023") return { status: "error", code: "INVALID_INPUT" };
  return { status: "error", code: "MUTATION_FAILED" };
}

/** Assigns a profile to a branch. Idempotent: re-assigning an existing
 * membership succeeds, creates no duplicate row and writes no event. */
export async function assignProfileBranch(
  profileId: string,
  branchId: string,
  isPrimary: boolean,
  actorProfileId: string
): Promise<BranchMembershipMutationResult> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.rpc("assign_profile_branch", {
    p_profile_id: profileId,
    p_branch_id: branchId,
    p_is_primary: isPrimary,
    p_actor_profile_id: actorProfileId,
  });

  if (error) {
    console.error("[branch-memberships service] assign_profile_branch failed:", error.message);
    return mapRpcError(error.code);
  }
  if (!data) return { status: "error", code: "PROFILE_NOT_FOUND" };
  return { status: "ok" };
}

/** Removes a membership. Idempotent: removing one that does not exist succeeds
 * and writes no event. */
export async function removeProfileBranch(
  profileId: string,
  branchId: string,
  actorProfileId: string
): Promise<BranchMembershipMutationResult> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.rpc("remove_profile_branch", {
    p_profile_id: profileId,
    p_branch_id: branchId,
    p_actor_profile_id: actorProfileId,
  });

  if (error) {
    console.error("[branch-memberships service] remove_profile_branch failed:", error.message);
    return mapRpcError(error.code);
  }
  if (!data) return { status: "error", code: "PROFILE_NOT_FOUND" };
  return { status: "ok" };
}

/** Marks an EXISTING membership as primary. Requires the membership to exist —
 * you cannot be primarily assigned to a branch you do not belong to. Writes no
 * dedicated event: a primary change is expressible through the assigned/removed
 * pair, and a third event type for a boolean would be noise. */
export async function setProfilePrimaryBranch(
  profileId: string,
  branchId: string,
  actorProfileId: string
): Promise<BranchMembershipMutationResult> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.rpc("set_profile_primary_branch", {
    p_profile_id: profileId,
    p_branch_id: branchId,
    p_actor_profile_id: actorProfileId,
  });

  if (error) {
    console.error("[branch-memberships service] set_profile_primary_branch failed:", error.message);
    return mapRpcError(error.code);
  }
  if (!data) return { status: "error", code: "PROFILE_NOT_FOUND" };
  return { status: "ok" };
}

/**
 * Sets a profile's branch scope mode.
 *
 * THE RPC REQUIRES AN ACTIVE ADMINISTRADOR — a hard role test (B4), not a
 * capability test, and `branch:manage` is explicitly NOT sufficient. National
 * reach is the widest thing anyone can be given, so the guard on it must not
 * depend on anything delegable. This is the same reasoning that keeps
 * grant_staff_capability administrador-only.
 */
export async function setProfileBranchScopeMode(
  profileId: string,
  mode: BranchScopeMode,
  actorProfileId: string
): Promise<BranchMembershipMutationResult> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.rpc("set_profile_branch_scope_mode", {
    p_profile_id: profileId,
    p_mode: mode,
    p_actor_profile_id: actorProfileId,
  });

  if (error) {
    console.error(
      "[branch-memberships service] set_profile_branch_scope_mode failed:",
      error.message
    );
    return mapRpcError(error.code);
  }
  if (!data) return { status: "error", code: "PROFILE_NOT_FOUND" };
  return { status: "ok" };
}
