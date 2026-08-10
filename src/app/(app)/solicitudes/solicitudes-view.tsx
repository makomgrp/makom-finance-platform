"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { List, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ApplicationsTable } from "@/components/applications/applications-table";
import { ApplicationsKanban } from "@/components/applications/applications-kanban";
import { setSolicitudApplicationStatus } from "@/app/(app)/solicitudes/actions";
import { cn } from "@/lib/utils";
import type { ApplicationListItem, ApplicationStatus } from "@/types";

interface SolicitudesViewProps {
  initialApplications: ApplicationListItem[];
  documentSlotCounts: Record<string, { completed: number; total: number }>;
  loadError: boolean;
}

/**
 * The interactive shell for /solicitudes (Milestone 13C — see the
 * Milestone 13A architecture review and its final validation). The page
 * itself (page.tsx) is a Server Component that fetches real Applications
 * directly from the service layer; this client component only owns
 * interactive UI state (the table/kanban toggle, and the locally-held
 * application list so a status change is reflected immediately without a
 * full page reload) — the same split already used by expedientes/[id]/
 * page.tsx -> dossier-view.tsx.
 */
export function SolicitudesView({ initialApplications, documentSlotCounts, loadError }: SolicitudesViewProps) {
  const t = useTranslations();
  const [applications, setApplications] = useState<ApplicationListItem[]>(initialApplications);
  const [view, setView] = useState<"tabla" | "kanban">("tabla");

  const handleStatusChange = async (applicationId: string, status: ApplicationStatus) => {
    const result = await setSolicitudApplicationStatus({ applicationId, status });

    if (result.status !== "success") {
      toast.error(t("applications.toasts.statusChangeError"));
      return;
    }

    // Local replacement of only the fields setApplicationStatus can ever
    // change, not a full-row replace: the Application it returns carries
    // no productName/assignedAdvisorFullName (those are ApplicationListItem-
    // only, resolved by getApplications(), not by this mutation), and a
    // status change can never itself alter product or advisor assignment.
    // Preserving the rest of the existing list item avoids both a data
    // loss (blanking those fields) and a refetch this result doesn't
    // require — see the Milestone 13A architecture validation's "Read
    // Server Action" question.
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
    toast.success(
      t("applications.toasts.statusChanged", { status: t(`statuses.applicationStatus.${status}`) })
    );
  };

  return (
    <div>
      <PageHeader
        title={t("applications.title")}
        description={t("applications.description")}
        actions={
          <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
            <Button
              variant={view === "tabla" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setView("tabla")}
              className={cn(view === "tabla" && "shadow-sm")}
            >
              <List className="size-4" />
              {t("applications.viewTable")}
            </Button>
            <Button
              variant={view === "kanban" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setView("kanban")}
              className={cn(view === "kanban" && "shadow-sm")}
            >
              <LayoutGrid className="size-4" />
              {t("applications.viewKanban")}
            </Button>
          </div>
        }
      />

      {loadError ? (
        <EmptyState
          icon={List}
          title={t("applications.loadErrorTitle")}
          description={t("applications.loadErrorDescription")}
        />
      ) : view === "tabla" ? (
        <ApplicationsTable
          applications={applications}
          documentSlotCounts={documentSlotCounts}
          onStatusChange={handleStatusChange}
        />
      ) : (
        <ApplicationsKanban
          applications={applications}
          documentSlotCounts={documentSlotCounts}
          onStatusChange={handleStatusChange}
        />
      )}
    </div>
  );
}
