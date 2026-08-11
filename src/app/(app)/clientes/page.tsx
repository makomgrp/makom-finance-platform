import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/shared/page-header";
import { ClientsTable } from "@/components/clients/clients-table";
import { getApplications } from "@/lib/services/applications";
import { getClients } from "@/lib/services/clients";

export default async function ClientsPage() {
  const t = await getTranslations("clients");

  // Milestone 14C: the client list itself now comes from the real Client
  // Engine (src/lib/services/clients.ts#getClients()) — replaces the demo
  // CLIENTS array this page used to seed ClientsTable from.
  const [clientsResult, applicationsResult] = await Promise.all([getClients(), getApplications()]);
  const clients = clientsResult.status === "ok" ? clientsResult.clients : [];

  // Milestone 13F: per-client application counts still come from the real
  // Application Engine (Milestone 14E: matched client-side by the real
  // application.clientId === client.id relationship).
  const applications = applicationsResult.status === "ok" ? applicationsResult.applications : [];

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <ClientsTable initialClients={clients} applications={applications} />
    </div>
  );
}
