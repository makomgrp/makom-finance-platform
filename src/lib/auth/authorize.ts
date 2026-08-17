import "server-only";
import { getCurrentProfile, type Profile } from "@/lib/auth/get-current-profile";
import { hasCapability, type Capability } from "@/lib/auth/capabilities";

/**
 * ============================================================================
 * ARCHITECTURAL RULE — THE MUTATION AUTHORIZATION BOUNDARY
 * ============================================================================
 *
 * Milestone 16 (Security Floor). Every exported Server Action in this app
 * begins with exactly one call to requireCapability(), before it validates
 * input, before it reads the database, before it touches anything. There is
 * no second way to authorize an operation and no action exempt from it
 * except the ones listed under "Deliberately outside this layer" below.
 *
 * This does NOT replace getCurrentProfile() — it wraps it. Identity
 * resolution stays exactly where Milestone 5 put it: getCurrentProfile()
 * remains the single identity resolver, and requireCapability() hands its
 * result straight back to the caller so an action still attributes its
 * writes to `profile.id` exactly as before. Because getCurrentProfile() is
 * wrapped in React's cache(), calling requireCapability() costs no extra
 * session or database round-trip within a request.
 *
 * DELIBERATELY OUTSIDE THIS LAYER (Milestone 16 scope decision):
 *   - src/lib/auth/actions.ts — signIn/signOut/password reset/update.
 *     These ESTABLISH identity; requiring a capability to sign in would be
 *     circular. They carry their own hardened checks (see that file).
 *   - src/actions/locale.ts#setLocale — writes a cookie for the caller's own
 *     browser. Touches no business data and no other user.
 *   - src/app/api/public/application-intake — an unauthenticated public
 *     intake endpoint by design, with its own separate validation path.
 *
 * ORDERING RULE: authorize FIRST, validate second. Running validation (or a
 * client-existence lookup, as createDossierNote used to) ahead of the
 * capability check would let an unauthorized caller distinguish
 * INVALID_INPUT from CLIENT_NOT_FOUND and probe for the existence of
 * records they may not touch. Every guarded action therefore returns
 * FORBIDDEN before it reveals anything about its arguments.
 */

/**
 * The outcome of an authorization check.
 *
 * "unauthenticated" and "forbidden" are kept distinct because the two mean
 * genuinely different things to a caller: the first is recoverable by
 * signing in (and the UI should route to /login), the second never is (the
 * UI should surface a permissions message). Neither carries any detail
 * about WHICH capability was missing, what roles hold it, or anything about
 * the requested record — an authorization failure must not become an
 * information-disclosure channel.
 */
export type AuthorizationResult =
  | { status: "authorized"; profile: Profile }
  | { status: "denied"; code: "UNAUTHENTICATED" | "FORBIDDEN" };

/**
 * The single server-side authorization gate.
 *
 * Resolves the caller through getCurrentProfile() — which already fails
 * closed for no session, no linked profile, and business-deactivated
 * (`active = false`) profiles alike — then checks the resolved role against
 * the canonical matrix in src/lib/auth/capabilities.ts.
 *
 * Fails closed on infrastructure error: if getCurrentProfile() throws (the
 * database is unreachable), this returns UNAUTHENTICATED rather than
 * propagating. A Server Action must not 500 on a transient read failure in
 * its guard, and "we could not prove you may do this" must never resolve to
 * "go ahead."
 *
 * @example
 *   const auth = await requireCapability("client:create");
 *   if (auth.status === "denied") return { status: "error", code: auth.code };
 *   // auth.profile is the same Profile getCurrentProfile() would return.
 */
export async function requireCapability(capability: Capability): Promise<AuthorizationResult> {
  let profile: Profile | null;

  try {
    profile = await getCurrentProfile();
  } catch (error) {
    console.error(
      "[authorize] getCurrentProfile threw while checking a capability:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "denied", code: "UNAUTHENTICATED" };
  }

  if (!profile) {
    return { status: "denied", code: "UNAUTHENTICATED" };
  }

  if (!hasCapability(profile.role, capability)) {
    // Logged with role + capability for operability; the CALLER is told only
    // "FORBIDDEN" — never which capability was missing or who holds it.
    console.error(
      `[authorize] denied: role "${profile.role}" lacks capability "${capability}".`
    );
    return { status: "denied", code: "FORBIDDEN" };
  }

  return { status: "authorized", profile };
}
