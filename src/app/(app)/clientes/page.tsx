import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/shared/page-header";
import { ClientsTable } from "@/components/clients/clients-table";
import { getApplications } from "@/lib/services/applications";

export default async function ClientsPage() {
  const t = await getTranslations("clients");

  // Milestone 13F: per-client application counts now come from the real
  // Application Engine (filtered client-side by clientLegacyId, same
  // fallback-to-empty pattern as expedientes/[id]/page.tsx).
  const applicationsResult = await getApplications();
  const applications = applicationsResult.status === "ok" ? applicationsResult.applications : [];

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <ClientsTable applications={applications} />
    </div>
  );
}
