import { getApplications } from "@/lib/services/applications";
import { EMPTY_BRANCH_SCOPE } from "@/lib/services/branch-scope-query";
import { resolveBranchViewScope } from "@/lib/services/branch-view-context";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { getDocumentSlotCompletionCounts } from "@/lib/services/requirement-slots";
import { getApplicationCreatableProducts } from "@/lib/services/products";
import { getClients } from "@/lib/services/clients";
import { getAssignableAdvisorsForApplications } from "@/lib/services/profiles";
import { SolicitudesView } from "@/app/(app)/solicitudes/solicitudes-view";

/**
 * Server Component -> service, direct — no read Server Action (Milestone
 * 13C; see the Milestone 13A architecture review and its final
 * validation, "Read Server Action" question). Loads real Applications
 * (src/lib/services/applications.ts#getApplications, extended in
 * Milestone 13B to resolve Product/advisor) and, separately, each
 * application's document-kind Requirement Slot completion counts — two
 * lean, independent reads in parallel, not a combined workspace read (see
 * getDocumentSlotCompletionCounts's own doc comment for why this stays
 * two small queries rather than growing a new read model).
 *
 * Milestone 17 adds two more reads for the application-creation dialog:
 * the Client list it picks from, and the products actually eligible for
 * origination (getApplicationCreatableProducts — active AND holding at
 * least one active requirement template). Both stay direct service calls
 * on the same principle; neither becomes a read Server Action.
 *
 * No demo data anywhere in this file — src/lib/demo-data/applications.ts
 * is not imported.
 */
export default async function SolicitudesPage({ searchParams }: { searchParams: Promise<{ sucursal?: string }> }) {  // MILESTONE 25B-1 — effective branch scope, resolved server-side ONCE by
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
  const [applicationsResult, countsResult, productsResult, clientsResult] = await Promise.all([
    getApplications(scope),
    getDocumentSlotCompletionCounts(scope),
    getApplicationCreatableProducts(),
    getClients(scope),
  ]);

  // MILESTONE 25B-2 — advisor eligibility now depends on each application's
  // OWN branch, so the directory is resolved per application rather than once
  // for the page. It runs after the applications load because it needs their
  // ids; it is still two queries in total, not one per row, and it re-reads
  // the applications through the same scope so no branch is taken on trust
  // from this list.
  const applications = applicationsResult.status === "ok" ? applicationsResult.applications : [];
  const advisorsResult = await getAssignableAdvisorsForApplications(
    scope,
    applications.map((application) => application.id)
  );

  return (
    <SolicitudesView
      initialApplications={applications}
      documentSlotCounts={countsResult.status === "ok" ? countsResult.counts : {}}
      loadError={applicationsResult.status === "error"}
      creatableProducts={productsResult.status === "ok" ? productsResult.products : []}
      productsLoadError={productsResult.status === "error"}
      clients={clientsResult.status === "ok" ? clientsResult.clients : []}
      assignableAdvisorsByApplication={
        advisorsResult.status === "ok" ? advisorsResult.byApplicationId : {}
      }
    />
  );
}
