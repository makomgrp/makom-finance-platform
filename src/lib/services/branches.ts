import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { applyBranchScope, isEmptyScope } from "@/lib/services/branch-scope-query";
import type { Branch, BranchScope } from "@/types";

/**
 * ============================================================================
 * BRANCHES — THE ONLY WRITE PATH (Milestone 25A)
 * ============================================================================
 *
 * Same posture as staff-admin.ts and capability-grants.ts. `service_role` holds
 * SELECT on `branches` and nothing else — no INSERT, no UPDATE, no DELETE. A
 * direct `supabase.from("branches").insert(...)` fails at the database, by
 * design, so a branch can never be written without its `crm_events` audit
 * event. If you are here to add one, the answer is another RPC.
 *
 * DEACTIVATE-ONLY. There is no delete function here and none may be added:
 * branches are permanent foreign-key targets on historical clients and
 * applications, and the product has no hard-delete surface anywhere.
 *
 * CREATION IS SEPARATELY GUARDED. create_branch hard-codes `actor.role =
 * 'administrador'` because `branch:create` is non-delegatable — a branch nobody
 * is yet a member of lies outside every delegated manager's scope, so
 * delegating its creation could only ever be useless or an escalation.
 * update/activate are gated by `branch:manage` plus the actor's own branch
 * scope.
 */

interface BranchRow {
  id: string;
  code: string;
  name: string;
  province: string;
  city: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
  is_headquarters: boolean;
  active: boolean;
  created_at: string;
}

const BRANCH_SELECT =
  "id, code, name, province, city, address, phone, email, is_headquarters, active, created_at";

function toBranch(row: BranchRow): Branch {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    province: row.province,
    city: row.city ?? undefined,
    address: row.address ?? undefined,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    isHeadquarters: row.is_headquarters,
    active: row.active,
    createdAt: row.created_at,
  };
}

export type GetBranchesResult = { status: "ok"; branches: Branch[] } | { status: "error" };

/**
 * Every branch, for Configuración → Sucursales.
 *
 * NO ROW IS EXCLUDED — not inactive ones. An administrator has to be able to
 * see a deactivated branch, since that is what reactivating one starts from.
 * Ordered by code, which is the stable identity the screen leads with.
 *
 * No fallback data on failure: callers get an explicit "error" so the UI can
 * say the connection is down, rather than rendering an empty list that looks
 * like "no branches configured".
 */
export async function getBranches(): Promise<GetBranchesResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("branches")
      .select(BRANCH_SELECT)
      .order("code", { ascending: true });

    if (error) {
      console.error("[branches service] Failed to load branches:", error.message);
      return { status: "error" };
    }
    return { status: "ok", branches: ((data ?? []) as BranchRow[]).map(toBranch) };
  } catch (error) {
    console.error(
      "[branches service] Unexpected failure loading branches:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

/**
 * The ACTIVE branches this caller may work with (Milestone 25C-3).
 *
 * THE ONE SCOPED BRANCH DIRECTORY. Used for transfer destinations (25B-3) and
 * for staff onboarding/branch assignment (25C-3), so a caller can never be
 * offered — or even shown the name of — a branch outside their reach.
 *
 * Deliberately NOT getBranches(). That one is the administration screen's list
 * and returns every row including deactivated ones, because reactivating a
 * branch has to start from seeing it. This one answers a different question —
 * "where may this person move a file?" — and so applies two filters the
 * administration list must not:
 *
 *   active = true    a closed branch is not a valid destination. (A closed
 *                    branch is still a valid SOURCE — records have to be able
 *                    to leave one — which is why the RPC checks `active` only
 *                    on the destination side.)
 *   branch scope     national sees every active branch, including ones created
 *                    tomorrow; a branch-scoped user sees only their own; an
 *                    empty scope sees none.
 *
 * THIS IS A MENU, NOT A GATE. transfer_client_branch and
 * transfer_application_branch re-derive destination authorization inside the
 * write's own transaction. Narrowing the list here stops honest users from
 * picking something that would be rejected; it stops nobody from crafting a
 * request.
 */
export async function getActiveBranchesInScope(scope: BranchScope): Promise<GetBranchesResult> {
  // Empty scope reaches no branch. Return without querying rather than emitting
  // a predicate — see branch-scope-query.ts on the empty-scope trap.
  if (isEmptyScope(scope)) return { status: "ok", branches: [] };

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await applyBranchScope(
      supabase.from("branches").select(BRANCH_SELECT).eq("active", true),
      scope,
      // Scoping the branch directory filters on the branch's OWN id, not on a
      // `branch_id` column — branches do not belong to branches.
      "id"
    ).order("name", { ascending: true });

    if (error) {
      console.error("[branches service] Failed to load in-scope active branches:", error.message);
      return { status: "error" };
    }
    return { status: "ok", branches: ((data ?? []) as BranchRow[]).map(toBranch) };
  } catch (error) {
    console.error(
      "[branches service] Unexpected failure loading in-scope active branches:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

/**
 * The branches a caller may send a record TO (Milestone 25B-3).
 *
 * Identical question to "which branches may this person work with", so it
 * delegates rather than repeating the query — one filter, two intention-
 * revealing names. See getActiveBranchesInScope above for why `active` and
 * scope are both applied, and why this is a MENU and never a gate: the transfer
 * RPCs re-derive destination authorization inside the write's own transaction.
 */
export async function getTransferDestinationBranches(
  scope: BranchScope
): Promise<GetBranchesResult> {
  return getActiveBranchesInScope(scope);
}

export type BranchMutationResult =
  | { status: "ok"; branchId: string }
  | {
      status: "error";
      code: "FORBIDDEN" | "INVALID_INPUT" | "DUPLICATE_CODE" | "NOT_FOUND" | "MUTATION_FAILED";
    };

/**
 * Maps the RPCs' SQLSTATEs to the action layer's vocabulary.
 *
 *   42501 -> actor is not an administrador (create), or the branch is outside
 *            the actor's branch scope (update / activate)
 *   23505 -> branches_code_key — the code is already taken
 *   22023 -> invalid argument, or a CHECK the function surfaced explicitly
 *   23514 -> branches_code_format_check, if a malformed code reached the DB
 */
function mapRpcError(code: string | undefined): BranchMutationResult {
  if (code === "42501") return { status: "error", code: "FORBIDDEN" };
  if (code === "23505") return { status: "error", code: "DUPLICATE_CODE" };
  if (code === "22023" || code === "23514") return { status: "error", code: "INVALID_INPUT" };
  return { status: "error", code: "MUTATION_FAILED" };
}

export interface BranchInput {
  code: string;
  name: string;
  province: string;
  city?: string;
  address?: string;
  phone?: string;
  email?: string;
  isHeadquarters: boolean;
}

/** Creates a branch. The RPC requires an active administrador — `branch:manage`
 * is deliberately NOT sufficient. No membership is created for the actor. */
export async function createBranch(
  input: BranchInput,
  actorProfileId: string
): Promise<BranchMutationResult> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.rpc("create_branch", {
    p_code: input.code,
    p_name: input.name,
    p_province: input.province,
    p_city: input.city ?? null,
    p_address: input.address ?? null,
    p_phone: input.phone ?? null,
    p_email: input.email ?? null,
    p_is_headquarters: input.isHeadquarters,
    p_actor_profile_id: actorProfileId,
  });

  if (error) {
    console.error("[branches service] create_branch failed:", error.message);
    return mapRpcError(error.code);
  }
  if (!data) return { status: "error", code: "MUTATION_FAILED" };
  return { status: "ok", branchId: data as string };
}

/** Updates a branch. The audit event records CHANGED FIELD NAMES ONLY — a
 * branch's phone, e-mail and address are contact data, and crm_events is
 * append-only with no delete path. A no-change save writes no event. */
export async function updateBranch(
  branchId: string,
  input: BranchInput,
  actorProfileId: string
): Promise<BranchMutationResult> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.rpc("update_branch", {
    p_branch_id: branchId,
    p_code: input.code,
    p_name: input.name,
    p_province: input.province,
    p_city: input.city ?? null,
    p_address: input.address ?? null,
    p_phone: input.phone ?? null,
    p_email: input.email ?? null,
    p_is_headquarters: input.isHeadquarters,
    p_actor_profile_id: actorProfileId,
  });

  if (error) {
    console.error("[branches service] update_branch failed:", error.message);
    return mapRpcError(error.code);
  }
  if (!data) return { status: "error", code: "NOT_FOUND" };
  return { status: "ok", branchId: data as string };
}

/** Activates or deactivates a branch — the only "removal" this product has.
 * A no-op writes no event. */
export async function setBranchActive(
  branchId: string,
  active: boolean,
  actorProfileId: string
): Promise<BranchMutationResult> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.rpc("set_branch_active", {
    p_branch_id: branchId,
    p_active: active,
    p_actor_profile_id: actorProfileId,
  });

  if (error) {
    console.error("[branches service] set_branch_active failed:", error.message);
    return mapRpcError(error.code);
  }
  if (!data) return { status: "error", code: "NOT_FOUND" };
  return { status: "ok", branchId: data as string };
}
