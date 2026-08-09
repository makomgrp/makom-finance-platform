import { notFound } from "next/navigation";
import { getClientById, getApplicationsByClientId } from "@/lib/demo-data";
import { getNotesByClientId } from "@/lib/services/notes";
import { getAlertsByClientId } from "@/lib/services/alerts";
import { getDocumentsByClientId } from "@/lib/services/documents";
import { getApplicationByLegacyId } from "@/lib/services/applications";
import { getRequirementSlotsByApplicationId } from "@/lib/services/requirement-slots";
import { getEvidenceByApplicationId } from "@/lib/services/document-evidence";
import { DossierView, type DossierRequirementsData } from "@/components/dossier/dossier-view";

/**
 * Milestone 12C addition: for each of the client's demo LoanApplications,
 * resolves whether a real Application exists (applications.legacy_id —
 * the Milestone 11 bridge) and, only when one does, fetches its
 * Requirement Slots and Evidence in parallel. A null entry means no real
 * Application exists for that demo application yet — the expected,
 * common case for everything except ap-001 today — and the Dossier must
 * render a "not yet migrated" state for it, never an error.
 *
 * Deliberately resolves for EVERY one of the client's demo applications,
 * not just whichever is initially active: a client can have more than
 * one, and this app has no client-triggered re-fetch mechanism for
 * switching between them (see dossier-view.tsx) — resolving all of them
 * server-side up front is what lets switching applications work
 * correctly without inventing one.
 */
async function resolveRequirementsByDemoApplicationId(
  demoApplicationIds: string[]
): Promise<Record<string, DossierRequirementsData | null>> {
  const entries = await Promise.all(
    demoApplicationIds.map(async (demoApplicationId): Promise<readonly [string, DossierRequirementsData | null]> => {
      const bridgeResult = await getApplicationByLegacyId(demoApplicationId);
      if (bridgeResult.status !== "ok") {
        return [demoApplicationId, null] as const;
      }

      const realApplicationId = bridgeResult.application.id;
      const [slotsResult, evidenceResult] = await Promise.all([
        getRequirementSlotsByApplicationId(realApplicationId),
        getEvidenceByApplicationId(realApplicationId),
      ]);

      return [
        demoApplicationId,
        {
          applicationId: realApplicationId,
          requirementSlots: slotsResult.status === "ok" ? slotsResult.requirementSlots : [],
          evidence: evidenceResult.status === "ok" ? evidenceResult.evidence : [],
          loadError: slotsResult.status === "error" || evidenceResult.status === "error",
        },
      ] as const;
    })
  );

  return Object.fromEntries(entries);
}

export default async function ExpedientePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; solicitud?: string }>;
}) {
  const { id } = await params;
  const { tab, solicitud } = await searchParams;

  const client = getClientById(id);
  if (!client) notFound();

  const demoApplications = getApplicationsByClientId(client.id);

  const [notesResult, alertsResult, documentsResult, requirementsByDemoApplicationId] = await Promise.all([
    getNotesByClientId(client.id),
    getAlertsByClientId(client.id),
    getDocumentsByClientId(client.id),
    resolveRequirementsByDemoApplicationId(demoApplications.map((application) => application.id)),
  ]);

  return (
    <DossierView
      clientId={client.id}
      initialTab={tab}
      initialApplicationId={solicitud}
      initialNotes={notesResult.status === "ok" ? notesResult.notes : []}
      notesLoadError={notesResult.status === "error"}
      initialAlerts={alertsResult.status === "ok" ? alertsResult.alerts : []}
      alertsLoadError={alertsResult.status === "error"}
      initialDocuments={documentsResult.status === "ok" ? documentsResult.documents : []}
      documentsLoadError={documentsResult.status === "error"}
      initialRequirementsByDemoApplicationId={requirementsByDemoApplicationId}
    />
  );
}
