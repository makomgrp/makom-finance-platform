import { getTranslations } from "next-intl/server";
import { EMPTY_BRANCH_SCOPE } from "@/lib/services/branch-scope-query";
import { resolveBranchViewScope } from "@/lib/services/branch-view-context";
import { viewSpansMultipleBranches } from "@/lib/services/branch-origin";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { PageHeader } from "@/components/shared/page-header";
import { ClientsTable } from "@/components/clients/clients-table";
import { getApplications } from "@/lib/services/applications";
import { getClients } from "@/lib/services/clients";
import { getApplicationCreatableProducts } from "@/lib/services/products";

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ sucursal?: string }> }) {
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
  // MILESTONE 25C-2 — does THIS view span more than one branch? Computed
  // server-side from the effective view scope and passed as a single boolean:
  // the component never receives the scope itself, so it cannot recompute — or
  // misread — authorization. The deciding factor is the VIEW, not the role.
  const showBranchOrigin = viewSpansMultipleBranches(scope);
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
        showBranchOrigin={showBranchOrigin}
        initialClients={clients}
        applications={applications}
        creatableProducts={productsResult.status === "ok" ? productsResult.products : []}
        productsLoadError={productsResult.status === "error"}
      />
    </div>
  );
}
