import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { CurrentProfileProvider } from "@/lib/auth/current-profile-context";

/**
 * Milestone 4: the authoritative access-control boundary for the entire
 * authenticated CRM — not AppShell (see app-shell.tsx, whose auth-gating
 * responsibility was removed this milestone) and not proxy.ts (which only
 * catches the cheap "no session at all" case as a fast outer gate).
 *
 * getCurrentProfile() already encodes all three requirements at once — a
 * valid Supabase Auth session, a linked profiles row, and active = true —
 * so a null result covers every "not allowed" case uniformly (no session,
 * no linked profile, or active = false) without needing to check any of
 * them separately here.
 *
 * A Server Component, so this runs before anything under (app) renders on
 * every request — there is no client-side window where protected content
 * is sent to the browser before an auth check has run.
 *
 * Milestone 5A: this is also the ONE place getCurrentProfile() is called
 * for display purposes — the result is handed to CurrentProfileProvider,
 * which makes it available to every client component under AppShell
 * (Topbar, Sidebar, MobileNav, Settings > Profile) via useCurrentProfile().
 * Nothing downstream queries profiles or calls getCurrentProfile() again.
 */
export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  return (
    <CurrentProfileProvider profile={profile}>
      <AppShell>{children}</AppShell>
    </CurrentProfileProvider>
  );
}
