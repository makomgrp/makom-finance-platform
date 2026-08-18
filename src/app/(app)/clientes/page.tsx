import { getTranslations } from "next-intl/server";
import { EMPTY_BRANCH_SCOPE } from "@/lib/services/branch-scope-query";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
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
  // uses. Same direct Server Component -> service call, no read action.  // MILESTONE 25B-1 — effective branch scope, resolved server-side ONCE by
  // getCurrentProfile() (cached per request) and passed explicitly to every
  // scoped read. Services never resolve scope themselves, and the client never
  // supplies it. The (app) layout has already guaranteed an active profile.
  const profile = await getCurrentProfile();
  const scope = profile?.branchScope ?? EMPTY_BRANCH_SCOPE;
  const [clientsResult, applicationsResult, productsResult] = await Promise.all([
    getClients(scope),
    getApplications(scope),
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
