import { getTranslations } from "next-intl/server";
import { EMPTY_BRANCH_SCOPE } from "@/lib/services/branch-scope-query";
import { resolveBranchViewScope } from "@/lib/services/branch-view-context";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { PageHeader } from "@/components/shared/page-header";
import { AlertsSummary } from "@/components/alerts/alerts-summary";
import { AlertsTable } from "@/components/alerts/alerts-table";
import { getAllAlerts } from "@/lib/services/alerts";

/**
 * Milestone 7B: fetches every dossier_alerts row once here (getAllAlerts()
 * is wrapped in React's cache(), so AlertsSummary computing its own counts
 * from the same call below doesn't issue a second query) and passes the
 * result down to both children as props — neither fetches independently
 * anymore. No fallback to demo data on failure; both children receive an
 * explicit loadError flag instead.
 */
export default async function AlertasPage({ searchParams }: { searchParams: Promise<{ sucursal?: string }> }) {
  const t = await getTranslations("alertsModule");
  // MILESTONE 25B-1 — effective branch scope, resolved server-side ONCE by
  // getCurrentProfile() (cached per request) and passed explicitly to every
  // scoped read. Services never resolve scope themselves, and the client never
  // supplies it. The (app) layout has already guaranteed an active profile.
  const profile = await getCurrentProfile();
  // MILESTONE 25C-1 — VIEW CONTEXT. `scope` below is no longer the caller's
  // authorized scope directly: it is the INTERSECTION of that scope with the
  // branch they are currently viewing. resolveBranchViewScope() can only ever
  // narrow — an unreachable, inactive, unknown or stale `?sucursal=` silently
  // falls back to their authorized default, with no error and no signal about
  // whether that branch exists. Everything downstream keeps receiving one
  // server-resolved BranchScope and is unchanged.
  const { sucursal } = await searchParams;
  const { viewScope: scope } = await resolveBranchViewScope(
    profile?.branchScope ?? EMPTY_BRANCH_SCOPE,
    sucursal
  );

  const alertsResult = await getAllAlerts(scope);
  const alerts = alertsResult.status === "ok" ? alertsResult.alerts : [];
  const loadError = alertsResult.status === "error";

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="space-y-4">
        <AlertsSummary alerts={alerts} loadError={loadError} />
        <AlertsTable initialAlerts={alerts} loadError={loadError} />
      </div>
    </div>
  );
}
