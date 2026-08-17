import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * ============================================================================
 * SUPABASE AUTH ADMIN — SERVER-ONLY, AND DELIBERATELY TINY (Milestone 21)
 * ============================================================================
 *
 * The `auth.admin` API runs with the project's secret key and can create,
 * modify and delete authentication accounts. This module is the ONLY place
 * in the codebase allowed to touch it, and it exposes exactly one operation:
 * sending an invitation.
 *
 * `import "server-only"` plus `getSupabaseServerClient()` (the sole holder of
 * SUPABASE_SECRET_KEY, itself `server-only`) guarantee this can never reach
 * the browser. No secret is read here directly, none is passed as a
 * parameter, and nothing in this file is importable from a Client Component.
 *
 * ----------------------------------------------------------------------------
 * WHAT IS DELIBERATELY *NOT* HERE
 * ----------------------------------------------------------------------------
 *   deleteUser      — Milestone 21's approved policy is deactivate-only.
 *                     No deletion path exists anywhere in the product.
 *   createUser      — an admin-set password would have to be conveyed
 *                     out-of-band; the invitation flow lets the person set
 *                     their own and is the approved onboarding route.
 *   updateUserById  — nothing in this milestone changes an auth account.
 *   password / MFA  — password reset already works through the existing
 *                     public flow (requestPasswordResetAction →
 *                     resetPasswordForEmail); MFA is out of scope.
 *
 * ----------------------------------------------------------------------------
 * WHY THIS CANNOT BE ATOMIC WITH THE PROFILE
 * ----------------------------------------------------------------------------
 * Supabase Auth lives outside `public` and outside any transaction a
 * PL/pgSQL function can join. No RPC, trigger or transaction can make an
 * Auth call and a `profiles` write commit together, and this module does not
 * pretend otherwise. The orchestration is staged so that every failure lands
 * in a state that is valid and recoverable rather than orphaned — see
 * inviteStaffUser in src/app/(app)/configuracion/actions.ts.
 */

export type InviteStaffAuthUserResult =
  | { status: "ok"; authUserId: string }
  | { status: "error"; code: "ALREADY_REGISTERED" | "INVITE_FAILED"; message?: string };

/**
 * Sends a Supabase invitation e-mail and returns the auth account's UUID.
 *
 * THE RETURNED UUID IS THE ONLY AUTHORITATIVE LINK KEY. Live inspection of
 * this project found that a profile's e-mail and its linked auth account's
 * e-mail routinely differ, so the caller must link with this value and must
 * never re-derive it by matching addresses.
 *
 * `redirectTo` points at the same `/auth/callback` route the existing
 * password-reset flow already uses, so the invited user lands on
 * /reset-password to choose their own password — no temporary secret is ever
 * created, transmitted or stored.
 */
export async function inviteStaffAuthUser(
  email: string,
  origin: string
): Promise<InviteStaffAuthUserResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${origin}/auth/callback?next=/reset-password`,
    });

    if (error) {
      console.error("[auth-admin service] inviteUserByEmail failed:", error.message);
      // Supabase reports an existing account through the message/status
      // rather than a stable code; treated as a distinct, actionable outcome
      // because the recovery differs (link the existing account instead of
      // creating one).
      const alreadyRegistered =
        error.status === 422 || /already been registered|already exists/i.test(error.message);
      return {
        status: "error",
        code: alreadyRegistered ? "ALREADY_REGISTERED" : "INVITE_FAILED",
        message: error.message,
      };
    }

    if (!data?.user?.id) {
      console.error("[auth-admin service] inviteUserByEmail returned no user id.");
      return { status: "error", code: "INVITE_FAILED" };
    }

    return { status: "ok", authUserId: data.user.id };
  } catch (error) {
    console.error(
      "[auth-admin service] Unexpected failure inviting a staff user:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error", code: "INVITE_FAILED" };
  }
}
