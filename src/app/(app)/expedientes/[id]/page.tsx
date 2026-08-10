import { notFound } from "next/navigation";
import { getClientById, getClientByLegacyId } from "@/lib/services/clients";
import { getNotesByClientId, type GetDossierNotesResult } from "@/lib/services/notes";
import { getAlertsByClientId, type GetDossierAlertsResult } from "@/lib/services/alerts";
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

/**
 * Milestone 14D — resolves the real Client Engine record. The canonical
 * route identity is now public.clients.id (a real uuid); getClientById is
 * tried first. A TEMPORARY fallback, destined for retirement in 14F (see
 * the Milestone 14A/14D architecture decisions): if that fails, the param
 * is tried again as a legacy bridge id via getClientByLegacyId — this
 * keeps every existing /expedientes/cl-001-style link (Solicitudes'
 * clientLegacyId-based navigation, Document Workspace, old bookmarks)
 * working without requiring those callers to change yet. Both lookups
 * failing is a genuine 404 — there is no third fallback to demo data.
 */
async function resolveClient(routeParam: string) {
  const byId = await getClientById(routeParam);
  if (byId.status === "ok") return byId.client;

  const byLegacyId = await getClientByLegacyId(routeParam);
  if (byLegacyId.status === "ok") return byLegacyId.client;

  return null;
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

  const client = await resolveClient(id);
  if (!client) notFound();

  // client_legacy_id is the one bridge dimension this milestone leaves in
  // place — applications.client_id does not exist yet (Milestone 14E) —
  // so real Applications are still resolved by filtering on it, exactly
  // like Solicitudes already does. A newly-created real Client
  // (client.legacyId === undefined) has, by construction, zero
  // bridgeable Applications — never fabricate a legacy id to work around
  // this; the Dossier renders cleanly with an empty Applications list
  // instead. Same reasoning for Notes/Alerts: both dossier_notes and
  // dossier_alerts still key on client_legacy_id (Milestone 14E's scope,
  // not this one), so a client with no legacyId gets empty notes/alerts
  // rather than a query keyed on undefined.
  const [notesResult, alertsResult, applicationsResult] = await Promise.all([
    client.legacyId
      ? getNotesByClientId(client.legacyId)
      : (Promise.resolve({ status: "ok", notes: [] }) as Promise<GetDossierNotesResult>),
    client.legacyId
      ? getAlertsByClientId(client.legacyId)
      : (Promise.resolve({ status: "ok", alerts: [] }) as Promise<GetDossierAlertsResult>),
    getApplications(),
  ]);

  const applications =
    client.legacyId && applicationsResult.status === "ok"
      ? applicationsResult.applications.filter((application) => application.clientLegacyId === client.legacyId)
      : [];

  // Requires the filtered application list above, so it cannot join the
  // Promise.all — a genuine data dependency, not a duplicated query.
  const requirementsByApplicationId = await resolveRequirementsByApplicationId(applications);

  return (
    <DossierView
      initialClient={client}
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
