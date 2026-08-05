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
import { LOAN_STATUS_BADGE_CLASS, LOAN_STATUS_ORDER } from "@/lib/config/loan-status";
import { getClientById, getUserById } from "@/lib/demo-data";
import { formatDate, formatRelativeTime } from "@/lib/format";
import type { Locale } from "@/i18n/config";
import type { LoanApplication, LoanStatus } from "@/types";

interface ApplicationsTableProps {
  applications: LoanApplication[];
  onStatusChange: (applicationId: string, status: LoanStatus) => void;
}

const PAGE_SIZE = 8;

export function ApplicationsTable({ applications, onStatusChange }: ApplicationsTableProps) {
  const router = useRouter();
  const locale = useLocale() as Locale;
  const t = useTranslations();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<LoanStatus | "todos">("todos");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return applications.filter((app) => {
      const client = getClientById(app.clientId);
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
            setStatusFilter(value as LoanStatus | "todos");
            setPage(1);
          }}
        >
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue placeholder={t("common.status")}>
              {(value: string) =>
                value === "todos"
                  ? t("applications.allStatuses")
                  : t(`statuses.loanApplication.${value as LoanStatus}`)
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">{t("applications.allStatuses")}</SelectItem>
            {LOAN_STATUS_ORDER.map((status) => (
              <SelectItem key={status} value={status}>
                {t(`statuses.loanApplication.${status}`)}
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
                const client = getClientById(app.clientId);
                const advisor = getUserById(app.advisorId);

                return (
                  <TableRow key={app.id}>
                    <TableCell className="font-medium text-foreground">
                      {app.applicationNumber}
                    </TableCell>
                    <TableCell>
                      <button
                        onClick={() =>
                          router.push(`/expedientes/${app.clientId}?solicitud=${app.id}`)
                        }
                        className="text-foreground hover:underline"
                      >
                        {client?.fullName ?? "—"}
                      </button>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {t(`statuses.loanType.${app.loanType}`)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(app.requestDate, locale)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {advisor?.fullName ?? "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        label={t(`statuses.loanApplication.${app.status}`)}
                        className={LOAN_STATUS_BADGE_CLASS[app.status]}
                      />
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress value={app.documentationProgress} />
                        <span className="w-9 shrink-0 text-xs text-muted-foreground">
                          {app.documentationProgress}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatRelativeTime(app.lastActivityAt, locale, t)}
                    </TableCell>
                    <TableCell className="text-right">
                      <ApplicationStatusMenu
                        currentStatus={app.status}
                        onChange={(status) => onStatusChange(app.id, status)}
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
