"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { List, LayoutGrid, FilePlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ApplicationsTable } from "@/components/applications/applications-table";
import { ApplicationsKanban } from "@/components/applications/applications-kanban";
import { NewApplicationDialog } from "@/components/applications/new-application-dialog";
import {
  assignSolicitudAdvisor,
  setSolicitudApplicationStatus,
} from "@/app/(app)/solicitudes/actions";
import { useCapability } from "@/lib/auth/use-capability";
import { cn } from "@/lib/utils";
import type {
  ApplicationListItem,
  ApplicationStatus,
  AssignableAdvisor,
  Client,
  Product,
} from "@/types";

interface SolicitudesViewProps {
  initialApplications: ApplicationListItem[];
  documentProgress: Record<string, { received: number; reviewed: number; total: number }>;
  loadError: boolean;
  /** Milestone 17 — products eligible for origination, already filtered
   * server-side by getApplicationCreatableProducts(). */
  creatableProducts: Product[];
  productsLoadError: boolean;
  /** Milestone 17 — the pool the creation dialog's client search picks
   * from. Same real Client Engine rows /clientes renders. */
  clients: Client[];
  /** Milestone 23 — active staff eligible to own a file. */
  assignableAdvisorsByApplication: Record<string, AssignableAdvisor[]>;
  /** MILESTONE 25C-2 — passed straight through to ApplicationsTable. Decided
   * server-side from the effective view scope; this view only forwards it. */
  showBranchOrigin: boolean;
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
export function SolicitudesView({
  initialApplications,
  documentProgress,
  loadError,
  creatableProducts,
  productsLoadError,
  clients,
  assignableAdvisorsByApplication,
  showBranchOrigin,
}: SolicitudesViewProps) {
  const t = useTranslations();
  // Milestone 17 — origination is its own capability, deliberately wider
  // than application:set_status (an advisor may file a request but not
  // decide it). Enforced server-side by createSolicitudApplication.
  const canCreateApplication = useCapability("application:create");
  const [applications, setApplications] = useState<ApplicationListItem[]>(initialApplications);
  const [view, setView] = useState<"tabla" | "kanban">("tabla");
  const [createOpen, setCreateOpen] = useState(false);

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

  // MILESTONE 23. Mirrors handleStatusChange exactly, including the surgical
  // local update: assignApplicationAdvisor returns an Application, which
  // carries no productName/clientFullName (those are ApplicationListItem-only,
  // resolved by getApplications()), so replacing the whole row would blank
  // them. The advisor's display name is not returned by the mutation either —
  // it is resolved here from the same list the menu rendered from, which is
  // the only place the UI already legitimately knows it.
  const handleAdvisorChange = async (
    applicationId: string,
    advisorProfileId: string | null
  ) => {
    const result = await assignSolicitudAdvisor({ applicationId, advisorProfileId });

    if (result.status !== "success") {
      toast.error(
        t(
          result.code === "INVALID_ADVISOR"
            ? "applications.toasts.advisorInvalid"
            : "applications.toasts.advisorError"
        )
      );
      return;
    }

    const advisor = advisorProfileId
      ? (assignableAdvisorsByApplication[applicationId] ?? []).find(
          (candidate) => candidate.id === advisorProfileId
        )
      : undefined;

    setApplications((prev) =>
      prev.map((app) =>
        app.id === applicationId
          ? {
              ...app,
              assignedAdvisorProfileId: result.application.assignedAdvisorProfileId,
              assignedAdvisorFullName: advisor?.fullName,
            }
          : app
      )
    );

    toast.success(
      advisor
        ? t("applications.toasts.advisorAssigned", { name: advisor.fullName })
        : t("applications.toasts.advisorUnassigned")
    );
  };

  return (
    <div>
      <PageHeader
        title={t("applications.title")}
        description={t("applications.description")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
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
            {canCreateApplication && (
              <Button className="shrink-0" onClick={() => setCreateOpen(true)}>
                <FilePlus2 className="size-4" />
                {t("applications.create.trigger")}
              </Button>
            )}
          </div>
        }
      />

      {canCreateApplication && (
        <NewApplicationDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          products={creatableProducts}
          productsLoadError={productsLoadError}
          clients={clients}
        />
      )}

      {loadError ? (
        <EmptyState
          icon={List}
          title={t("applications.loadErrorTitle")}
          description={t("applications.loadErrorDescription")}
        />
      ) : view === "tabla" ? (
        <ApplicationsTable
          applications={applications}
          documentProgress={documentProgress}
          onStatusChange={handleStatusChange}
          assignableAdvisorsByApplication={assignableAdvisorsByApplication}
          showBranchOrigin={showBranchOrigin}
          onAdvisorChange={handleAdvisorChange}
        />
      ) : (
        <ApplicationsKanban
          applications={applications}
          documentProgress={documentProgress}
          onStatusChange={handleStatusChange}
        />
      )}
    </div>
  );
}
