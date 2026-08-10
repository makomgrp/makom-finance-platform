import { notFound } from "next/navigation";
import { getClientById } from "@/lib/demo-data";
import { getNotesByClientId } from "@/lib/services/notes";
import { getAlertsByClientId } from "@/lib/services/alerts";
import { getApplications } from "@/lib/services/applications";
import { getRequirementSlotsByApplicationId } from "@/lib/services/requirement-slots";
import { getEvidenceByApplicationId } from "@/lib/services/document-evidence";
import { DossierView, type DossierRequirementsData } from "@/components/dossier/dossier-view";
import type { ApplicationListItem } from "@/types";

/**
 * Milestone 13E — resolves Requirement Slots + Evidence for each of the
 * client's REAL Applications directly, keyed by real application id.
 * Replaces Milestone 12C's per-demo-application legacy_id bridge
 * (getApplicationByLegacyId): that bridge existed to answer "does a real
 * Application exist for this demo application yet?" — a question that no
 * longer applies once the Dossier works from real Applications end to
 * end. getApplicationByLegacyId is no longer called by this page; it has
 * no remaining callers anywhere in src/ as of this milestone (see the
 * Milestone 13E implementation report).
 */
async function resolveRequirementsByApplicationId(
  applications: ApplicationListItem[]
): Promise<Record<string, DossierRequirementsData>> {
  const entries = await Promise.all(
    applications.map(async (application): Promise<readonly [string, DossierRequirementsData]> => {
      const [slotsResult, evidenceResult] = await Promise.all([
        getRequirementSlotsByApplicationId(application.id),
        getEvidenceByApplicationId(application.id),
      ]);

      return [
        application.id,
        {
          applicationId: application.id,
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

  // client_legacy_id is the one bridge dimension this milestone leaves in
  // place — Client Engine is explicitly deferred (see the Milestone 13A
  // architecture review's "Client Dependency" question) — so real
  // Applications for this client are still resolved by filtering on it,
  // exactly like Solicitudes already does. getApplications() is the same,
  // unmodified, already-extended (Milestone 13B) service every other
  // migrated surface reuses.
  const [notesResult, alertsResult, applicationsResult] = await Promise.all([
    getNotesByClientId(client.id),
    getAlertsByClientId(client.id),
    getApplications(),
  ]);

  const applications =
    applicationsResult.status === "ok"
      ? applicationsResult.applications.filter((application) => application.clientLegacyId === client.id)
      : [];

  // Requires the filtered application list above, so it cannot join the
  // Promise.all — a genuine data dependency, not a duplicated query.
  const requirementsByApplicationId = await resolveRequirementsByApplicationId(applications);

  return (
    <DossierView
      clientId={client.id}
      initialTab={tab}
      initialApplicationId={solicitud}
      initialNotes={notesResult.status === "ok" ? notesResult.notes : []}
      notesLoadError={notesResult.status === "error"}
      initialAlerts={alertsResult.status === "ok" ? alertsResult.alerts : []}
      alertsLoadError={alertsResult.status === "error"}
      initialApplications={applications}
      initialRequirementsByApplicationId={requirementsByApplicationId}
    />
  );
}
