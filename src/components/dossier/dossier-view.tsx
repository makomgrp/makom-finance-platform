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
import { DocumentsTab } from "@/components/dossier/tabs/documents-tab";
import { NotesTab } from "@/components/dossier/tabs/notes-tab";
import { AlertsTab } from "@/components/dossier/tabs/alerts-tab";
import { ActivityTab } from "@/components/dossier/tabs/activity-tab";
import {
  getClientById,
  getApplicationsByClientId,
  getDocumentsByApplicationId,
  getAlertsByClientId,
  getActivitiesByClientId,
} from "@/lib/demo-data";
import type {
  ActivityEvent,
  Client,
  ClientAlert,
  DocumentRecord,
  InternalNote,
  LoanApplication,
  LoanStatus,
} from "@/types";

interface DossierViewProps {
  clientId: string;
  initialTab?: string;
  initialApplicationId?: string;
  initialNotes: InternalNote[];
  notesLoadError: boolean;
}

const VALID_TABS = ["resumen", "datos", "documentos", "notas", "alertas", "actividad"];

export function DossierView({
  clientId,
  initialTab,
  initialApplicationId,
  initialNotes,
  notesLoadError,
}: DossierViewProps) {
  const t = useTranslations();
  const [client, setClient] = useState<Client>(() => getClientById(clientId)!);
  const [applications, setApplications] = useState<LoanApplication[]>(() =>
    getApplicationsByClientId(clientId)
  );
  const [notes, setNotes] = useState<InternalNote[]>(initialNotes);
  const [alerts, setAlerts] = useState<ClientAlert[]>(() => getAlertsByClientId(clientId));
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

  const [documents, setDocuments] = useState<DocumentRecord[]>(() =>
    application ? getDocumentsByApplicationId(application.id) : []
  );

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
        onSelectApplication={(id) => {
          setActiveApplicationId(id);
          setDocuments(getDocumentsByApplicationId(id));
        }}
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
          <SummaryTab client={client} application={application} documents={documents} />
        </TabsContent>

        <TabsContent value="datos" className="mt-4">
          <PersonalDataTab client={client} />
        </TabsContent>

        <TabsContent value="documentos" className="mt-4">
          <DocumentsTab
            application={application}
            documents={documents}
            onDocumentsChange={setDocuments}
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
          />
        </TabsContent>

        <TabsContent value="actividad" className="mt-4">
          <ActivityTab activities={activities} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
