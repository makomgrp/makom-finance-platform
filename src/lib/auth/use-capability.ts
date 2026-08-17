"use client";

import { useCurrentProfile } from "@/lib/auth/current-profile-context";
import { hasCapability, type Capability } from "@/lib/auth/capabilities";

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
 * Reads the role from useCurrentProfile(), which src/app/(app)/layout.tsx
 * resolves server-side once per request — so the role behind this check is
 * the same server-resolved role the action will check, not anything the
 * client asserted about itself.
 *
 * @example
 *   const canManageProducts = useCapability("product:manage");
 *   {canManageProducts && <Button onClick={...}>Nuevo producto</Button>}
 */
export function useCapability(capability: Capability): boolean {
  const profile = useCurrentProfile();
  return hasCapability(profile.role, capability);
}
