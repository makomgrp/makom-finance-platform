"use client";

import { Fragment, useMemo, useRef, useState } from "react";
import { BranchOriginLabel } from "@/components/shared/branch-origin-label";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Search, Eye, CheckCircle2, RefreshCw, Upload, MoreHorizontal, FolderOpen, ChevronDown, ChevronUp } from "lucide-react";
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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { PaginationBar } from "@/components/shared/pagination-bar";
import { DocumentStatusSummary } from "@/components/documents/document-status-summary";
import {
  REQUIREMENT_SLOT_STATUS_BADGE_CLASS,
  REQUIREMENT_SLOT_STATUS_ORDER,
  REQUIREMENT_SLOT_STATUS_TRANSITIONABLE,
} from "@/lib/config/requirement-slot";
// Milestone 12D reuses these four Milestone 12C Server Actions exactly as
// they are — no relocation, no duplication (see the Milestone 12D
// architecture review's revised "Server Action Strategy"). This mirrors
// the pre-existing cross-route import this file already had for
// getDossierDocumentViewUrl before this migration.
import {
  uploadRequirementEvidence,
  reviewRequirementEvidence,
  getRequirementEvidenceViewUrl,
  setDossierRequirementSlotStatus,
} from "@/app/(app)/expedientes/actions";
import { getDocumentEvidenceWorkspaceAction } from "@/app/(app)/documentos/actions";
import { useCapability } from "@/lib/auth/use-capability";
import { formatDate } from "@/lib/format";
import type { Locale } from "@/i18n/config";
import type {
  DocumentEvidence,
  DocumentWorkspaceRow,
  RequirementSlot,
  RequirementSlotStatus,
} from "@/types";

const PAGE_SIZE = 10;
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

type ReviewFilter = "todos" | "reviewed" | "needsReview";

interface DocumentsTableProps {
  /** MILESTONE 25C-2 — true when the CURRENT VIEW can contain rows from more
   * than one branch, decided server-side by viewSpansMultipleBranches(). When
   * false, every row would repeat the same label, so the column is omitted
   * rather than rendered as noise. Never an authorization signal. */
  showBranchOrigin: boolean;

  initialRows: DocumentWorkspaceRow[];
  loadError: boolean;
}

interface PendingUpload {
  slotId: string;
  replacesEvidenceId?: string;
}

interface ViewDialogState {
  label: string;
  url: string;
  mimeType: string;
}

/**
 * Milestone 12D: the global, cross-application Document Requirements
 * workspace. Row model is a document-kind Requirement Slot (see the
 * Milestone 12D architecture review's "Primary UI Object"), never a raw
 * Evidence row or an Application — a Slot with zero Evidence is still a
 * real row, which is what makes this an operations workspace rather than
 * a files inbox.
 *
 * No optimistic merging: every mutation calls refetch(), which replaces
 * the whole workspace from a fresh server read — the exact same
 * discipline Milestone 12C established for the Dossier's Requirements
 * tab, for the same reason (a single Evidence upload can silently
 * transition its own Slot's status).
 */
export function DocumentsTable({
  initialRows,
  loadError: initialLoadError,
  showBranchOrigin,
}: DocumentsTableProps) {
  const router = useRouter();
  const locale = useLocale() as Locale;
  const t = useTranslations();
  // Milestone 16 — this module reuses the Dossier's Requirement/Evidence
  // actions as-is, so it must gate on the same three capabilities. The
  // workspace table, its filters and evidence viewing stay open to every
  // role including `consulta` (`document_workspace:read`/`evidence:read`).
  const canUploadEvidence = useCapability("evidence:upload");
  const canReviewEvidence = useCapability("evidence:review");
  const canSetSlotStatus = useCapability("requirement_slot:set_status");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadRef = useRef<PendingUpload | null>(null);

  const [rows, setRows] = useState<DocumentWorkspaceRow[]>(initialRows);
  const [loadError, setLoadError] = useState(initialLoadError);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<RequirementSlotStatus | "todos">("todos");
  const [advisorFilter, setAdvisorFilter] = useState<string>("todos");
  const [reviewFilter, setReviewFilter] = useState<ReviewFilter>("todos");
  const [page, setPage] = useState(1);
  const [busySlotId, setBusySlotId] = useState<string | null>(null);
  const [expandedHistoryRowIds, setExpandedHistoryRowIds] = useState<Set<string>>(new Set());
  const [viewDialog, setViewDialog] = useState<ViewDialogState | null>(null);

  const refetch = async () => {
    const result = await getDocumentEvidenceWorkspaceAction();
    if (result.status !== "success") {
      toast.error(t("documentsModule.toasts.refetchError"));
      return;
    }
    setRows(result.rows);
    setLoadError(false);
  };

  // Derived from the loaded rows themselves, not a separate profiles
  // fetch — the filter options can only ever be "advisors who actually
  // have a row here."
  const advisorOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) {
      if (row.application.assignedAdvisorProfileId) {
        map.set(
          row.application.assignedAdvisorProfileId,
          row.application.assignedAdvisorFullName ?? row.application.assignedAdvisorProfileId
        );
      }
    }
    return [...map.entries()];
  }, [rows]);

  // Milestone 14E: client name is resolved server-side via an embedded
  // join (src/lib/services/document-workspace.ts's WORKSPACE_SELECT) —
  // replaces the client-side legacyId join this table used in 14D.
  const enriched = useMemo(() => {
    return rows.map((row) => {
      const currentEvidence = row.evidence.filter((item) => !item.supersededByEvidenceId);
      const historicalEvidence = row.evidence.filter((item) => item.supersededByEvidenceId);
      return { row, currentEvidence, historicalEvidence };
    });
  }, [rows]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return enriched.filter(({ row, currentEvidence }) => {
      const name = row.requirementSlot.name[locale] ?? row.requirementSlot.code;
      const matchesSearch =
        term.length === 0 ||
        row.application.clientFullName.toLowerCase().includes(term) ||
        row.application.applicationNumber.toLowerCase().includes(term) ||
        name.toLowerCase().includes(term);
      const matchesStatus = statusFilter === "todos" || row.requirementSlot.status === statusFilter;
      const matchesAdvisor =
        advisorFilter === "todos" || row.application.assignedAdvisorProfileId === advisorFilter;
      // Factual, computed only from reviewedAt presence on CURRENT evidence
      // — never a second, synthesized Evidence status (architecture
      // review, "Status / Filter / KPI Strategy").
      const needsReview = currentEvidence.length > 0 && currentEvidence.some((item) => !item.reviewedAt);
      const isReviewed = currentEvidence.length > 0 && currentEvidence.every((item) => !!item.reviewedAt);
      const matchesReview =
        reviewFilter === "todos" ||
        (reviewFilter === "needsReview" && needsReview) ||
        (reviewFilter === "reviewed" && isReviewed);
      return matchesSearch && matchesStatus && matchesAdvisor && matchesReview;
    });
  }, [enriched, search, statusFilter, advisorFilter, reviewFilter, locale]);

  const totalPages = Math.max(Math.ceil(filtered.length / PAGE_SIZE), 1);
  const currentPage = Math.min(page, totalPages);
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const triggerFileSelect = (slotId: string, replacesEvidenceId?: string) => {
    pendingUploadRef.current = { slotId, replacesEvidenceId };
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const target = pendingUploadRef.current;
    event.target.value = "";
    pendingUploadRef.current = null;
    if (!file || !target) return;

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      toast.error(t("dossier.documents.toasts.invalidFileType"));
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      toast.error(t("dossier.documents.toasts.fileTooLarge"));
      return;
    }

    const slotRow = rows.find((row) => row.requirementSlot.id === target.slotId);
    const label = slotRow ? slotRow.requirementSlot.name[locale] ?? slotRow.requirementSlot.code : "";

    setBusySlotId(target.slotId);
    const formData = new FormData();
    formData.set("applicationId", slotRow?.requirementSlot.applicationId ?? "");
    formData.set("requirementSlotId", target.slotId);
    formData.set("file", file);
    if (target.replacesEvidenceId) {
      formData.set("replacesEvidenceId", target.replacesEvidenceId);
    }
    const result = await uploadRequirementEvidence(formData);
    setBusySlotId(null);

    if (result.status === "error") {
      toast.error(t("dossier.documents.toasts.evidenceUploadError"));
      return;
    }

    await refetch();

    if (result.status === "partial") {
      toast.info(t("dossier.documents.toasts.evidenceUploadPartial"));
      return;
    }

    toast.success(t("dossier.documents.toasts.evidenceUploaded", { requirement: label }));
  };

  const handleView = async (evidence: DocumentEvidence) => {
    setBusySlotId(evidence.requirementSlotId);
    const result = await getRequirementEvidenceViewUrl(evidence.id);
    setBusySlotId(null);

    if (result.status !== "success") {
      toast.error(t("dossier.documents.toasts.viewError"));
      return;
    }

    setViewDialog({ label: evidence.fileName, url: result.url, mimeType: evidence.mimeType });
  };

  const handleReview = async (evidence: DocumentEvidence) => {
    setBusySlotId(evidence.requirementSlotId);
    const result = await reviewRequirementEvidence(evidence.id);
    setBusySlotId(null);

    if (result.status !== "success") {
      toast.error(
        result.code === "ALREADY_REVIEWED"
          ? t("dossier.documents.alreadyReviewed")
          : t("dossier.documents.toasts.evidenceReviewError")
      );
      return;
    }

    await refetch();
    toast.success(t("dossier.documents.toasts.evidenceReviewed"));
  };

  const handleSlotStatusChange = async (slot: RequirementSlot, status: RequirementSlotStatus) => {
    setBusySlotId(slot.id);
    const result = await setDossierRequirementSlotStatus({ slotId: slot.id, status });
    setBusySlotId(null);

    if (result.status !== "success") {
      toast.error(t("dossier.documents.toasts.requirementStatusError"));
      return;
    }

    await refetch();
    const label = slot.name[locale] ?? slot.code;
    const statusLabel = t(`statuses.requirementSlotStatus.${status}`);
    toast.success(
      t("dossier.documents.toasts.requirementStatusUpdated", { requirement: label, status: statusLabel })
    );
  };

  const toggleHistory = (slotId: string) => {
    setExpandedHistoryRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(slotId)) {
        next.delete(slotId);
      } else {
        next.add(slotId);
      }
      return next;
    });
  };

  if (loadError) {
    return (
      <div className="rounded-xl border border-border bg-card p-4">
        <EmptyState
          icon={Search}
          title={t("dossier.documents.loadErrorTitle")}
          description={t("dossier.documents.loadErrorDescription")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_MIME_TYPES.join(",")}
        className="hidden"
        onChange={handleFileSelected}
      />

      <DocumentStatusSummary
        rows={rows}
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
            value={statusFilter}
            onValueChange={(value) => {
              if (!value) return;
              setStatusFilter(value as RequirementSlotStatus | "todos");
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full lg:w-48">
              <SelectValue placeholder={t("common.status")}>
                {(value: string) =>
                  value === "todos"
                    ? t("documentsModule.allStatuses")
                    : t(`statuses.requirementSlotStatus.${value as RequirementSlotStatus}`)
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">{t("documentsModule.allStatuses")}</SelectItem>
              {REQUIREMENT_SLOT_STATUS_ORDER.map((status) => (
                <SelectItem key={status} value={status}>
                  {t(`statuses.requirementSlotStatus.${status}`)}
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
                    : advisorOptions.find(([id]) => id === value)?.[1]
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">{t("documentsModule.allAdvisors")}</SelectItem>
              {advisorOptions.map(([id, name]) => (
                <SelectItem key={id} value={id}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={reviewFilter}
            onValueChange={(value) => {
              if (!value) return;
              setReviewFilter(value as ReviewFilter);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-full lg:w-48">
              <SelectValue placeholder={t("documentsModule.allReviewStates")}>
                {(value: string) =>
                  value === "needsReview"
                    ? t("documentsModule.needsReviewFilter")
                    : value === "reviewed"
                      ? t("documentsModule.reviewedFilter")
                      : t("documentsModule.allReviewStates")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">{t("documentsModule.allReviewStates")}</SelectItem>
              <SelectItem value="needsReview">{t("documentsModule.needsReviewFilter")}</SelectItem>
              <SelectItem value="reviewed">{t("documentsModule.reviewedFilter")}</SelectItem>
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
                  <TableHead>{t("documentsModule.columns.requirement")}</TableHead>
                  {showBranchOrigin && <TableHead>{t("branchContext.branch")}</TableHead>}
                  <TableHead>{t("documentsModule.columns.status")}</TableHead>
                  <TableHead>{t("documentsModule.columns.evidence")}</TableHead>
                  <TableHead className="text-right">{t("documentsModule.columns.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {paginated.map(({ row, currentEvidence, historicalEvidence }) => {
                  const slotId = row.requirementSlot.id;
                  const isBusy = busySlotId === slotId;
                  const isTerminal = row.requirementSlot.status === "satisfied" || row.requirementSlot.status === "waived";
                  const historyExpanded = expandedHistoryRowIds.has(slotId);
                  const name = row.requirementSlot.name[locale] ?? row.requirementSlot.code;

                  return (
                    <Fragment key={slotId}>
                      <TableRow>
                        <TableCell className="font-medium text-foreground">{row.application.clientFullName}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {/* MILESTONE 26B-5B — a draft has no official number,
                              and an empty cell says nothing at all. Naming the
                              state keeps a prospect's pending requirement from
                              being read as a live application's. */}
                          {row.application.isDraft ? (
                            <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                              {t("documentsModule.draftBadge")}
                            </span>
                          ) : (
                            row.application.applicationNumber
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{name}</TableCell>
                        {showBranchOrigin && (
                          <TableCell>
                            <BranchOriginLabel origin={row.application.branchOrigin} />
                          </TableCell>
                        )}
                        <TableCell>
                          <StatusBadge
                            label={t(`statuses.requirementSlotStatus.${row.requirementSlot.status}`)}
                            className={REQUIREMENT_SLOT_STATUS_BADGE_CLASS[row.requirementSlot.status]}
                          />
                        </TableCell>
                        <TableCell>
                          {currentEvidence.length === 0 ? (
                            <span className="text-xs text-muted-foreground">{t("documentsModule.noEvidence")}</span>
                          ) : (
                            <div className="space-y-1">
                              {currentEvidence.map((item) => (
                                <div key={item.id} className="flex items-center gap-1">
                                  <span className="max-w-[160px] truncate text-xs text-foreground">
                                    {item.fileName}
                                  </span>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-6"
                                    disabled={isBusy}
                                    onClick={() => handleView(item)}
                                  >
                                    <Eye className="size-3.5" />
                                    <span className="sr-only">{t("dossier.documents.view")}</span>
                                  </Button>
                                  {canUploadEvidence && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="size-6"
                                      disabled={isBusy}
                                      onClick={() => triggerFileSelect(slotId, item.id)}
                                    >
                                      <RefreshCw className="size-3.5" />
                                      <span className="sr-only">{t("dossier.documents.replace")}</span>
                                    </Button>
                                  )}
                                  {canReviewEvidence && !item.reviewedAt && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="size-6"
                                      disabled={isBusy}
                                      onClick={() => handleReview(item)}
                                    >
                                      <CheckCircle2 className="size-3.5" />
                                      <span className="sr-only">{t("dossier.documents.review")}</span>
                                    </Button>
                                  )}
                                </div>
                              ))}
                              {historicalEvidence.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => toggleHistory(slotId)}
                                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                                >
                                  {historyExpanded ? (
                                    <ChevronUp className="size-3" />
                                  ) : (
                                    <ChevronDown className="size-3" />
                                  )}
                                  {t("dossier.documents.viewHistory", { count: historicalEvidence.length })}
                                </button>
                              )}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {canUploadEvidence && (
                              <Button
                                variant="ghost"
                                size="icon"
                                disabled={isBusy || isTerminal}
                                onClick={() => triggerFileSelect(slotId)}
                              >
                                <Upload className="size-4" />
                                <span className="sr-only">{t("dossier.documents.addEvidence")}</span>
                              </Button>
                            )}
                            <DropdownMenu>
                              <DropdownMenuTrigger
                                render={
                                  <Button variant="ghost" size="icon" disabled={isBusy}>
                                    <MoreHorizontal className="size-4" />
                                    <span className="sr-only">{t("common.actions")}</span>
                                  </Button>
                                }
                              />
                              <DropdownMenuContent align="end">
                                {/* Milestone 16: the status items are gated,
                                    the "view dossier" navigation below is
                                    not — every role may still open the
                                    dossier this row belongs to. */}
                                {canSetSlotStatus && (
                                  <>
                                    <DropdownMenuGroup>
                                      <DropdownMenuLabel>
                                        {t("dossier.documents.newStatus")}
                                      </DropdownMenuLabel>
                                    </DropdownMenuGroup>
                                    <DropdownMenuSeparator />
                                    {REQUIREMENT_SLOT_STATUS_TRANSITIONABLE.map((status) => (
                                      <DropdownMenuItem
                                        key={status}
                                        disabled={status === row.requirementSlot.status}
                                        onClick={() => handleSlotStatusChange(row.requirementSlot, status)}
                                      >
                                        {t(`statuses.requirementSlotStatus.${status}`)}
                                      </DropdownMenuItem>
                                    ))}
                                    <DropdownMenuSeparator />
                                  </>
                                )}
                                <DropdownMenuItem
                                  onClick={() =>
                                    router.push(`/expedientes/${row.application.clientId}?tab=documentos`)
                                  }
                                >
                                  <FolderOpen className="size-4" />
                                  {t("documentsModule.viewDossier")}
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </TableCell>
                      </TableRow>
                      {historyExpanded && historicalEvidence.length > 0 && (
                        <TableRow>
                          <TableCell colSpan={6} className="bg-muted/30">
                            <div className="space-y-1 py-1">
                              {historicalEvidence.map((item) => (
                                <div key={item.id} className="flex items-center gap-1.5 opacity-70">
                                  <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                                    {t("dossier.documents.supersededBadge")}
                                  </span>
                                  <span className="max-w-[200px] truncate text-xs">{item.fileName}</span>
                                  <span className="text-[11px] text-muted-foreground">
                                    {t("dossier.documents.uploadedOn", { date: formatDate(item.uploadedAt, locale) })}
                                  </span>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-6"
                                    disabled={isBusy}
                                    onClick={() => handleView(item)}
                                  >
                                    <Eye className="size-3.5" />
                                    <span className="sr-only">{t("dossier.documents.view")}</span>
                                  </Button>
                                  {canReviewEvidence && !item.reviewedAt && (
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="size-6"
                                      disabled={isBusy}
                                      onClick={() => handleReview(item)}
                                    >
                                      <CheckCircle2 className="size-3.5" />
                                      <span className="sr-only">{t("dossier.documents.review")}</span>
                                    </Button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
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

      <Dialog open={viewDialog !== null} onOpenChange={(open) => !open && setViewDialog(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("dossier.documents.viewDialogTitle")}</DialogTitle>
            <DialogDescription>{viewDialog?.label}</DialogDescription>
          </DialogHeader>
          {viewDialog && (
            <div className="space-y-3">
              {viewDialog.mimeType.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={viewDialog.url}
                  alt={viewDialog.label}
                  className="max-h-[70vh] w-full rounded-md border border-border object-contain"
                />
              ) : (
                <iframe
                  src={viewDialog.url}
                  title={viewDialog.label}
                  className="h-[70vh] w-full rounded-md border border-border"
                />
              )}
              <a
                href={viewDialog.url}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-primary underline underline-offset-4"
              >
                {t("dossier.documents.openInNewTab")}
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
