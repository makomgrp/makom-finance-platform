"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { MoreHorizontal, Eye, FolderOpen } from "lucide-react";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { PaginationBar } from "@/components/shared/pagination-bar";
import { DocumentStatusSummary } from "@/components/documents/document-status-summary";
import { DOCUMENT_STATUS_BADGE_CLASS, DOCUMENT_STATUS_ORDER, DOCUMENT_TYPE_ORDER } from "@/lib/config/document";
import {
  DOCUMENTS as INITIAL_DOCUMENTS,
  ADVISORS,
  getApplicationById,
  getClientById,
  getUserById,
} from "@/lib/demo-data";
import { formatDate } from "@/lib/format";
import type { Locale } from "@/i18n/config";
import type { DocumentRecord, DocumentStatus, DocumentType } from "@/types";

const PAGE_SIZE = 10;

export function DocumentsTable() {
  const router = useRouter();
  const locale = useLocale() as Locale;
  const t = useTranslations();
  const [documents] = useState<DocumentRecord[]>(INITIAL_DOCUMENTS);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<DocumentStatus | "todos">("todos");
  const [typeFilter, setTypeFilter] = useState<DocumentType | "todos">("todos");
  const [advisorFilter, setAdvisorFilter] = useState<string>("todos");
  const [page, setPage] = useState(1);

  const rows = useMemo(() => {
    return documents.map((doc) => {
      const client = getClientById(doc.clientId);
      const application = getApplicationById(doc.applicationId);
      const reviewer = doc.reviewedByUserId ? getUserById(doc.reviewedByUserId) : undefined;
      const advisor = application ? getUserById(application.advisorId) : undefined;
      return { doc, client, application, reviewer, advisor };
    });
  }, [documents]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter(({ doc, client, application, advisor }) => {
      const matchesSearch =
        term.length === 0 ||
        client?.fullName.toLowerCase().includes(term) ||
        application?.applicationNumber.toLowerCase().includes(term);
      const matchesStatus = statusFilter === "todos" || doc.status === statusFilter;
      const matchesType = typeFilter === "todos" || doc.type === typeFilter;
      const matchesAdvisor = advisorFilter === "todos" || advisor?.id === advisorFilter;
      return matchesSearch && matchesStatus && matchesType && matchesAdvisor;
    });
  }, [rows, search, statusFilter, typeFilter, advisorFilter]);

  const totalPages = Math.max(Math.ceil(filtered.length / PAGE_SIZE), 1);
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  return (
    <div className="space-y-4">
      <DocumentStatusSummary
        activeStatus={statusFilter}
        onSelect={(status) => {
          setStatusFilter(status);
          setPage(1);
        }}
      />

      <div className="rounded-xl border border-border bg-card">
        <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
          <div className="relative lg:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={t("documentsModule.searchPlaceholder")}
              className="pl-8"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </div>

          <Select
            value={typeFilter}
            onValueChange={(value) => {
              if (!value) return;
              setTypeFilter(value as DocumentType | "todos");
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full lg:w-56">
              <SelectValue placeholder={t("documentsModule.allTypes")}>
                {(value: string) =>
                  value === "todos"
                    ? t("documentsModule.allTypes")
                    : t(`statuses.documentType.${value as DocumentType}`)
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">{t("documentsModule.allTypes")}</SelectItem>
              {DOCUMENT_TYPE_ORDER.map((type) => (
                <SelectItem key={type} value={type}>
                  {t(`statuses.documentType.${type}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={statusFilter}
            onValueChange={(value) => {
              if (!value) return;
              setStatusFilter(value as DocumentStatus | "todos");
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full lg:w-48">
              <SelectValue placeholder={t("common.status")}>
                {(value: string) =>
                  value === "todos"
                    ? t("documentsModule.allStatuses")
                    : t(`statuses.document.${value as DocumentStatus}`)
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">{t("documentsModule.allStatuses")}</SelectItem>
              {DOCUMENT_STATUS_ORDER.map((status) => (
                <SelectItem key={status} value={status}>
                  {t(`statuses.document.${status}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={advisorFilter}
            onValueChange={(value) => {
              if (!value) return;
              setAdvisorFilter(value);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full lg:w-48">
              <SelectValue placeholder={t("documentsModule.allAdvisors")}>
                {(value: string) =>
                  value === "todos"
                    ? t("documentsModule.allAdvisors")
                    : ADVISORS.find((advisor) => advisor.id === value)?.fullName
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">{t("documentsModule.allAdvisors")}</SelectItem>
              {ADVISORS.map((advisor) => (
                <SelectItem key={advisor.id} value={advisor.id}>
                  {advisor.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {paginated.length === 0 ? (
          <div className="p-4">
            <EmptyState
              icon={Search}
              title={t("documentsModule.emptyTitle")}
              description={t("documentsModule.emptyDescription")}
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("documentsModule.columns.client")}</TableHead>
                  <TableHead>{t("documentsModule.columns.application")}</TableHead>
                  <TableHead>{t("documentsModule.columns.documentType")}</TableHead>
                  <TableHead>{t("documentsModule.columns.status")}</TableHead>
                  <TableHead>{t("documentsModule.columns.receivedAt")}</TableHead>
                  <TableHead>{t("documentsModule.columns.reviewer")}</TableHead>
                  <TableHead className="text-right">{t("documentsModule.columns.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.map(({ doc, client, application, reviewer }) => {
                  return (
                    <TableRow key={doc.id}>
                      <TableCell className="font-medium text-foreground">
                        {client?.fullName ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {application?.applicationNumber ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {t(`statuses.documentType.${doc.type}`)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          label={t(`statuses.document.${doc.status}`)}
                          className={DOCUMENT_STATUS_BADGE_CLASS[doc.status]}
                        />
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {doc.receivedAt ? formatDate(doc.receivedAt, locale) : "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {reviewer?.fullName ?? "—"}
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
                              onClick={() =>
                                doc.fileNameDemo
                                  ? toast.info(
                                      t("documentsModule.toasts.previewSimulated", {
                                        fileName: doc.fileNameDemo,
                                      })
                                    )
                                  : toast.info(t("documentsModule.toasts.notReceivedYet"))
                              }
                            >
                              <Eye className="size-4" />
                              {t("documentsModule.viewDocument")}
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() =>
                                client && router.push(`/expedientes/${client.id}?tab=documentos`)
                              }
                            >
                              <FolderOpen className="size-4" />
                              {t("documentsModule.viewDossier")}
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
      </div>
    </div>
  );
}
