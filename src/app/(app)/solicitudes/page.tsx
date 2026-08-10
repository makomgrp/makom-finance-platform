import { getApplications } from "@/lib/services/applications";
import { getDocumentSlotCompletionCounts } from "@/lib/services/requirement-slots";
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
 * No demo data anywhere in this file — src/lib/demo-data/applications.ts
 * is not imported.
 */
export default async function SolicitudesPage() {
  const [applicationsResult, countsResult] = await Promise.all([
    getApplications(),
    getDocumentSlotCompletionCounts(),
  ]);

  return (
    <SolicitudesView
      initialApplications={applicationsResult.status === "ok" ? applicationsResult.applications : []}
      documentSlotCounts={countsResult.status === "ok" ? countsResult.counts : {}}
      loadError={applicationsResult.status === "error"}
    />
  );
}
