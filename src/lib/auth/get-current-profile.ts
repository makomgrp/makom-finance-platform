import "server-only";
import { cache } from "react";
import { createAuthenticatedServerClient } from "@/lib/supabase/server-authenticated";
import { resolveEffectiveCapabilities, type Capability } from "@/lib/auth/capabilities";
import type { BranchScope, BranchScopeMode, SupportedLanguage, UserRole } from "@/types";

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
 * Settings > Profile, via src/lib/auth/current-profile-context.tsx),
 * chat's acting-user identity (Milestone 5B — chat/actions.ts,
 * chat/page.tsx), and dossier write-attribution display (Milestone 5C —
 * notes, documents, alerts tabs, via useCurrentProfile()) all consume this
 * resolver. Those dossier writes remain local/in-memory only — no
 * Supabase-backed persistence exists yet for notes, documents, or alerts;
 * see the Auth migration plan for when that backend work is scheduled.
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
  /**
   * MILESTONE 24 — the SERVER-RESOLVED effective capability set:
   * ROLE_CAPABILITIES[role] UNION this profile's persisted per-user grants.
   *
   * This is what requireCapability() enforces and what useCapability() reads.
   * It is computed here and nowhere else, so a hidden button and a rejected
   * Server Action can never disagree.
   *
   * SAFE TO SEND TO THE BROWSER. It is a policy list, not a secret — the
   * static ROLE_CAPABILITIES matrix already ships to the client — and the
   * client can only READ it. Every mutation is still re-authorized
   * server-side against this same field on a freshly resolved Profile, so
   * tampering with the copy in the browser changes nothing.
   */
  capabilities: Capability[];
  /**
   * MILESTONE 25A — the SERVER-RESOLVED branch scope: which branches this
   * person may act on.
   *
   * THE THIRD AUTHORIZATION AXIS. Role answers "what kind of work", capabilities
   * answer "which actions", and this answers "on whose data". The three stay
   * independent — a capability is never a branch, and branch reach is never a
   * capability.
   *
   * RESOLVED BUT NOT YET ENFORCED. Milestone 25A deliberately applies this to
   * nothing: no read is filtered and no mutation is branch-checked, so the CRM
   * behaves exactly as it did in Milestone 24. It is resolved here now so that
   * Milestone 25B is a pure enforcement change rather than enforcement plus
   * plumbing.
   *
   * Safe to send to the browser for the same reason `capabilities` is: it is a
   * policy statement the client can only read, and every mutation is re-checked
   * server-side against a freshly resolved Profile.
   */
  branchScope: BranchScope;
}

interface ProfileRow {
  id: string;
  full_name: string;
  email: string;
  role: string;
  preferred_language: string;
  avatar_url: string | null;
  active: boolean;
  branch_scope_mode: string;
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
    .select("id, full_name, email, role, preferred_language, avatar_url, active, branch_scope_mode")
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

  // MILESTONE 24 — per-user grants, read through the SAME authenticated
  // (RLS-scoped) client as the profile itself. profile_capability_grants
  // carries one policy allowing a signed-in user to read only their OWN rows,
  // mirroring profiles_select_own. No admin client, no privilege escalation to
  // resolve one's own permissions.
  //
  // FAILS CLOSED TO BASE ROLE, NEVER OPEN. If this read errors, the user keeps
  // exactly the capabilities their role grants and loses only delegated
  // extras. Throwing would take authorization down for a user whose base role
  // is perfectly valid; defaulting to "assume the grants" would be an
  // escalation on a database hiccup. Degrading to the role matrix is the only
  // safe direction.
  let grantedCapabilities: string[] = [];
  const { data: grantRows, error: grantsError } = await supabase
    .from("profile_capability_grants")
    .select("capability")
    .eq("profile_id", row.id);

  if (grantsError) {
    console.error(
      "[getCurrentProfile] capability grants query failed; falling back to base role capabilities:",
      grantsError.message
    );
  } else {
    grantedCapabilities = (grantRows ?? []).map((grant) => (grant as { capability: string }).capability);
  }

  // MILESTONE 25A — branch scope, read through the SAME authenticated
  // (RLS-scoped) client as the profile and the capability grants.
  // profile_branch_memberships carries one policy allowing a signed-in user to
  // read only their OWN rows, mirroring profiles_select_own. Resolving your own
  // scope must never require privilege escalation.
  //
  // FAILS CLOSED TO AN EMPTY SCOPE, NEVER OPEN TO NATIONAL. If this read
  // errors, the user is treated as reaching no branches at all. Defaulting the
  // other way would turn a database hiccup into organization-wide access.
  //
  // 'national' short-circuits the membership list entirely: it means "every
  // active branch, including ones created tomorrow", which an enumerated array
  // could not express without a backfill on every branch creation.
  // ==========================================================================
  // MILESTONE 25B-1 — THE ADMINISTRADOR NATIONAL INVARIANT
  // ==========================================================================
  // role = 'administrador'  =>  effective operational branch scope is NATIONAL.
  //
  // A SYSTEM-LEVEL RULE, resolved HERE and nowhere else. An administrador must
  // see and operate across every ODL branch — present and future — and must
  // NOT need memberships to do it, so this is derived from the ROLE, never
  // from rows.
  //
  // WHY NOT AUTO-CREATED MEMBERSHIPS: they would make the invariant look
  // membership-derived, need a backfill on every new branch, and drag
  // administradores inside the B1/B2 subset rules that exist to bound
  // DELEGATED managers.
  //
  // WHY NOT A CAPABILITY: national reach would then be grantable through
  // profile_capability_grants, letting DATA SCOPE be widened by a mechanism
  // built for ACTION permissions. `branch:manage` and `branch:transfer` confer
  // no visibility whatsoever — delegating an action never delegates scope.
  const declaredMode = (row.branch_scope_mode as BranchScopeMode) ?? "branch";
  const resolvedRole = row.role as UserRole;
  const scopeMode: BranchScopeMode =
    resolvedRole === "administrador" ? "national" : declaredMode;
  let branchIds: string[] = [];

  if (scopeMode === "branch") {
    const { data: membershipRows, error: membershipsError } = await supabase
      .from("profile_branch_memberships")
      .select("branch_id")
      .eq("profile_id", row.id);

    if (membershipsError) {
      console.error(
        "[getCurrentProfile] branch membership query failed; falling back to an EMPTY branch scope:",
        membershipsError.message
      );
    } else {
      branchIds = (membershipRows ?? []).map((m) => (m as { branch_id: string }).branch_id);
    }
  }

  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    role: row.role as UserRole,
    preferredLanguage: row.preferred_language as SupportedLanguage,
    avatarUrl: row.avatar_url,
    active: row.active,
    capabilities: resolveEffectiveCapabilities(row.role as UserRole, grantedCapabilities),
    branchScope: { mode: scopeMode, branchIds },
  };
});
