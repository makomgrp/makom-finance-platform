import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { getActiveAlertsCount } from "@/lib/services/alerts";
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
 *
 * Milestone 7B: the same pattern now applies to the Topbar's active-alert
 * badge — resolved here, server-side, using the Admin Client (never
 * exposed to the browser), and passed down as a plain prop through
 * AppShell to Topbar. This is the "cleanest pattern" call: a Context
 * would be overkill for a value only Topbar reads (unlike the profile,
 * which Topbar/Sidebar/MobileNav/Settings all need), so a prop is simpler
 * and sufficient. Like the profile, this is resolved once per server
 * render, not live-updated — consistent with no Realtime being
 * introduced for alerts.
 *
 * MILESTONE 18: the Topbar's bell dropdown used to list three hardcoded
 * notifications about demo clients while the badge beside them showed a
 * REAL count — the worst possible combination, since the true number lent
 * credibility to invented content. The dropdown is gone entirely and the
 * bell is now a link to /alertas carrying only the count.
 *
 * The count STAYS on getActiveAlertsCount(), the existing single-purpose
 * service — deliberately not getAllAlerts(). Nothing in the app shell
 * needs individual alert rows any more, so fetching them would be both
 * wasteful and, more importantly, a temptation to render them: the
 * currently persisted alerts are seeded fixtures, and an aggregate count
 * over them is honest where a per-record narrative would not be. One
 * query, one number, no per-record data leaving the alerts module.
 */
export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/login");
  }

  // Returns null (never a fabricated 0) when the read fails, in which
  // case Topbar simply renders no badge.
  const activeAlertsCount = await getActiveAlertsCount();

  return (
    <CurrentProfileProvider profile={profile}>
      <AppShell activeAlertsCount={activeAlertsCount}>{children}</AppShell>
    </CurrentProfileProvider>
  );
}
