"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { DossierHeader } from "@/components/dossier/dossier-header";
import { SummaryTab } from "@/components/dossier/tabs/summary-tab";
import { PersonalDataTab } from "@/components/dossier/tabs/personal-data-tab";
import { RequirementsTab } from "@/components/dossier/tabs/requirements-tab";
import { NotesTab } from "@/components/dossier/tabs/notes-tab";
import { AlertsTab } from "@/components/dossier/tabs/alerts-tab";
import { ActivityTab } from "@/components/dossier/tabs/activity-tab";
import { getDossierRequirements } from "@/app/(app)/expedientes/actions";
import { setSolicitudApplicationStatus } from "@/app/(app)/solicitudes/actions";
import type {
  ActivityFeedItem,
  ApplicationListItem,
  ApplicationStatus,
  Client,
  DocumentEvidence,
  DossierAlert,
  InternalNote,
  RequirementSlot,
} from "@/types";

/**
 * Real Requirement Slot + Evidence bundle for one real Application
 * (Milestone 12C, re-keyed by real application id in Milestone 13E — see
 * expedientes/[id]/page.tsx). The `| null` a caller may still see on a
 * lookup miss is defensive only: every Application this component ever
 * knows about (initialApplications) always has a corresponding entry
 * populated by the server. Deliberately NOT the legacy DossierDocument
 * model — see src/lib/services/document-evidence.ts and the Milestone 12
 * architecture review.
 */
export interface DossierRequirementsData {
  applicationId: string;
  requirementSlots: RequirementSlot[];
  evidence: DocumentEvidence[];
  loadError: boolean;
}

interface DossierViewProps {
  /** Milestone 14D: the already-resolved real Client Engine record
   * (src/lib/services/clients.ts) — replaces the demo clientId lookup
   * this component used to do internally. As of Milestone 14E,
   * Applications/Notes/Alerts all key on client.id directly (a real,
   * always-present uuid). */
  initialClient: Client;
  initialTab?: string;
  initialApplicationId?: string;
  initialNotes: InternalNote[];
  notesLoadError: boolean;
  initialAlerts: DossierAlert[];
  alertsLoadError: boolean;
  /** This client's real Applications (Milestone 13E — replaces the demo
   * LoanApplication[] this component used to seed itself from). May be
   * empty — a client with no real Application yet is the expected,
   * common case for everyone except ap-001 today. */
  initialApplications: ApplicationListItem[];
  /** The real Requirement Slot + Evidence bundle for each of
   * initialApplications, keyed by real application id. */
  initialRequirementsByApplicationId: Record<string, DossierRequirementsData>;
  /**
   * Milestone 19: the Activity feed, built SERVER-SIDE by
   * expedientes/[id]/page.tsx from the same persisted records already
   * loaded above (see src/lib/activity/build-client-activity-feed.ts).
   * Deliberately a plain prop and not local state: unlike the tab
   * Milestone 18 removed, nothing in this component may append to it, so
   * the feed can never drift from what the database actually holds.
   */
  activities: ActivityFeedItem[];
}

// Milestone 19 restored "actividad" — this time backed by persisted
// records rather than the fixture history Milestone 18 removed — so
// ?tab=actividad selects it again.
const VALID_TABS = ["resumen", "datos", "documentos", "notas", "alertas", "actividad"];

export function DossierView({
  initialClient,
  initialTab,
  initialApplicationId,
  initialNotes,
  notesLoadError,
  initialAlerts,
  alertsLoadError,
  initialApplications,
  initialRequirementsByApplicationId,
  activities,
}: DossierViewProps) {
  const t = useTranslations();
  const [client, setClient] = useState<Client>(initialClient);
  const [applications, setApplications] = useState<ApplicationListItem[]>(initialApplications);
  const [notes, setNotes] = useState<InternalNote[]>(initialNotes);
  const [alerts, setAlerts] = useState<DossierAlert[]>(initialAlerts);
  const [activeApplicationId, setActiveApplicationId] = useState<string | undefined>(() => {
    if (initialApplicationId && applications.some((app) => app.id === initialApplicationId)) {
      return initialApplicationId;
    }
    return applications[0]?.id;
  });

  const application = useMemo(
    () => applications.find((app) => app.id === activeApplicationId),
    [applications, activeApplicationId]
  );

  // Milestone 12C, re-keyed by real application id in 13E: the Requirement
  // Slot + Document Evidence state.
  const [requirementsByApplicationId, setRequirementsByApplicationId] = useState<
    Record<string, DossierRequirementsData>
  >(initialRequirementsByApplicationId);
  const activeRequirementsData = activeApplicationId
    ? (requirementsByApplicationId[activeApplicationId] ?? null)
    : null;

  /**
   * Per the Milestone 12C architecture review: no optimistic merging.
   * After any mutation (upload / review / status change) the Requirements
   * tab calls this to refetch both Requirement Slots and Evidence fresh
   * from the server and replace the state wholesale — a single upload can
   * silently also change a Slot's status, so merging just the one
   * returned item risks leaving stale Slot state on screen.
   */
  const handleRequirementsRefetch = async () => {
    if (!activeApplicationId) return;
    const current = requirementsByApplicationId[activeApplicationId];
    if (!current) return;

    const result = await getDossierRequirements(current.applicationId);
    if (result.status !== "success") {
      toast.error(t("dossier.documents.toasts.refetchError"));
      return;
    }

    setRequirementsByApplicationId((prev) => ({
      ...prev,
      [activeApplicationId]: {
        applicationId: current.applicationId,
        requirementSlots: result.requirementSlots,
        evidence: result.evidence,
        loadError: false,
      },
    }));
  };

  const defaultTab = initialTab && VALID_TABS.includes(initialTab) ? initialTab : "resumen";

  /**
   * Milestone 14D: RealClientFormDialog (reused unchanged from Milestone
   * 14C — see dossier-header.tsx) already persists the edit to Supabase
   * via updateClientProfileAction before ever calling this callback; this
   * is local state sync only, exactly like clients-table.tsx's
   * handleUpdated does for the same dialog.
   */
  const handleClientUpdate = (updated: Client) => {
    setClient(updated);
    toast.success(t("clients.toasts.clientUpdated"));
  };

  /**
   * Reuses src/app/(app)/solicitudes/actions.ts#setSolicitudApplicationStatus
   * unchanged (Milestone 13E — see the Milestone 13A architecture review's
   * "Shared ApplicationStatusMenu" question and the Milestone 13C
   * implementation report) — no transition logic is duplicated here.
   * Local replacement of only the fields that mutation can ever change,
   * not a full-row replace, for the exact same reason
   * solicitudes-view.tsx#handleStatusChange does it that way: the
   * returned Application carries no productName/assignedAdvisorFullName,
   * and a status change can never itself alter either.
   */
  const handleApplicationStatusChange = async (applicationId: string, status: ApplicationStatus) => {
    const result = await setSolicitudApplicationStatus({ applicationId, status });
    if (result.status !== "success") {
      toast.error(t("applications.toasts.statusChangeError"));
      return;
    }

    setApplications((prev) =>
      prev.map((app) =>
        app.id === applicationId
          ? {
              ...app,
              status: result.application.status,
              statusChangedAt: result.application.statusChangedAt,
              statusChangedByProfileId: result.application.statusChangedByProfileId,
              statusChangedSource: result.application.statusChangedSource,
            }
          : app
      )
    );
    const statusLabel = t(`statuses.applicationStatus.${status}`);
    toast.success(t("applications.toasts.statusChanged", { status: statusLabel }));
  };

  return (
    <div>
      <DossierHeader
        client={client}
        applications={applications}
        activeApplication={application}
        onSelectApplication={(id) => setActiveApplicationId(id)}
        onClientUpdate={handleClientUpdate}
        onApplicationStatusChange={handleApplicationStatusChange}
      />

      <Tabs defaultValue={defaultTab} className="mt-6">
        <TabsList className="flex-wrap">
          <TabsTrigger value="resumen">{t("dossier.tabs.summary")}</TabsTrigger>
          <TabsTrigger value="datos">{t("dossier.tabs.personalData")}</TabsTrigger>
          <TabsTrigger value="documentos">{t("dossier.tabs.documents")}</TabsTrigger>
          <TabsTrigger value="notas">{t("dossier.tabs.notes")}</TabsTrigger>
          <TabsTrigger value="alertas">{t("dossier.tabs.alerts")}</TabsTrigger>
          <TabsTrigger value="actividad">{t("dossier.tabs.activity")}</TabsTrigger>
        </TabsList>

        <TabsContent value="resumen" className="mt-4">
          <SummaryTab
            client={client}
            application={application}
            requirementsData={activeRequirementsData}
          />
        </TabsContent>

        <TabsContent value="datos" className="mt-4">
          <PersonalDataTab client={client} />
        </TabsContent>

        <TabsContent value="documentos" className="mt-4">
          <RequirementsTab
            application={application}
            requirementsData={activeRequirementsData}
            onRefetch={handleRequirementsRefetch}
          />
        </TabsContent>

        <TabsContent value="notas" className="mt-4">
          <NotesTab
            clientId={client.id}
            notes={notes}
            onNotesChange={setNotes}
            loadError={notesLoadError}
          />
        </TabsContent>

        <TabsContent value="alertas" className="mt-4">
          <AlertsTab
            clientId={client.id}
            alerts={alerts}
            onAlertsChange={setAlerts}
            loadError={alertsLoadError}
          />
        </TabsContent>


        <TabsContent value="actividad" className="mt-4">
          <ActivityTab activities={activities} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
