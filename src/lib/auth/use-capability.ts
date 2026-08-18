"use client";

import { useCurrentProfile } from "@/lib/auth/current-profile-context";
import { hasEffectiveCapability, type Capability } from "@/lib/auth/capabilities";

/**
 * Client-side read of the SAME canonical matrix the server enforces
 * (src/lib/auth/capabilities.ts) — never a parallel UI-only role table.
 * Milestone 16.
 *
 * WHAT THIS IS FOR: not rendering a control the current user could not
 * successfully use. That is a courtesy to the user, not a security
 * boundary. The security boundary is requireCapability() inside the Server
 * Action, which runs regardless of what the browser sends and cannot be
 * bypassed by editing the DOM, replaying a fetch, or calling the action
 * directly. Never "protect" an operation by hiding its button alone.
 *
 * MILESTONE 24: reads profile.capabilities — the EFFECTIVE set (base role
 * UNION per-user grants) resolved server-side once per request by
 * src/app/(app)/layout.tsx via getCurrentProfile(). So a delegated manager
 * sees exactly the controls their delegation actually permits, and the set
 * behind this check is the same one the Server Action re-checks — never
 * anything the client asserted about itself.
 *
 * @example
 *   const canManageProducts = useCapability("product:manage");
 *   {canManageProducts && <Button onClick={...}>Nuevo producto</Button>}
 */
export function useCapability(capability: Capability): boolean {
  const profile = useCurrentProfile();
  return hasEffectiveCapability(profile.capabilities, capability);
}
