import { getTranslations } from "next-intl/server";
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
export default async function AlertasPage() {
  const t = await getTranslations("alertsModule");
  const alertsResult = await getAllAlerts();
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
