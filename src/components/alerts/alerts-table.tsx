"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Search, ShieldAlert, FolderOpen, CheckCircle2, RotateCcw } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { ALERT_LEVEL_BADGE_CLASS, ALERT_LEVEL_VALUES, ALERT_TYPE_VALUES } from "@/lib/config/alert";
import { setDossierAlertStatus } from "@/app/(app)/expedientes/actions";
import { formatDate } from "@/lib/format";
import type { Locale } from "@/i18n/config";
import type { AlertLevel, AlertType, DossierAlertListItem } from "@/types";

interface AlertsTableProps {
  initialAlerts: DossierAlertListItem[];
  /** True when the parent page's getAllAlerts() call failed. Never falls
   * back to demo data or an empty-looking table — shows a distinct error
   * state instead. */
  loadError: boolean;
}

/**
 * Milestone 7B: reads real dossier_alerts data (via props from
 * src/app/(app)/alertas/page.tsx) instead of the demo ALERTS array, and
 * resolve/reactivate calls the same setDossierAlertStatus Server Action
 * the dossier tab uses — src/lib/services/alerts.ts's setAlertStatus is
 * the only place a status update is actually implemented. A status change
 * made here persists to the exact same dossier_alerts row the dossier tab
 * reads, so both surfaces always agree after a reload.
 */
export function AlertsTable({ initialAlerts, loadError }: AlertsTableProps) {
  const router = useRouter();
  const locale = useLocale() as Locale;
  const t = useTranslations();
  const [alerts, setAlerts] = useState<DossierAlertListItem[]>(initialAlerts);
  const [search, setSearch] = useState("");
  const [levelFilter, setLevelFilter] = useState<AlertLevel | "todos">("todos");
  const [typeFilter, setTypeFilter] = useState<AlertType | "todos">("todos");
  const [statusFilter, setStatusFilter] = useState<"todas" | "activas" | "resueltas">("todas");
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return alerts.filter((alert) => {
      const matchesSearch =
        term.length === 0 ||
        alert.clientFullName.toLowerCase().includes(term) ||
        alert.reason.toLowerCase().includes(term);
      const matchesLevel = levelFilter === "todos" || alert.level === levelFilter;
      const matchesType = typeFilter === "todos" || alert.type === typeFilter;
      const matchesStatus =
        statusFilter === "todas" ||
        (statusFilter === "activas" && alert.active) ||
        (statusFilter === "resueltas" && !alert.active);
      return matchesSearch && matchesLevel && matchesType && matchesStatus;
    });
  }, [alerts, search, levelFilter, typeFilter, statusFilter]);

  const toggleResolved = async (alert: DossierAlertListItem) => {
    setResolvingId(alert.id);
    const result = await setDossierAlertStatus({ alertId: alert.id, targetActive: !alert.active });
    setResolvingId(null);

    if (result.status !== "success") {
      toast.error(t("alertsModule.toasts.error"));
      return;
    }

    // Local replacement of only the fields the mutation can ever change,
    // not a full-row replace — setDossierAlertStatus returns a bare
    // DossierAlert (no clientFullName), and a resolve/reactivate can
    // never itself change which client the alert belongs to. Same
    // discipline as dossier-view.tsx#handleApplicationStatusChange.
    setAlerts((prev) =>
      prev.map((item) =>
        item.id === alert.id
          ? {
              ...item,
              active: result.alert.active,
              resolvedAt: result.alert.resolvedAt,
              resolvedByProfileId: result.alert.resolvedByProfileId,
              resolvedByFullName: result.alert.resolvedByFullName,
            }
          : item
      )
    );
    toast.success(alert.active ? t("alertsModule.toasts.resolved") : t("alertsModule.toasts.reactivated"));
  };

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
        <div className="relative lg:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("alertsModule.searchPlaceholder")}
            className="pl-8"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>

        <Select
          value={statusFilter}
          onValueChange={(value) => value && setStatusFilter(value as typeof statusFilter)}
        >
          <SelectTrigger className="w-full lg:w-44">
            <SelectValue>
              {(value: string) =>
                value === "todas"
                  ? t("alertsModule.filterAll")
                  : value === "activas"
                    ? t("alertsModule.filterActive")
                    : t("alertsModule.filterResolved")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">{t("alertsModule.filterAll")}</SelectItem>
            <SelectItem value="activas">{t("alertsModule.filterActive")}</SelectItem>
            <SelectItem value="resueltas">{t("alertsModule.filterResolved")}</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={levelFilter}
          onValueChange={(value) => value && setLevelFilter(value as AlertLevel | "todos")}
        >
          <SelectTrigger className="w-full lg:w-44">
            <SelectValue>
              {(value: string) =>
                value === "todos"
                  ? t("alertsModule.allLevels")
                  : t(`statuses.alertLevel.${value as AlertLevel}`)
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">{t("alertsModule.allLevels")}</SelectItem>
            {ALERT_LEVEL_VALUES.map((level) => (
              <SelectItem key={level} value={level}>
                {t(`statuses.alertLevel.${level}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={typeFilter}
          onValueChange={(value) => value && setTypeFilter(value as AlertType | "todos")}
        >
          <SelectTrigger className="w-full lg:w-64">
            <SelectValue>
              {(value: string) =>
                value === "todos"
                  ? t("alertsModule.allTypes")
                  : t(`statuses.alertType.${value as AlertType}`)
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">{t("alertsModule.allTypes")}</SelectItem>
            {ALERT_TYPE_VALUES.map((type) => (
              <SelectItem key={type} value={type}>
                {t(`statuses.alertType.${type}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {loadError ? (
        <div className="p-4">
          <EmptyState
            icon={ShieldAlert}
            title={t("alertsModule.loadErrorTitle")}
            description={t("alertsModule.loadErrorDescription")}
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className="p-4">
          <EmptyState
            icon={ShieldAlert}
            title={t("alertsModule.emptyTitle")}
            description={t("alertsModule.emptyDescription")}
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("alertsModule.columns.client")}</TableHead>
                <TableHead>{t("alertsModule.columns.type")}</TableHead>
                <TableHead>{t("alertsModule.columns.level")}</TableHead>
                <TableHead>{t("alertsModule.columns.reason")}</TableHead>
                <TableHead>{t("alertsModule.columns.date")}</TableHead>
                <TableHead>{t("alertsModule.columns.responsible")}</TableHead>
                <TableHead>{t("alertsModule.columns.status")}</TableHead>
                <TableHead className="text-right">{t("alertsModule.columns.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((alert) => {
                return (
                  <TableRow key={alert.id}>
                    <TableCell className="font-medium text-foreground">
                      {alert.clientFullName}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {t(`statuses.alertType.${alert.type}`)}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        label={t(`statuses.alertLevel.${alert.level}`)}
                        className={ALERT_LEVEL_BADGE_CLASS[alert.level]}
                      />
                    </TableCell>
                    <TableCell className="max-w-xs truncate text-muted-foreground">
                      {alert.reason}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(alert.createdAt, locale)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {alert.createdByFullName}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        label={alert.active ? t("alertsModule.active") : t("alertsModule.resolved")}
                        className={
                          alert.active
                            ? "bg-warning/10 text-warning border-warning/20"
                            : "bg-success/10 text-success border-success/20"
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button variant="ghost" size="icon" disabled={resolvingId === alert.id}>
                              <MoreHorizontal className="size-4" />
                              <span className="sr-only">{t("common.actions")}</span>
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            onClick={() => router.push(`/expedientes/${alert.clientId}?tab=alertas`)}
                          >
                            <FolderOpen className="size-4" />
                            {t("alertsModule.viewDossier")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => toggleResolved(alert)}>
                            {alert.active ? (
                              <>
                                <CheckCircle2 className="size-4" />
                                {t("alertsModule.markResolved")}
                              </>
                            ) : (
                              <>
                                <RotateCcw className="size-4" />
                                {t("alertsModule.reactivate")}
                              </>
                            )}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
