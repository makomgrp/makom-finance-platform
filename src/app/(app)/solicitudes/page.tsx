import { getApplications } from "@/lib/services/applications";
import { getDocumentSlotCompletionCounts } from "@/lib/services/requirement-slots";
import { getApplicationCreatableProducts } from "@/lib/services/products";
import { getClients } from "@/lib/services/clients";
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
export default async function SolicitudesPage() {
  const [applicationsResult, countsResult, productsResult, clientsResult] = await Promise.all([
    getApplications(),
    getDocumentSlotCompletionCounts(),
    getApplicationCreatableProducts(),
    getClients(),
  ]);

  return (
    <SolicitudesView
      initialApplications={applicationsResult.status === "ok" ? applicationsResult.applications : []}
      documentSlotCounts={countsResult.status === "ok" ? countsResult.counts : {}}
      loadError={applicationsResult.status === "error"}
      creatableProducts={productsResult.status === "ok" ? productsResult.products : []}
      productsLoadError={productsResult.status === "error"}
      clients={clientsResult.status === "ok" ? clientsResult.clients : []}
    />
  );
}
