"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Profile } from "@/lib/auth/get-current-profile";

/**
 * Client-side access to the current authenticated profile — resolved
 * exactly once, server-side, by src/app/(app)/layout.tsx via
 * getCurrentProfile(), and provided to the entire client tree from there.
 * No client component may call getCurrentProfile() itself or query
 * profiles directly (see the architectural rule in get-current-profile.ts)
 * — this context is the only supported way to read the current user's
 * display identity client-side.
 *
 * Non-nullable by design: by the time any consumer of this context
 * renders, src/app/(app)/layout.tsx has already guaranteed a valid,
 * active profile exists — redirecting to /login otherwise, before
 * AppShell (and everything inside it) ever mounts. Consumers must not add
 * their own null checks, loading states, or redirects for this; that
 * stays the layout's exclusive responsibility (see Milestone 4).
 */
const CurrentProfileContext = createContext<Profile | null>(null);

export function CurrentProfileProvider({
  profile,
  children,
}: {
  profile: Profile;
  children: ReactNode;
}) {
  return (
    <CurrentProfileContext.Provider value={profile}>{children}</CurrentProfileContext.Provider>
  );
}

export function useCurrentProfile(): Profile {
  const profile = useContext(CurrentProfileContext);
  if (!profile) {
    throw new Error("useCurrentProfile debe usarse dentro de CurrentProfileProvider");
  }
  return profile;
}
