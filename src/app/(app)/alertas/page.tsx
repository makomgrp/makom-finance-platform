import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/shared/page-header";
import { AlertsSummary } from "@/components/alerts/alerts-summary";
import { AlertsTable } from "@/components/alerts/alerts-table";

export default async function AlertasPage() {
  const t = await getTranslations("alertsModule");

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <div className="space-y-4">
        <AlertsSummary />
        <AlertsTable />
      </div>
    </div>
  );
}
