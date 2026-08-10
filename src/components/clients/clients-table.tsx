"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  MoreHorizontal,
  Search,
  UserPlus,
  FolderOpen,
  Pencil,
  FilePlus2,
  StickyNote,
  ShieldAlert,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { PaginationBar } from "@/components/shared/pagination-bar";
import { RealClientFormDialog } from "@/components/clients/real-client-form-dialog";
import { ApplicationStatusMenu } from "@/components/applications/application-status-menu";
import {
  REAL_CLIENT_STATUS_BADGE_CLASS,
  REAL_CLIENT_STATUS_VALUES,
} from "@/lib/config/client-status";
import { getCompanyById } from "@/lib/demo-data";
import { setClientStatusAction } from "@/app/(app)/clientes/actions";
import { formatDate, getInitials } from "@/lib/format";
import type { ApplicationListItem, RealClient, RealClientStatus } from "@/types";
import type { Locale } from "@/i18n/config";

const PAGE_SIZE = 8;

interface ClientsTableProps {
  /** Milestone 14C: the real Client Engine's rows (src/lib/services/
   * clients.ts#getClients()) — replaces the demo CLIENTS array this
   * component used to seed itself from. */
  initialClients: RealClient[];
  /** Milestone 13F: real Applications, used to compute each client's
   * application count via clientLegacyId — unchanged by this milestone;
   * the bridge field is now read off RealClient.legacyId instead of the
   * demo Client.id, since client_legacy_id itself is untouched. */
  applications: ApplicationListItem[];
}

export function ClientsTable({ initialClients, applications }: ClientsTableProps) {
  const router = useRouter();
  const locale = useLocale() as Locale;
  const t = useTranslations();
  const [clients, setClients] = useState<RealClient[]>(initialClients);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<RealClientStatus | "todos">("todos");
  const [page, setPage] = useState(1);
  const [editingClient, setEditingClient] = useState<RealClient | null>(null);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return clients.filter((client) => {
      const matchesSearch =
        term.length === 0 ||
        client.fullName.toLowerCase().includes(term) ||
        client.identificationNumber.toLowerCase().includes(term) ||
        client.email.toLowerCase().includes(term);
      const matchesStatus = statusFilter === "todos" || client.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [clients, search, statusFilter]);

  const totalPages = Math.max(Math.ceil(filtered.length / PAGE_SIZE), 1);
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const handleCreated = (client: RealClient) => {
    setClients((prev) => [client, ...prev]);
    setPage(1);
  };

  const handleUpdated = (client: RealClient) => {
    setClients((prev) => prev.map((existing) => (existing.id === client.id ? client : existing)));
  };

  const handleStatusChange = async (clientId: string, status: RealClientStatus) => {
    const result = await setClientStatusAction({ clientId, status });
    if (result.status !== "success") {
      toast.error(t("clients.toasts.statusChangeError"));
      return;
    }
    setClients((prev) => prev.map((client) => (client.id === clientId ? result.client : client)));
    toast.success(t("clients.toasts.statusChanged", { status: t(`statuses.client.${status}`) }));
  };

  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative sm:w-72">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t("clients.searchPlaceholder")}
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
              setStatusFilter(value as RealClientStatus | "todos");
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full sm:w-52">
              <SelectValue placeholder={t("common.status")}>
                {(value: string) =>
                  value === "todos"
                    ? t("clients.allStatuses")
                    : t(`statuses.client.${value as RealClientStatus}`)
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">{t("clients.allStatuses")}</SelectItem>
              {REAL_CLIENT_STATUS_VALUES.map((status) => (
                <SelectItem key={status} value={status}>
                  {t(`statuses.client.${status}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <RealClientFormDialog
          onSaved={handleCreated}
          trigger={
            <Button className="shrink-0">
              <UserPlus className="size-4" />
              {t("clients.newClient")}
            </Button>
          }
        />
      </div>

      {paginated.length === 0 ? (
        <div className="p-4">
          <EmptyState
            icon={Search}
            title={t("clients.emptyTitle")}
            description={t("clients.emptyDescription")}
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("clients.columns.fullName")}</TableHead>
                <TableHead>{t("clients.columns.phone")}</TableHead>
                <TableHead>{t("clients.columns.idNumber")}</TableHead>
                <TableHead>{t("clients.columns.company")}</TableHead>
                <TableHead className="text-center">{t("clients.columns.applications")}</TableHead>
                <TableHead>{t("clients.columns.status")}</TableHead>
                <TableHead>{t("clients.columns.registeredAt")}</TableHead>
                <TableHead className="text-right">{t("clients.columns.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.map((client) => {
                const company = client.companyLegacyId ? getCompanyById(client.companyLegacyId) : undefined;
                const applicationCount = applications.filter(
                  (application) => client.legacyId !== undefined && application.clientLegacyId === client.legacyId
                ).length;
                // A newly-created real client has no legacyId, so the
                // Dossier (still demo-Client-id-routed until Milestone
                // 14D) has no route to resolve it by — disable the
                // Dossier-dependent actions rather than ship a broken
                // link, per the Milestone 14C implementation report.
                const hasDossier = client.legacyId !== undefined;

                return (
                  <TableRow key={client.id}>
                    <TableCell>
                      {hasDossier ? (
                        <button
                          onClick={() => router.push(`/expedientes/${client.legacyId}`)}
                          className="flex items-center gap-2.5 text-left"
                        >
                          <Avatar className="size-8">
                            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                              {getInitials(client.fullName)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium text-foreground hover:underline">
                            {client.fullName}
                          </span>
                        </button>
                      ) : (
                        <div className="flex items-center gap-2.5">
                          <Avatar className="size-8">
                            <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                              {getInitials(client.fullName)}
                            </AvatarFallback>
                          </Avatar>
                          <span className="font-medium text-foreground">{client.fullName}</span>
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{client.phone}</TableCell>
                    <TableCell className="text-muted-foreground">{client.identificationNumber}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {company?.name ?? "—"}
                    </TableCell>
                    <TableCell className="text-center text-muted-foreground">
                      {applicationCount}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <StatusBadge
                          label={t(`statuses.client.${client.status}`)}
                          className={REAL_CLIENT_STATUS_BADGE_CLASS[client.status]}
                        />
                        <ApplicationStatusMenu
                          options={REAL_CLIENT_STATUS_VALUES.filter((status) => status !== client.status).map(
                            (status) => ({
                              value: status,
                              label: t(`statuses.client.${status}`),
                            })
                          )}
                          onChange={(status) => handleStatusChange(client.id, status as RealClientStatus)}
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(client.createdAt, locale)}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={
                            <Button variant="ghost" size="icon">
                              <MoreHorizontal className="size-4" />
                              <span className="sr-only">{t("common.actions")}</span>
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            disabled={!hasDossier}
                            onClick={() => hasDossier && router.push(`/expedientes/${client.legacyId}`)}
                          >
                            <FolderOpen className="size-4" />
                            {t("clients.rowActions.viewDossier")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setEditingClient(client)}>
                            <Pencil className="size-4" />
                            {t("clients.rowActions.edit")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={() => {
                              toast.info(
                                t("clients.toasts.newApplicationDemo", { name: client.fullName })
                              );
                              router.push("/solicitudes");
                            }}
                          >
                            <FilePlus2 className="size-4" />
                            {t("clients.rowActions.createApplication")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!hasDossier}
                            onClick={() => hasDossier && router.push(`/expedientes/${client.legacyId}?tab=notas`)}
                          >
                            <StickyNote className="size-4" />
                            {t("clients.rowActions.addNote")}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!hasDossier}
                            onClick={() => hasDossier && router.push(`/expedientes/${client.legacyId}?tab=alertas`)}
                          >
                            <ShieldAlert className="size-4" />
                            {t("clients.rowActions.registerAlert")}
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

      <PaginationBar
        page={currentPage}
        totalPages={totalPages}
        totalItems={filtered.length}
        pageSize={PAGE_SIZE}
        onPageChange={setPage}
      />

      {editingClient && (
        <RealClientFormDialog
          key={editingClient.id}
          initialClient={editingClient}
          onSaved={handleUpdated}
          open={editingClient !== null}
          onOpenChange={(value) => {
            if (!value) setEditingClient(null);
          }}
        />
      )}
    </div>
  );
}
