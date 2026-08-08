import "server-only";
import { cache } from "react";
import { createAuthenticatedServerClient } from "@/lib/supabase/server-authenticated";
import type { SupportedLanguage, UserRole } from "@/types";

/**
 * ============================================================================
 * ARCHITECTURAL RULE — READ BEFORE ADDING A NEW IDENTITY LOOKUP ANYWHERE ELSE
 * ============================================================================
 *
 * getCurrentProfile() is the ONLY approved server-side way for application
 * code to resolve "who is the current user." No module — Dashboard, Chat,
 * Clientes, Expedientes, Documentos, Alertas, Notas, Auditoría, Settings, or
 * any future module — may independently query
 * `profiles where auth_user_id = auth.uid()` (or equivalent). If a module
 * needs the current user, it imports and calls this function. Duplicating
 * this resolution elsewhere is an architecture violation, not a style
 * preference: it's the one place the "active" business-deactivation check
 * (see step 6 below) is guaranteed to be applied, and the one place that can
 * change (e.g. caching, additional checks) without hunting down every copy.
 *
 * Status: route protection (Milestone 4 — proxy.ts + src/app/(app)/layout.tsx),
 * shell/display identity (Milestone 5A — Topbar, Sidebar, MobileNav,
 * Settings > Profile, via src/lib/auth/current-profile-context.tsx), and
 * chat's acting-user identity (Milestone 5B — chat/actions.ts,
 * chat/page.tsx) all consume this resolver. Other write-attribution
 * modules (dossier notes, documents, alerts) still use CURRENT_USER/legacy
 * ids — see the Auth migration plan for when each is scheduled to adopt
 * this resolver.
 *
 * Wrapped in React's cache() (below) so multiple call sites within the same
 * request (e.g. the (app) layout AND chat/page.tsx, both Server Components
 * rendered in the same request tree) share one actual session/DB lookup
 * instead of repeating it — call this freely wherever the current profile
 * is needed server-side; do not thread it through props "to avoid an extra
 * call" instead.
 */

/**
 * The normalized shape every server-side consumer gets back — deliberately
 * narrow. Never includes auth internals (tokens, session objects, provider
 * metadata) — those have no reason to leave this module.
 */
export interface Profile {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  preferredLanguage: SupportedLanguage;
  avatarUrl: string | null;
  active: boolean;
}

interface ProfileRow {
  id: string;
  full_name: string;
  email: string;
  role: string;
  preferred_language: string;
  avatar_url: string | null;
  active: boolean;
}

/**
 * Resolves the current authenticated user's profile.
 *
 * Flow: Supabase Auth session (from cookies, via the Authenticated Server
 * Client — never the Admin Client) → auth user → profiles.auth_user_id →
 * profile.
 *
 * Returns `null` for every *expected* "no usable identity" state — no
 * session, no linked profile, or a profile that's been business-deactivated
 * (`active = false`). These are normal, common outcomes (most requests are
 * unauthenticated today, since nothing issues real sessions yet), not
 * errors, so callers should treat `null` as "render as signed-out," not
 * catch it as a failure.
 *
 * Throws a generic Error only for genuine infrastructure failures (e.g. the
 * database is unreachable) — never for a missing or inactive identity.
 */
export const getCurrentProfile = cache(async (): Promise<Profile | null> => {
  const supabase = await createAuthenticatedServerClient();

  // getUser() re-validates the session against the Auth server rather than
  // trusting whatever cookie is present — the correct call for anything
  // that establishes identity, unlike getSession(). Any failure here (no
  // cookie, expired session, invalid token) is a normal "not signed in"
  // outcome, not an infrastructure error — fails closed to null rather than
  // throwing.
  const { data: authData, error: authError } = await supabase.auth.getUser();

  if (authError || !authData.user) {
    return null;
  }

  const { data, error: profileError } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, preferred_language, avatar_url, active")
    .eq("auth_user_id", authData.user.id)
    .maybeSingle();

  if (profileError) {
    // A real query failure with a known-valid auth user — infrastructure
    // problem, not an identity outcome. Message only, never the query
    // result or any cookie/token/session data.
    console.error("[getCurrentProfile] profiles query failed:", profileError.message);
    throw new Error("Failed to resolve the current profile.");
  }

  if (!data) {
    // Valid session, but no profiles row links back to it yet (e.g. an
    // Auth account that was never linked, or was unlinked).
    return null;
  }

  const row = data as ProfileRow;

  if (!row.active) {
    // Business-level deactivation — must block exactly like "no identity,"
    // even though the Auth credentials themselves are still technically
    // valid. This is the one place that guarantee is enforced.
    return null;
  }

  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    role: row.role as UserRole,
    preferredLanguage: row.preferred_language as SupportedLanguage,
    avatarUrl: row.avatar_url,
    active: row.active,
  };
});
