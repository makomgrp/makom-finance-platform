import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { Branch } from "@/types";

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
