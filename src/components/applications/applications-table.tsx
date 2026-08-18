"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Building2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { PaginationBar } from "@/components/shared/pagination-bar";
import { ApplicationStatusMenu } from "@/components/applications/application-status-menu";
import { AdvisorAssignMenu } from "@/components/applications/advisor-assign-menu";
import { BranchTransferDialog } from "@/components/branches/branch-transfer-dialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  getApplicationTransferOptionsAction,
  transferApplicationBranchAction,
} from "@/app/(app)/solicitudes/actions";
import {
  APPLICATION_STATUS_BADGE_CLASS,
  APPLICATION_STATUS_ORDER,
  APPLICATION_STATUS_TRANSITIONS,
} from "@/lib/config/application";
import { formatDate, formatRelativeTime } from "@/lib/format";
import { useCapability } from "@/lib/auth/use-capability";
import type { Locale } from "@/i18n/config";
import type { ApplicationListItem, ApplicationStatus, AssignableAdvisor } from "@/types";

interface ApplicationsTableProps {
  applications: ApplicationListItem[];
  /** Per-application document-kind Requirement Slot completion, keyed by
   * application id — see src/lib/services/requirement-slots.ts#
   * getDocumentSlotCompletionCounts. A missing key means "0 of 0", not an
   * error. Replaces the demo LoanApplication.documentationProgress field,
   * which is never stored on the real Application. */
  documentSlotCounts: Record<string, { completed: number; total: number }>;
  onStatusChange: (applicationId: string, status: ApplicationStatus) => void;
  /** Milestone 23 — staff eligible to own a file, resolved server-side by
   * getAssignableAdvisorsForApplications().
   *
   * MILESTONE 25B-2: keyed BY APPLICATION, because eligibility depends on the
   * application's branch as well as the advisor. A missing key means "no
   * eligible advisor for this file" and the menu then offers only "unassign",
   * never a fabricated list — exactly as an empty array did before. */
  assignableAdvisorsByApplication: Record<string, AssignableAdvisor[]>;
  onAdvisorChange: (applicationId: string, advisorProfileId: string | null) => void;
}

const PAGE_SIZE = 8;

export function ApplicationsTable({
  applications,
  documentSlotCounts,
  onStatusChange,
  assignableAdvisorsByApplication,
  onAdvisorChange,
}: ApplicationsTableProps) {
  // Milestone 16 — `application:set_status` (administrador/gerente). The
  // application list itself stays readable by every role; only the
  // status-change affordance is gated. See the capability's note in
  // src/lib/auth/capabilities.ts for why it sits this high today.
  const canSetApplicationStatus = useCapability("application:set_status");
  // Milestone 23 — `application:assign_advisor` (administrador/gerente).
  // Deliberately its own capability, not application:set_status: deciding
  // who WORKS a file is not the lending determination.
  const canAssignAdvisor = useCapability("application:assign_advisor");
  // MILESTONE 25B-3 — `branch:transfer`. Visible does not mean permitted: the
  // database requires scope over BOTH source and destination.
  const canTransferBranch = useCapability("branch:transfer");
  const router = useRouter();
  const locale = useLocale() as Locale;
  const t = useTranslations();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "todos">("todos");
  const [page, setPage] = useState(1);
  const [transferApplicationId, setTransferApplicationId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return applications.filter((app) => {
      const matchesSearch =
        term.length === 0 ||
        app.applicationNumber.toLowerCase().includes(term) ||
        app.clientFullName.toLowerCase().includes(term);
      const matchesStatus = statusFilter === "todos" || app.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [applications, search, statusFilter]);

  const totalPages = Math.max(Math.ceil(filtered.length / PAGE_SIZE), 1);
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="relative sm:w-72">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("applications.searchPlaceholder")}
            className="pl-8"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select
          value={statusFilter}
          onValueChange={(value) => {
            if (!value) return;
            setStatusFilter(value as ApplicationStatus | "todos");
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue placeholder={t("common.status")}>
              {(value: string) =>
                value === "todos"
                  ? t("applications.allStatuses")
                  : t(`statuses.applicationStatus.${value as ApplicationStatus}`)
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">{t("applications.allStatuses")}</SelectItem>
            {APPLICATION_STATUS_ORDER.map((status) => (
              <SelectItem key={status} value={status}>
                {t(`statuses.applicationStatus.${status}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {paginated.length === 0 ? (
        <div className="p-4">
          <EmptyState
            icon={Search}
            title={t("applications.emptyTitle")}
            description={t("applications.emptyDescription")}
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("applications.columns.number")}</TableHead>
                <TableHead>{t("applications.columns.client")}</TableHead>
                <TableHead>{t("applications.columns.loanType")}</TableHead>
                <TableHead>{t("applications.columns.requestDate")}</TableHead>
                <TableHead>{t("applications.columns.advisor")}</TableHead>
                <TableHead>{t("applications.columns.status")}</TableHead>
                <TableHead className="w-40">{t("applications.columns.documentation")}</TableHead>
                <TableHead>{t("applications.columns.lastActivity")}</TableHead>
                <TableHead className="text-right">{t("applications.columns.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.map((app) => {
                const counts = documentSlotCounts[app.id] ?? { completed: 0, total: 0 };
                const documentationPercent = counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0;
                const legalTargets = APPLICATION_STATUS_TRANSITIONS[app.status];

                return (
                  <TableRow key={app.id}>
                    <TableCell className="font-medium text-foreground">
                      {app.applicationNumber}
                    </TableCell>
                    <TableCell>
                      <button
                        onClick={() => router.push(`/expedientes/${app.clientId}?solicitud=${app.id}`)}
                        className="text-foreground hover:underline"
                      >
                        {app.clientFullName}
                      </button>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {app.productName[locale]}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(app.createdAt, locale)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {canAssignAdvisor ? (
                        <AdvisorAssignMenu
                          advisors={assignableAdvisorsByApplication[app.id] ?? []}
                          currentAdvisorProfileId={app.assignedAdvisorProfileId}
                          currentAdvisorFullName={app.assignedAdvisorFullName}
                          onChange={(advisorProfileId) =>
                            onAdvisorChange(app.id, advisorProfileId)
                          }
                        />
                      ) : (
                        (app.assignedAdvisorFullName ?? "—")
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        label={t(`statuses.applicationStatus.${app.status}`)}
                        className={APPLICATION_STATUS_BADGE_CLASS[app.status]}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress value={documentationPercent} />
                        <span className="w-9 shrink-0 text-xs text-muted-foreground">
                          {documentationPercent}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatRelativeTime(app.statusChangedAt ?? app.createdAt, locale, t)}
                    </TableCell>
                    <TableCell className="text-right">
                      {canTransferBranch && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setTransferApplicationId(app.id)}
                        >
                          <Building2 className="size-4" />
                          <span className="sr-only">{t("branchTransfer.titleApplication")}</span>
                        </Button>
                      )}
                      {canSetApplicationStatus && (
                        <ApplicationStatusMenu
                          options={legalTargets.map((status) => ({
                            value: status,
                            label: t(`statuses.applicationStatus.${status}`),
                          }))}
                          triggerDisabled={legalTargets.length === 0}
                          onChange={(status) => onStatusChange(app.id, status as ApplicationStatus)}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {transferApplicationId && (
        <BranchTransferDialog
          open
          onOpenChange={(next) => {
            if (!next) setTransferApplicationId(null);
          }}
          entity="application"
          loadOptions={() => getApplicationTransferOptionsAction(transferApplicationId)}
          onConfirm={async (destinationBranchId) => {
            const result = await transferApplicationBranchAction({
              applicationId: transferApplicationId,
              destinationBranchId,
            });
            if (result.status === "error") {
              return result.code === "INVALID_DESTINATION"
                ? t("branchTransfer.errorDestination")
                : result.code === "NOT_FOUND"
                  ? t("branchTransfer.errorNotFound")
                  : t("branchTransfer.error");
            }
            // A transfer can strip the advisor. Saying so is the whole point:
            // an ownership change the manager does not notice is worse than
            // the reassignment it forces.
            toast.success(
              result.advisorCleared
                ? t("branchTransfer.successAdvisorCleared")
                : t("branchTransfer.success")
            );
            router.refresh();
            return null;
          }}
        />
      )}

      <PaginationBar
        page={currentPage}
        totalPages={totalPages}
        totalItems={filtered.length}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
      />
    </div>
  );
}
