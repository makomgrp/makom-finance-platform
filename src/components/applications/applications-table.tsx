"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Search } from "lucide-react";
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
import {
  APPLICATION_STATUS_BADGE_CLASS,
  APPLICATION_STATUS_ORDER,
  APPLICATION_STATUS_TRANSITIONS,
} from "@/lib/config/application";
import { getClientById } from "@/lib/demo-data";
import { formatDate, formatRelativeTime } from "@/lib/format";
import type { Locale } from "@/i18n/config";
import type { ApplicationListItem, ApplicationStatus } from "@/types";

interface ApplicationsTableProps {
  applications: ApplicationListItem[];
  /** Per-application document-kind Requirement Slot completion, keyed by
   * application id — see src/lib/services/requirement-slots.ts#
   * getDocumentSlotCompletionCounts. A missing key means "0 of 0", not an
   * error. Replaces the demo LoanApplication.documentationProgress field,
   * which is never stored on the real Application. */
  documentSlotCounts: Record<string, { completed: number; total: number }>;
  onStatusChange: (applicationId: string, status: ApplicationStatus) => void;
}

const PAGE_SIZE = 8;

export function ApplicationsTable({ applications, documentSlotCounts, onStatusChange }: ApplicationsTableProps) {
  const router = useRouter();
  const locale = useLocale() as Locale;
  const t = useTranslations();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "todos">("todos");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return applications.filter((app) => {
      const client = getClientById(app.clientLegacyId);
      const matchesSearch =
        term.length === 0 ||
        app.applicationNumber.toLowerCase().includes(term) ||
        client?.fullName.toLowerCase().includes(term);
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
                const client = getClientById(app.clientLegacyId);
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
                        onClick={() =>
                          router.push(`/expedientes/${app.clientLegacyId}?solicitud=${app.id}`)
                        }
                        className="text-foreground hover:underline"
                      >
                        {client?.fullName ?? "—"}
                      </button>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {app.productName[locale]}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(app.createdAt, locale)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {app.assignedAdvisorFullName ?? "—"}
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
                      <ApplicationStatusMenu
                        options={legalTargets.map((status) => ({
                          value: status,
                          label: t(`statuses.applicationStatus.${status}`),
                        }))}
                        triggerDisabled={legalTargets.length === 0}
                        onChange={(status) => onStatusChange(app.id, status as ApplicationStatus)}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
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
