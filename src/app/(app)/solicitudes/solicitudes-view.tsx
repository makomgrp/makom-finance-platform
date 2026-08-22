"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { List, LayoutGrid, FilePlus2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { ApplicationsTable } from "@/components/applications/applications-table";
import { PipelineKanban } from "@/components/applications/pipeline-kanban";
import {
  LogFollowUpDialog,
  type LogFollowUpSubmit,
} from "@/components/applications/log-follow-up-dialog";
import { NewApplicationDialog } from "@/components/applications/new-application-dialog";
import {
  assignSolicitudAdvisor,
  completeFollowUpActionAction,
  logFollowUpAction,
  setSolicitudApplicationStatus,
} from "@/app/(app)/solicitudes/actions";
import { useCapability } from "@/lib/auth/use-capability";
import { cn } from "@/lib/utils";
import { useSearchParamState } from "@/lib/hooks/use-search-param-state";
import type {
  ApplicationListItem,
  ApplicationStatus,
  PipelineCard,
  AssignableAdvisor,
  Client,
  Product,
} from "@/types";

interface SolicitudesViewProps {
  /**
   * FORMAL applications only — this is what the table renders.
   *
   * MILESTONE 26B-5A: the table and the board deliberately disagree about what
   * they contain. The table is the register of applications ODL has received;
   * the board is the operational pipeline, which includes prospects still
   * filling in the portal. Feeding both from one list would force one of them
   * to be wrong.
   */
  initialApplications: ApplicationListItem[];
  /** The unified board: leads AND formal applications. */
  pipelineCards: PipelineCard[];
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
const VIEW_VALUES = ["tabla", "kanban"] as const;

export function SolicitudesView({
  initialApplications,
  pipelineCards,
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
  // MILESTONE 26B-8 — which board the user is on is part of the address, so a
  // Dashboard link can open the pipeline directly and a reload does not throw
  // them back to the table.
  const { read, write } = useSearchParamState();
  const view = read<"tabla" | "kanban">("view", VIEW_VALUES, "tabla");
  const setView = (next: "tabla" | "kanban") =>
    write({ view: { value: next, defaultValue: "tabla" } });
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
  const router = useRouter();

  // Which card asked to log a follow-up. Null closes the dialog.
  const [followUpTarget, setFollowUpTarget] = useState<PipelineCard | null>(null);

  const handleLogFollowUp = async (values: LogFollowUpSubmit) => {
    if (!followUpTarget) return;
    const result = await logFollowUpAction({
      applicationId: followUpTarget.id,
      ...values,
    });

    if (result.status !== "success") {
      toast.error(t("followUp.toasts.saveError"));
      return;
    }

    toast.success(t("followUp.toasts.saved"));
    // Re-read from the server rather than patching the card locally: last
    // contact and next action are DERIVED from the whole follow-up history, and
    // a local guess would disagree with the next refresh.
    router.refresh();
  };

  const handleCompleteAction = async (applicationId: string, followUpId: string) => {
    const result = await completeFollowUpActionAction({ applicationId, followUpId });
    if (result.status !== "success") {
      toast.error(t("followUp.toasts.completeError"));
      return;
    }
    toast.success(t("followUp.toasts.completed"));
    // Re-read: the card's next action is the OLDEST outstanding one, so
    // completing this one may promote a different action into its place.
    router.refresh();
  };

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

    // MILESTONE 26B-6A — the optimistic update above patches `applications`,
    // which is the TABLE's list. The board renders from `pipelineCards`, a
    // server prop, so without this the assignment succeeded in the database
    // while the card kept reading "Sin asignar" until a manual reload. Found by
    // assigning a real advisor through the UI and watching nothing change.
    router.refresh();
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
        <PipelineKanban
          cards={pipelineCards}
          onStatusChange={handleStatusChange}
          assignableAdvisorsByApplication={assignableAdvisorsByApplication}
          onAdvisorChange={handleAdvisorChange}
          onLogFollowUp={setFollowUpTarget}
          onCompleteAction={handleCompleteAction}
        />
      )}

      {/* MILESTONE 26B-6 — one dialog for the whole board. Which process it
          writes to is state, not a dialog per card. */}
      <LogFollowUpDialog
        open={followUpTarget !== null}
        onOpenChange={(next) => {
          if (!next) setFollowUpTarget(null);
        }}
        subjectName={followUpTarget?.fullName}
        onSubmit={handleLogFollowUp}
      />
    </div>
  );
}
