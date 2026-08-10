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
import {
  getClientById,
  getApplicationsByClientId,
  getActivitiesByClientId,
} from "@/lib/demo-data";
import type {
  ActivityEvent,
  Client,
  DocumentEvidence,
  DossierAlert,
  InternalNote,
  LoanApplication,
  LoanStatus,
  RequirementSlot,
} from "@/types";

/**
 * Per-demo-application bundle of real Requirement Slot + Evidence data
 * (Milestone 12C). A null value means no real Application exists yet for
 * that demo application (applications.legacy_id has no match) — the
 * expected, common case for everything except ap-001 today. Deliberately
 * NOT the legacy DossierDocument model — see src/lib/services/document-
 * evidence.ts and the Milestone 12 architecture review.
 */
export interface DossierRequirementsData {
  applicationId: string;
  requirementSlots: RequirementSlot[];
  evidence: DocumentEvidence[];
  loadError: boolean;
}

interface DossierViewProps {
  clientId: string;
  initialTab?: string;
  initialApplicationId?: string;
  initialNotes: InternalNote[];
  notesLoadError: boolean;
  initialAlerts: DossierAlert[];
  alertsLoadError: boolean;
  /** The real Requirement Slot + Evidence bundle for each of the client's
   * demo applications (Milestone 12C) — the sole source of document data
   * for both the Requirements tab and SummaryTab's completion widget
   * (Milestone 12E1). Keyed by demo LoanApplication id; a null value
   * means no real Application bridge exists yet for that demo
   * application. */
  initialRequirementsByDemoApplicationId: Record<string, DossierRequirementsData | null>;
}

const VALID_TABS = ["resumen", "datos", "documentos", "notas", "alertas", "actividad"];

export function DossierView({
  clientId,
  initialTab,
  initialApplicationId,
  initialNotes,
  notesLoadError,
  initialAlerts,
  alertsLoadError,
  initialRequirementsByDemoApplicationId,
}: DossierViewProps) {
  const t = useTranslations();
  const [client, setClient] = useState<Client>(() => getClientById(clientId)!);
  const [applications, setApplications] = useState<LoanApplication[]>(() =>
    getApplicationsByClientId(clientId)
  );
  const [notes, setNotes] = useState<InternalNote[]>(initialNotes);
  const [alerts, setAlerts] = useState<DossierAlert[]>(initialAlerts);
  const [activities, setActivities] = useState<ActivityEvent[]>(() =>
    getActivitiesByClientId(clientId)
  );

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

  // Milestone 12C: the new Requirement Slot + Document Evidence state,
  // keyed by demo application id exactly like initialRequirementsByDemo
  // ApplicationId.
  const [requirementsByDemoApplicationId, setRequirementsByDemoApplicationId] = useState<
    Record<string, DossierRequirementsData | null>
  >(initialRequirementsByDemoApplicationId);
  const activeRequirementsData = activeApplicationId
    ? (requirementsByDemoApplicationId[activeApplicationId] ?? null)
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
    const current = requirementsByDemoApplicationId[activeApplicationId];
    if (!current) return;

    const result = await getDossierRequirements(current.applicationId);
    if (result.status !== "success") {
      toast.error(t("dossier.documents.toasts.refetchError"));
      return;
    }

    setRequirementsByDemoApplicationId((prev) => ({
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

  const logActivity = (
    descriptionKey: string,
    params: Record<string, string> | undefined,
    type: ActivityEvent["type"]
  ) => {
    setActivities((prev) => [
      {
        id: `act-demo-${Date.now()}`,
        clientId,
        applicationId: application?.id,
        type,
        descriptionKey,
        params,
        date: new Date().toISOString(),
        userId: undefined,
      },
      ...prev,
    ]);
  };

  const handleClientUpdate = (updated: Client) => {
    setClient(updated);
    toast.success(t("clients.toasts.clientUpdated"));
  };

  const handleApplicationStatusChange = (applicationId: string, status: LoanStatus) => {
    setApplications((prev) =>
      prev.map((app) =>
        app.id === applicationId
          ? { ...app, status, lastActivityAt: new Date().toISOString() }
          : app
      )
    );
    const statusLabel = t(`statuses.loanApplication.${status}`);
    logActivity("statusChanged", { status: statusLabel }, "estado_modificado");
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
            onActivity={logActivity}
          />
        </TabsContent>

        <TabsContent value="notas" className="mt-4">
          <NotesTab
            clientId={clientId}
            notes={notes}
            onNotesChange={setNotes}
            onActivity={logActivity}
            loadError={notesLoadError}
          />
        </TabsContent>

        <TabsContent value="alertas" className="mt-4">
          <AlertsTab
            clientId={clientId}
            alerts={alerts}
            onAlertsChange={setAlerts}
            onActivity={logActivity}
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
