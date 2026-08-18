import { notFound } from "next/navigation";
import { EMPTY_BRANCH_SCOPE } from "@/lib/services/branch-scope-query";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { getLocale } from "next-intl/server";
import { getClientById } from "@/lib/services/clients";
import { getNotesByClientId } from "@/lib/services/notes";
import { getAlertsByClientId } from "@/lib/services/alerts";
import { getApplications } from "@/lib/services/applications";
import { getRequirementSlotsByApplicationId } from "@/lib/services/requirement-slots";
import { getEvidenceByApplicationId } from "@/lib/services/document-evidence";
import { getClientCrmEvents } from "@/lib/services/crm-events";
import { DossierView, type DossierRequirementsData } from "@/components/dossier/dossier-view";
import { buildClientActivityFeed } from "@/lib/activity/build-client-activity-feed";
import type { BranchScope } from "@/types";
import type { Locale } from "@/i18n/config";
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
  scope: BranchScope,
  applications: ApplicationListItem[]
): Promise<Record<string, DossierRequirementsData>> {
  const entries = await Promise.all(
    applications.map(async (application): Promise<readonly [string, DossierRequirementsData]> => {
      const [slotsResult, evidenceResult] = await Promise.all([
        getRequirementSlotsByApplicationId(scope, application.id),
        getEvidenceByApplicationId(scope, application.id),
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
  const locale = (await getLocale()) as Locale;

  // Milestone 14F: the Dossier route is UUID-only — the canonical route
  // identity is public.clients.id. The TEMPORARY getClientByLegacyId
  // fallback (Milestone 14D) was retired here since every active
  // navigation source (Solicitudes, Document Workspace, standalone
  // Alerts, Clientes) already routes with a real client uuid as of
  // Milestone 14E; nothing in the app generates a legacy-shaped
  // /expedientes/cl-001 link anymore. A failed lookup is a genuine 404 —
  // there is no fallback to demo data.
  // MILESTONE 25B-1 — scope resolved once, threaded into every dossier read.
  // An out-of-scope client returns NOT_FOUND from the service, which becomes a
  // genuine 404 here — indistinguishable from a client that does not exist, so
  // the route cannot be used to probe other branches.
  const profile = await getCurrentProfile();
  const scope = profile?.branchScope ?? EMPTY_BRANCH_SCOPE;

  const clientResult = await getClientById(scope, id);
  if (clientResult.status !== "ok") notFound();
  const client = clientResult.client;

  // Milestone 14E: Applications, Notes, and Alerts all carry a real,
  // FK-constrained client_id — every real Client, seeded or
  // newly-created, always has one (it is NOT NULL), so all three reads
  // below run unconditionally, keyed on client.id.
  // Milestone 20 adds getClientCrmEvents — the ONE audit-trail read, joining
  // the existing parallel batch rather than fanning out per application. This
  // is deliberately the first additional dossier query since Milestone 19:
  // durable history lives in its own table, and there is no way to read it
  // without reading it.
  const [notesResult, alertsResult, applicationsResult, crmEventsResult] = await Promise.all([
    getNotesByClientId(scope, client.id),
    getAlertsByClientId(scope, client.id),
    getApplications(scope),
    getClientCrmEvents(scope, client.id),
  ]);

  const applications =
    applicationsResult.status === "ok"
      ? applicationsResult.applications.filter((application) => application.clientId === client.id)
      : [];

  // Requires the filtered application list above, so it cannot join the
  // Promise.all — a genuine data dependency, not a duplicated query.
  const requirementsByApplicationId = await resolveRequirementsByApplicationId(scope, applications);

  // Milestone 19: the Activity feed is DERIVED, not fetched. Every record it
  // needs — client, applications, notes, alerts, requirement slots, evidence
  // — has already been loaded above for the other tabs, so restoring
  // Activity adds ZERO database queries to this page. buildClientActivityFeed
  // is a pure function: it performs no I/O and emits only events that map
  // one-to-one to a persisted row or column (see its module doc comment for
  // what is deliberately excluded and why).
  const activities = buildClientActivityFeed({
    client,
    applications,
    notes: notesResult.status === "ok" ? notesResult.notes : [],
    alerts: alertsResult.status === "ok" ? alertsResult.alerts : [],
    requirementsByApplicationId,
    // A failed audit read degrades to the derived latest-state items rather
    // than blanking the tab — the feed stays truthful, just less complete.
    crmEvents: crmEventsResult.status === "ok" ? crmEventsResult.events : [],
    locale,
  });

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
      activities={activities}
    />
  );
}
