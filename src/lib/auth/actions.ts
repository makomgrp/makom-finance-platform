"use server";

import { headers } from "next/headers";
import { createAuthenticatedServerClient } from "@/lib/supabase/server-authenticated";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";

/**
 * Real Supabase Auth Server Actions: sign in, sign out, request a password
 * reset, and set a new password. Every one of these runs only through the
 * Authenticated Server Client (@/lib/supabase/server-authenticated) — never
 * the Admin Client, never SUPABASE_SECRET_KEY. Identity is always derived
 * from the session these actions themselves establish; none of them accept
 * a user id, profile id, or role from the caller.
 *
 * Note for other Server Actions in this app (see Milestone 4's Auth
 * migration plan entry): the route protection added in Milestone 4
 * (proxy.ts + src/app/(app)/layout.tsx) guarantees a caller has a valid
 * session + active profile to reach a page at all — it does NOT
 * automatically make every Server Action on that page verify who's
 * calling it. Actions that still accept a client-supplied identity (e.g.
 * src/app/(app)/chat/actions.ts as of this milestone) must independently
 * call getCurrentProfile() before Milestone 5 is considered complete.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// ============================================================================
// signInAction
// ============================================================================

export interface SignInInput {
  email: string;
  password: string;
}

export type SignInResult =
  | { status: "success" }
  | { status: "error"; code: "INVALID_INPUT" | "ACCESS_DENIED" };

/**
 * Signs in with email + password, then immediately verifies the result
 * through getCurrentProfile() — the only source of truth for "is this a
 * usable CRM identity." A technically valid Supabase login is not enough on
 * its own: no linked profile, or a profile with active = false, is treated
 * exactly like a failed login, and the Supabase session is torn back down
 * (signOut) so nothing valid is left sitting in a cookie for an account the
 * app has decided not to trust.
 *
 * The two failure branches (bad credentials vs. "valid credentials, no
 * usable profile") are intentionally NOT distinguished in the response —
 * both come back as the same ACCESS_DENIED code, so nothing about whether
 * an email/password pair happened to be technically correct leaks to the
 * caller. The specific reason is only ever logged server-side, by message,
 * never with any token/cookie/session data.
 */
export async function signInAction(input: SignInInput): Promise<SignInResult> {
  const email = isNonEmptyString(input.email) ? input.email.trim() : "";
  const password = isNonEmptyString(input.password) ? input.password : "";

  if (!EMAIL_PATTERN.test(email) || password.length === 0) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const supabase = await createAuthenticatedServerClient();

  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) {
    console.error("[auth actions] signInWithPassword failed:", signInError.message);
    return { status: "error", code: "ACCESS_DENIED" };
  }

  let profile;
  try {
    profile = await getCurrentProfile();
  } catch (error) {
    console.error(
      "[auth actions] getCurrentProfile threw right after sign-in:",
      error instanceof Error ? error.message : "unknown error"
    );
    await supabase.auth.signOut();
    return { status: "error", code: "ACCESS_DENIED" };
  }

  if (!profile) {
    // Valid Supabase credentials, but no usable CRM identity (no linked
    // profile, or active = false) — reject exactly like bad credentials,
    // and don't leave the Supabase session behind.
    console.error(
      "[auth actions] sign-in succeeded but getCurrentProfile() returned null — access denied."
    );
    await supabase.auth.signOut();
    return { status: "error", code: "ACCESS_DENIED" };
  }

  return { status: "success" };
}

// ============================================================================
// signOutAction
// ============================================================================

/**
 * Clears the real Supabase session server-side. The demo-session
 * compatibility flag is NOT cleared here — that's a browser-only concern
 * the client-side caller (Topbar) still owns for now; see the temporary
 * bridge note in src/app/login/page.tsx.
 */
export async function signOutAction(): Promise<void> {
  const supabase = await createAuthenticatedServerClient();
  const { error } = await supabase.auth.signOut();
  if (error) {
    console.error("[auth actions] signOut failed:", error.message);
  }
}

// ============================================================================
// requestPasswordResetAction
// ============================================================================

export interface RequestPasswordResetInput {
  email: string;
}

export interface RequestPasswordResetResult {
  status: "success";
}

/**
 * Always resolves to the same success result, regardless of whether the
 * address is well-formed, whether it matches a real account, or whether
 * the send itself succeeds — this is deliberate, not a missing error path.
 * Distinguishing any of those cases in the response would let a caller
 * enumerate which emails have accounts, which is exactly what this must
 * not do. Failures are only ever logged server-side, by message.
 */
export async function requestPasswordResetAction(
  input: RequestPasswordResetInput
): Promise<RequestPasswordResetResult> {
  const email = isNonEmptyString(input.email) ? input.email.trim() : "";

  if (EMAIL_PATTERN.test(email)) {
    try {
      const origin = (await headers()).get("origin");
      if (origin) {
        const supabase = await createAuthenticatedServerClient();
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${origin}/auth/callback?next=/reset-password`,
        });
        if (error) {
          console.error("[auth actions] resetPasswordForEmail failed:", error.message);
        }
      } else {
        console.error("[auth actions] resetPasswordForEmail skipped: no origin header on request");
      }
    } catch (error) {
      console.error(
        "[auth actions] resetPasswordForEmail threw:",
        error instanceof Error ? error.message : "unknown error"
      );
    }
  }

  return { status: "success" };
}

// ============================================================================
// updatePasswordAction
// ============================================================================

export interface UpdatePasswordInput {
  password: string;
  confirmPassword: string;
}

export type UpdatePasswordResult =
  | { status: "success" }
  | { status: "error"; code: "INVALID_INPUT" | "UPDATE_FAILED" };

/**
 * Sets a new password for whichever session is currently established —
 * expected to be the short-lived recovery session created by
 * /auth/callback after the user clicks their reset-password email link.
 * If no valid session exists (expired/already-used link, direct
 * navigation without going through the email flow), Supabase's own
 * updateUser call fails and this returns UPDATE_FAILED — a natural
 * consequence of calling an authenticated-only method with no session,
 * not a route-protection check added by this action.
 */
export async function updatePasswordAction(
  input: UpdatePasswordInput
): Promise<UpdatePasswordResult> {
  const password = isNonEmptyString(input.password) ? input.password : "";
  const confirmPassword = typeof input.confirmPassword === "string" ? input.confirmPassword : "";

  if (password.length < MIN_PASSWORD_LENGTH || password !== confirmPassword) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const supabase = await createAuthenticatedServerClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    console.error("[auth actions] updateUser (password) failed:", error.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }

  return { status: "success" };
}
