import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { SupportedLanguage, UserRole } from "@/types";

/**
 * ============================================================================
 * STAFF ADMINISTRATION — THE ONLY WRITE PATH TO `profiles` (Milestone 21)
 * ============================================================================
 *
 * Milestone 16 withheld INSERT and UPDATE on `public.profiles` from
 * service_role and said so explicitly: "granting the privilege early would
 * open a write path this milestone has no code to guard." Milestone 21 opens
 * it WITHOUT granting that privilege. Every function here calls a
 * SECURITY DEFINER RPC that performs the profile mutation and its
 * `crm_events` audit append in ONE transaction — Milestone 20's architecture,
 * applied to staff records.
 *
 * A direct `supabase.from("profiles").update(...)` would fail at the
 * database, by design. If you are here to add one, the answer is another RPC.
 *
 * DEFENCE IN DEPTH, RESHAPED BY MILESTONE 24. These RPCs used to require the
 * actor to be an active administrador. That blanket rule made delegation
 * impossible — it rejected a gerente holding `user:invite` before the request
 * reached any business logic — so Milestone 24 replaced it with the split the
 * rest of this codebase already uses:
 *
 *   requireCapability(...)  -> CALLER AUTHORIZATION, in the Server Action.
 *                              "May this person perform this operation?"
 *   the RPCs                -> TARGET / DOMAIN INVARIANTS (A1-A8).
 *                              "Is this specific target change legitimate?"
 *
 * The RPCs now verify only that the actor is an ACTIVE PROFILE, and then
 * enforce the escalation rules that matter: nobody may modify an administrador
 * unless they are one, nobody may create or promote an administrador unless
 * they are one, and nobody may change their own role or active status. Those
 * are expressible with roles and identity alone, so no capability knowledge
 * leaks into PostgreSQL and ROLE_CAPABILITIES stays defined exactly once.
 *
 * Permission grants are the exception and deliberately stricter:
 * grant_staff_capability / revoke_staff_capability still hard-code
 * `actor.role = 'administrador'`. See src/lib/services/capability-grants.ts.
 *
 * AUTH IS SEPARATE. Creating the Supabase Auth account is NOT done here —
 * see src/lib/services/auth-admin.ts. The two systems cannot share a
 * transaction, which is why the orchestration is explicitly staged and
 * recoverable (see the Server Action's doc comment).
 */

/** Every RPC returns the affected profile's id, or NULL when nothing
 * matched — the idiom Milestone 20 established. Errors surface as thrown
 * PostgrestErrors with a SQLSTATE the caller maps. */
interface RpcOutcome {
  profileId: string | null;
  errorCode?: string;
  errorMessage?: string;
}

async function callRpc(fn: string, args: Record<string, unknown>): Promise<RpcOutcome> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.rpc(fn, args);

  if (error) {
    console.error(`[staff-admin service] ${fn} failed:`, error.message);
    return { profileId: null, errorCode: error.code, errorMessage: error.message };
  }
  return { profileId: (data as string | null) ?? null };
}

export interface CreateStaffProfileInput {
  email: string;
  fullName: string;
  role: UserRole;
  preferredLanguage: SupportedLanguage;
  actorProfileId: string;
}

export type CreateStaffProfileResult =
  | { status: "ok"; profileId: string }
  | { status: "error"; code: "DUPLICATE_EMAIL" | "FORBIDDEN" | "INVALID_INPUT" | "CREATE_FAILED" };

/**
 * STEP 1 of the invitation workflow. Creates the profile with
 * `auth_user_id` NULL — a pending invitation, which is a documented and
 * legitimate state (five live profiles are already in it), not a failure.
 *
 * Writes a `user_invited` audit event atomically with the insert.
 */
export async function createStaffProfile(
  input: CreateStaffProfileInput
): Promise<CreateStaffProfileResult> {
  const outcome = await callRpc("create_staff_profile", {
    p_email: input.email,
    p_full_name: input.fullName,
    p_role: input.role,
    p_preferred_language: input.preferredLanguage,
    p_actor_profile_id: input.actorProfileId,
  });

  if (outcome.errorCode) {
    // profiles_email_key.
    if (outcome.errorCode === "23505") return { status: "error", code: "DUPLICATE_EMAIL" };
    // The RPC's own actor guard.
    if (outcome.errorCode === "42501") return { status: "error", code: "FORBIDDEN" };
    // Role / language vocabulary rejected inside the transaction.
    if (outcome.errorCode === "22023") return { status: "error", code: "INVALID_INPUT" };
    return { status: "error", code: "CREATE_FAILED" };
  }
  if (!outcome.profileId) return { status: "error", code: "CREATE_FAILED" };

  return { status: "ok", profileId: outcome.profileId };
}

export type LinkStaffProfileAuthResult =
  | { status: "ok" }
  | { status: "error"; code: "PROFILE_NOT_FOUND" | "FORBIDDEN" | "ALREADY_LINKED" | "LINK_FAILED" };

/**
 * STEP 3 of the invitation workflow: attach the Supabase Auth account that
 * step 2 actually created.
 *
 * NEVER MATCHES ON E-MAIL. Live inspection proved that a linked profile's
 * address and its auth account's address routinely differ in this project
 * (gabriel.herrera@odlfinancial.com is linked to gabriel.dev@odl.local), so
 * an e-mail join would link the wrong person or none at all. The auth UUID
 * returned by Supabase is the only authoritative key.
 *
 * Idempotent for the same auth user, so a failed step 3 is simply retried;
 * re-pointing a profile at a DIFFERENT account is refused as ALREADY_LINKED,
 * because that is an identity change, not a retry.
 */
export async function linkStaffProfileAuth(
  profileId: string,
  authUserId: string,
  actorProfileId: string
): Promise<LinkStaffProfileAuthResult> {
  const outcome = await callRpc("link_staff_profile_auth", {
    p_profile_id: profileId,
    p_auth_user_id: authUserId,
    p_actor_profile_id: actorProfileId,
  });

  if (outcome.errorCode) {
    if (outcome.errorCode === "42501") return { status: "error", code: "FORBIDDEN" };
    // 22023 = re-point attempt; 23505 = profiles_auth_user_id_key, i.e. this
    // auth account already belongs to another profile. Both are "this link
    // cannot be made" from the caller's point of view.
    if (outcome.errorCode === "22023" || outcome.errorCode === "23505") {
      return { status: "error", code: "ALREADY_LINKED" };
    }
    return { status: "error", code: "LINK_FAILED" };
  }
  if (!outcome.profileId) return { status: "error", code: "PROFILE_NOT_FOUND" };

  return { status: "ok" };
}

export type UpdateStaffRoleResult =
  | { status: "ok" }
  | {
      status: "error";
      code:
        | "PROFILE_NOT_FOUND"
        | "FORBIDDEN"
        | "INVALID_INPUT"
        /** Milestone 24A — the target is the last ACTIVE administrador, so
         * demoting them would leave the platform with none. */
        | "LAST_ADMINISTRATOR"
        | "UPDATE_FAILED";
    };

/** Changes a staff member's role. A same-role write succeeds and records no
 * event. Writes `user_role_changed` with the true previous value, read under
 * `for update` inside the transaction. */
export async function updateStaffRole(
  profileId: string,
  newRole: UserRole,
  actorProfileId: string
): Promise<UpdateStaffRoleResult> {
  const outcome = await callRpc("update_staff_role", {
    p_profile_id: profileId,
    p_new_role: newRole,
    p_actor_profile_id: actorProfileId,
  });

  if (outcome.errorCode) {
    if (outcome.errorCode === "42501") return { status: "error", code: "FORBIDDEN" };
    if (outcome.errorCode === "22023") return { status: "error", code: "INVALID_INPUT" };
    // 55000 = object_not_in_prerequisite_state. Deliberately distinct from
    // FORBIDDEN: the caller IS allowed to change roles and the arguments ARE
    // valid — the system simply cannot be left without an administrador.
    if (outcome.errorCode === "55000") return { status: "error", code: "LAST_ADMINISTRATOR" };
    return { status: "error", code: "UPDATE_FAILED" };
  }
  if (!outcome.profileId) return { status: "error", code: "PROFILE_NOT_FOUND" };

  return { status: "ok" };
}

export type SetStaffActiveStatusResult =
  | { status: "ok" }
  | {
      status: "error";
      code:
        | "PROFILE_NOT_FOUND"
        | "FORBIDDEN"
        | "CANNOT_DEACTIVATE_SELF"
        /** Milestone 24A — deactivating this profile would leave zero active
         * administradores, a state nothing in the product could recover from. */
        | "LAST_ADMINISTRATOR"
        | "UPDATE_FAILED";
    };

/**
 * The ONLY offboarding mechanism in this product — there is no deletion
 * path anywhere, by approved policy and because the schema would refuse it
 * (messages.sender_profile_id is ON DELETE RESTRICT).
 *
 * `active = false` is a hard access block, not a display flag:
 * getCurrentProfile() returns null for it, so the (app) layout redirects to
 * /login and every guarded Server Action refuses. The row and all its audit
 * attribution are retained permanently.
 *
 * The RPC refuses self-deactivation, which would otherwise let an
 * administrator lock themselves out with no in-product way back — and, as of
 * Milestone 24A, refuses ANY deactivation that would leave zero active
 * administradores, including one administrador deactivating another.
 */
export async function setStaffActiveStatus(
  profileId: string,
  active: boolean,
  actorProfileId: string
): Promise<SetStaffActiveStatusResult> {
  const outcome = await callRpc("set_staff_active_status", {
    p_profile_id: profileId,
    p_active: active,
    p_actor_profile_id: actorProfileId,
  });

  if (outcome.errorCode) {
    if (outcome.errorCode === "42501") return { status: "error", code: "FORBIDDEN" };
    if (outcome.errorCode === "22023") return { status: "error", code: "CANNOT_DEACTIVATE_SELF" };
    // 55000 = object_not_in_prerequisite_state (Milestone 24A). The caller is a
    // legitimate administrador and the arguments are valid — the platform just
    // cannot be left with zero active administradores.
    if (outcome.errorCode === "55000") return { status: "error", code: "LAST_ADMINISTRATOR" };
    return { status: "error", code: "UPDATE_FAILED" };
  }
  if (!outcome.profileId) return { status: "error", code: "PROFILE_NOT_FOUND" };

  return { status: "ok" };
}

/**
 * ============================================================================
 * MILESTONE 26B-6B — WHO PARTICIPATES IN AUTOMATIC DISTRIBUTION
 * ============================================================================
 *
 * Toggles one advisor in or out of the round-robin.
 *
 * A PLAIN COLUMN UPDATE, not a lifecycle transition. It changes who future
 * leads go to and nothing else: it does not touch existing ownership, does not
 * reassign anything already allocated, and does not affect the person's access
 * to the CRM. Someone removed from the rotation keeps every lead they already
 * hold, which is exactly what you want when covering a holiday.
 *
 * AUTHORIZATION IS THE CALLER'S JOB — the Server Action checks
 * `application:assign_advisor` before reaching this. This is the write.
 */
export type SetStaffAutoAssignmentResult =
  | { status: "ok" }
  | { status: "error"; code: "NOT_FOUND" | "FORBIDDEN" | "INVALID_INPUT" | "UPDATE_FAILED" };

export async function setStaffAutoAssignment(
  profileId: string,
  enabled: boolean,
  actorProfileId: string
): Promise<SetStaffAutoAssignmentResult> {
  const outcome = await callRpc("set_staff_auto_assignment", {
    p_profile_id: profileId,
    p_enabled: enabled,
    p_actor_profile_id: actorProfileId,
  });

  if (outcome.errorCode) {
    // Same mapping the sibling staff mutations use: 42501 is an authorization
    // refusal (inactive actor, or target outside the actor's branch scope),
    // 22023 is a rejected input (the target is not an advisor).
    if (outcome.errorCode === "42501") return { status: "error", code: "FORBIDDEN" };
    if (outcome.errorCode === "22023") return { status: "error", code: "INVALID_INPUT" };
    return { status: "error", code: "UPDATE_FAILED" };
  }
  if (!outcome.profileId) return { status: "error", code: "NOT_FOUND" };

  return { status: "ok" };
}
