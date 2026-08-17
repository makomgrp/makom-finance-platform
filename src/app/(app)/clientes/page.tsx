import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/shared/page-header";
import { ClientsTable } from "@/components/clients/clients-table";
import { getApplications } from "@/lib/services/applications";
import { getClients } from "@/lib/services/clients";
import { getApplicationCreatableProducts } from "@/lib/services/products";

export default async function ClientsPage() {
  const t = await getTranslations("clients");

  // Milestone 14C: the client list itself now comes from the real Client
  // Engine (src/lib/services/clients.ts#getClients()) — replaces the demo
  // CLIENTS array this page used to seed ClientsTable from.
  //
  // Milestone 17 adds the eligible-product read (active AND holding at
  // least one active requirement template), so this page's "Crear
  // solicitud" row action can open the SAME creation dialog /solicitudes
  // uses. Same direct Server Component -> service call, no read action.
  const [clientsResult, applicationsResult, productsResult] = await Promise.all([
    getClients(),
    getApplications(),
    getApplicationCreatableProducts(),
  ]);
  const clients = clientsResult.status === "ok" ? clientsResult.clients : [];

  // Milestone 13F: per-client application counts still come from the real
  // Application Engine (Milestone 14E: matched client-side by the real
  // application.clientId === client.id relationship).
  const applications = applicationsResult.status === "ok" ? applicationsResult.applications : [];

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <ClientsTable
        initialClients={clients}
        applications={applications}
        creatableProducts={productsResult.status === "ok" ? productsResult.products : []}
        productsLoadError={productsResult.status === "error"}
      />
    </div>
  );
}
