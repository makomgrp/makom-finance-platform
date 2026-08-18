import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { isDelegatableCapability, type DelegatableCapability } from "@/lib/auth/capabilities";

/**
 * ============================================================================
 * PER-USER CAPABILITY GRANTS — THE ONLY WRITE PATH (Milestone 24)
 * ============================================================================
 *
 * `profile_capability_grants` holds the ADDITIONAL capabilities an
 * administrador has delegated to an individual, on top of their base role.
 * Effective permissions are the union of the two, resolved once per request in
 * getCurrentProfile().
 *
 * SAME POSTURE AS staff-admin.ts. `service_role` holds SELECT on this table
 * and nothing else — no INSERT, no UPDATE, no DELETE. A direct
 * `supabase.from("profile_capability_grants").insert(...)` fails at the
 * database, by design, so a grant can never be written without its `crm_events`
 * audit event. If you are here to add one, the answer is another RPC.
 *
 * THE HARD RULE THIS FILE EXISTS TO PROTECT: only an administrador may change
 * anyone's permissions. Unlike every other staff RPC — which Milestone 24
 * relaxed to "actor must be an active profile" so that delegation can work —
 * grant_staff_capability and revoke_staff_capability still hard-code
 * `actor.role = 'administrador'`. That is deliberate and must never be
 * softened: it is a ROLE test, which SQL can state exactly and which nothing
 * delegable can satisfy. Testing for `user:manage_permissions` instead would
 * make the database depend on an answer that lives in TypeScript, and the
 * whole point is that a delegated manager can never widen authority.
 *
 * The database additionally refuses to STORE `user:manage_permissions` at all
 * (profile_capability_grants_capability_check), so even a future bug in this
 * layer cannot make permission management delegable.
 */

/** One delegated capability as stored. Deliberately narrow: the UI needs to
 * know WHICH capability, not who granted it or when — that history lives
 * permanently in crm_events, where nothing can alter it. */
export interface CapabilityGrant {
  profileId: string;
  capability: DelegatableCapability;
}

export type GetCapabilityGrantsResult =
  | { status: "ok"; grants: CapabilityGrant[] }
  | { status: "error" };

function toGrants(rows: { profile_id: string; capability: string }[]): CapabilityGrant[] {
  // Rows whose capability is no longer delegatable are DROPPED, not surfaced.
  // The database CHECK constraint and the TypeScript allow-list are maintained
  // in separate migrations, so a retired capability could briefly outlive its
  // definition. Dropping it here matches resolveEffectiveCapabilities(), which
  // ignores the same rows — the admin screen must never show a permission that
  // no longer does anything.
  return rows
    .filter((row) => isDelegatableCapability(row.capability))
    .map((row) => ({
      profileId: row.profile_id,
      capability: row.capability as DelegatableCapability,
    }));
}

/**
 * Every grant for one profile — the detail panel's read.
 *
 * Uses the admin client because an administrador is reading SOMEONE ELSE's
 * permissions. A user reading their OWN effective capabilities never comes
 * through here: getCurrentProfile() does that with the authenticated,
 * RLS-scoped client against the profile_capability_grants_select_own policy.
 */
export async function getCapabilityGrantsForProfile(
  profileId: string
): Promise<GetCapabilityGrantsResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("profile_capability_grants")
      .select("profile_id, capability")
      .eq("profile_id", profileId);

    if (error) {
      console.error("[capability-grants service] Failed to load grants:", error.message);
      return { status: "error" };
    }
    return { status: "ok", grants: toGrants((data ?? []) as { profile_id: string; capability: string }[]) };
  } catch (error) {
    console.error(
      "[capability-grants service] Unexpected failure loading grants:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

/**
 * Every grant for every profile — one read for the whole Usuarios y roles
 * screen, rather than one query per row. The table is small by nature (it holds
 * only delegated exceptions, never the base role matrix), so this stays cheap.
 */
export async function getAllCapabilityGrants(): Promise<GetCapabilityGrantsResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("profile_capability_grants")
      .select("profile_id, capability");

    if (error) {
      console.error("[capability-grants service] Failed to load all grants:", error.message);
      return { status: "error" };
    }
    return { status: "ok", grants: toGrants((data ?? []) as { profile_id: string; capability: string }[]) };
  } catch (error) {
    console.error(
      "[capability-grants service] Unexpected failure loading all grants:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

export type CapabilityGrantMutationResult =
  | { status: "ok" }
  | {
      status: "error";
      code: "FORBIDDEN" | "INVALID_INPUT" | "PROFILE_NOT_FOUND" | "MUTATION_FAILED";
    };

/** Maps the RPCs' SQLSTATEs to the action layer's vocabulary.
 *
 *   42501 -> the actor is not an active administrador (A6)
 *   22023 -> self-grant/revoke (A5), or a non-delegatable capability (A7/A8)
 *   23514 -> the CHECK constraint itself, if a capability slipped past the
 *            function's own guard — kept as INVALID_INPUT so the constraint
 *            can never surface as an opaque failure. */
function mapRpcError(code: string | undefined): CapabilityGrantMutationResult {
  if (code === "42501") return { status: "error", code: "FORBIDDEN" };
  if (code === "22023" || code === "23514") return { status: "error", code: "INVALID_INPUT" };
  return { status: "error", code: "MUTATION_FAILED" };
}

/**
 * Grants one additional capability. Idempotent: re-granting something already
 * held succeeds, creates no duplicate row and writes no audit event.
 */
export async function grantStaffCapability(
  profileId: string,
  capability: DelegatableCapability,
  actorProfileId: string
): Promise<CapabilityGrantMutationResult> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.rpc("grant_staff_capability", {
    p_profile_id: profileId,
    p_capability: capability,
    p_actor_profile_id: actorProfileId,
  });

  if (error) {
    console.error("[capability-grants service] grant_staff_capability failed:", error.message);
    return mapRpcError(error.code);
  }
  if (!data) {
    return { status: "error", code: "PROFILE_NOT_FOUND" };
  }
  return { status: "ok" };
}

/**
 * Revokes one additional capability. Idempotent: revoking something not held
 * succeeds and writes no audit event.
 */
export async function revokeStaffCapability(
  profileId: string,
  capability: DelegatableCapability,
  actorProfileId: string
): Promise<CapabilityGrantMutationResult> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.rpc("revoke_staff_capability", {
    p_profile_id: profileId,
    p_capability: capability,
    p_actor_profile_id: actorProfileId,
  });

  if (error) {
    console.error("[capability-grants service] revoke_staff_capability failed:", error.message);
    return mapRpcError(error.code);
  }
  if (!data) {
    return { status: "error", code: "PROFILE_NOT_FOUND" };
  }
  return { status: "ok" };
}
