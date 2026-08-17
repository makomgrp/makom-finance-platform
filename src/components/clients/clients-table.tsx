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
  CLIENT_STATUS_BADGE_CLASS,
  CLIENT_STATUS_VALUES,
} from "@/lib/config/client-status";
import { getCompanyById } from "@/lib/demo-data";
import { setClientStatusAction } from "@/app/(app)/clientes/actions";
import { useCapability } from "@/lib/auth/use-capability";
import { formatDate, getInitials } from "@/lib/format";
import type { ApplicationListItem, Client, ClientStatus } from "@/types";
import type { Locale } from "@/i18n/config";

const PAGE_SIZE = 8;

interface ClientsTableProps {
  /** Milestone 14C: the real Client Engine's rows (src/lib/services/
   * clients.ts#getClients()) — replaces the demo CLIENTS array this
   * component used to seed itself from. */
  initialClients: Client[];
  /** Milestone 13F: real Applications, used to compute each client's
   * application count. Milestone 14E: counted via the real
   * application.clientId === client.id relationship (applications.
   * client_id is now a real, FK-constrained reference) — replaces the
   * former clientLegacyId-based match, and now correctly includes
   * Applications for a client with no legacyId too. */
  applications: ApplicationListItem[];
}

export function ClientsTable({ initialClients, applications }: ClientsTableProps) {
  const router = useRouter();
  const locale = useLocale() as Locale;
  const t = useTranslations();
  // Milestone 16. Three separate capabilities, not one "can edit clients"
  // flag: creating, editing and status-changing a client are granted to
  // different sets of roles (an advisor may do the first two but not the
  // third). Search, filtering, the table itself and every navigation item
  // stay available to every role, `consulta` included.
  const canCreateClient = useCapability("client:create");
  const canUpdateClient = useCapability("client:update");
  const canSetClientStatus = useCapability("client:set_status");
  const [clients, setClients] = useState<Client[]>(initialClients);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ClientStatus | "todos">("todos");
  const [page, setPage] = useState(1);
  const [editingClient, setEditingClient] = useState<Client | null>(null);

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

  const handleCreated = (client: Client) => {
    setClients((prev) => [client, ...prev]);
    setPage(1);
  };

  const handleUpdated = (client: Client) => {
    setClients((prev) => prev.map((existing) => (existing.id === client.id ? client : existing)));
  };

  const handleStatusChange = async (clientId: string, status: ClientStatus) => {
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
              setStatusFilter(value as ClientStatus | "todos");
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full sm:w-52">
              <SelectValue placeholder={t("common.status")}>
                {(value: string) =>
                  value === "todos"
                    ? t("clients.allStatuses")
                    : t(`statuses.client.${value as ClientStatus}`)
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">{t("clients.allStatuses")}</SelectItem>
              {CLIENT_STATUS_VALUES.map((status) => (
                <SelectItem key={status} value={status}>
                  {t(`statuses.client.${status}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {canCreateClient && (
          <RealClientFormDialog
            onSaved={handleCreated}
            trigger={
              <Button className="shrink-0">
                <UserPlus className="size-4" />
                {t("clients.newClient")}
              </Button>
            }
          />
        )}
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
                  (application) => application.clientId === client.id
                ).length;
                return (
                  <TableRow key={client.id}>
                    <TableCell>
                      {/* Milestone 14D: the Dossier route now resolves a
                          real Client uuid directly (see
                          expedientes/[id]/page.tsx#resolveClient) — every
                          real client, seeded or newly-created, is
                          navigable by client.id. legacyId is no longer
                          needed for routing at all. */}
                      <button
                        onClick={() => router.push(`/expedientes/${client.id}`)}
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
                          className={CLIENT_STATUS_BADGE_CLASS[client.status]}
                        />
                        {canSetClientStatus && (
                          <ApplicationStatusMenu
                            options={CLIENT_STATUS_VALUES.filter((status) => status !== client.status).map(
                              (status) => ({
                                value: status,
                                label: t(`statuses.client.${status}`),
                              })
                            )}
                            onChange={(status) => handleStatusChange(client.id, status as ClientStatus)}
                          />
                        )}
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
                          <DropdownMenuItem onClick={() => router.push(`/expedientes/${client.id}`)}>
                            <FolderOpen className="size-4" />
                            {t("clients.rowActions.viewDossier")}
                          </DropdownMenuItem>
                          {canUpdateClient && (
                            <DropdownMenuItem onClick={() => setEditingClient(client)}>
                              <Pencil className="size-4" />
                              {t("clients.rowActions.edit")}
                            </DropdownMenuItem>
                          )}
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
                          <DropdownMenuItem onClick={() => router.push(`/expedientes/${client.id}?tab=notas`)}>
                            <StickyNote className="size-4" />
                            {t("clients.rowActions.addNote")}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => router.push(`/expedientes/${client.id}?tab=alertas`)}>
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
