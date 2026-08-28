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

/**
 * ============================================================================
 * MILESTONE 26B-21 — HAS THIS PERSON ACTUALLY FINISHED SIGNING UP?
 * ============================================================================
 *
 * `profiles` cannot answer this. It records that an invitation was SENT and
 * linked — `auth_user_id` is set the moment `inviteUserByEmail` succeeds — but
 * it has no idea whether the person ever opened the email. Two administrators
 * invited on 26 August therefore appeared in Users as "Activo" while holding no
 * password and having never signed in, which told an administrator the opposite
 * of the truth about who can actually get in.
 *
 * The answer lives in Auth, and only the Admin API can read it. This is the one
 * place that asks.
 *
 * ----------------------------------------------------------------------------
 * WHY `email_confirmed_at` IS THE SIGNAL
 * ----------------------------------------------------------------------------
 * An invited user is created unconfirmed and with no password. Confirmation is
 * set by GoTrue at exactly one moment: when the invite token is verified, which
 * is the same request in which the person chooses their password. So a non-null
 * `email_confirmed_at` means the invitation was opened AND completed — it
 * cannot be true for someone who merely received the email.
 *
 * `last_sign_in_at` is read too, but as corroboration rather than the test. It
 * is also set during that verification, so on its own it would say the same
 * thing; keeping both means a future auth flow that confirms without signing in
 * (or the reverse) still resolves to "finished" rather than silently regressing
 * everyone to pending.
 *
 * NOT the password column: the Admin API does not expose it, and reading
 * `auth.users` directly from the application would bypass the boundary that
 * keeps auth internals behind `service_role`.
 */
export interface StaffAuthOnboarding {
  /** The invitation was opened and completed. */
  completed: boolean;
}

/**
 * Onboarding state for a set of auth users, keyed by auth user id.
 *
 * A LOOKUP FAILURE IS NOT "PENDING". If Auth cannot be reached, the id is
 * simply absent from the map and the caller keeps its existing behaviour —
 * telling an administrator that a working colleague never signed up, because a
 * network call failed, would be worse than saying nothing new.
 */
export async function getStaffAuthOnboarding(
  authUserIds: string[]
): Promise<Record<string, StaffAuthOnboarding>> {
  if (authUserIds.length === 0) return {};

  const supabase = getSupabaseServerClient();
  const entries = await Promise.all(
    authUserIds.map(async (id) => {
      try {
        const { data, error } = await supabase.auth.admin.getUserById(id);
        if (error || !data?.user) {
          console.error("[auth-admin service] getUserById failed for a staff profile.");
          return null;
        }
        const user = data.user;
        return [
          id,
          { completed: Boolean(user.email_confirmed_at) || Boolean(user.last_sign_in_at) },
        ] as const;
      } catch {
        console.error("[auth-admin service] getUserById threw for a staff profile.");
        return null;
      }
    })
  );

  return Object.fromEntries(entries.filter((e): e is NonNullable<typeof e> => e !== null));
}
