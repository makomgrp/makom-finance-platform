"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2, ChevronDown, ChevronUp, Eye, FileText, RefreshCw, Upload } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  REQUIREMENT_SLOT_STATUS_BADGE_CLASS,
  REQUIREMENT_SLOT_STATUS_TRANSITIONABLE,
} from "@/lib/config/requirement-slot";
import {
  uploadRequirementEvidence,
  reviewRequirementEvidence,
  getRequirementEvidenceViewUrl,
  setDossierRequirementSlotStatus,
} from "@/app/(app)/expedientes/actions";
import { formatDate } from "@/lib/format";
import type { Locale } from "@/i18n/config";
import type {
  ActivityEvent,
  ApplicationListItem,
  DocumentEvidence,
  RequirementSlot,
  RequirementSlotStatus,
} from "@/types";
import type { DossierRequirementsData } from "@/components/dossier/dossier-view";

/**
 * The Milestone 12C replacement for the legacy DocumentsTab (deleted —
 * see the Milestone 12C implementation report). Renders the NEW
 * Requirement Slot -> Document Evidence hierarchy exclusively: every
 * import above comes from document-evidence.ts / requirement-slots.ts /
 * their Server Action wrappers, never from documents.ts or DossierDocument
 * — see the architecture review's Risk 8 ("accidental coupling that makes
 * 12E harder") for why that boundary is deliberate, not incidental.
 *
 * No optimistic merging anywhere in this file (architecture review item
 * 8): every mutation calls onRefetch(), which replaces the parent's
 * Requirement Slot + Evidence state wholesale from a fresh server read —
 * see dossier-view.tsx#handleRequirementsRefetch.
 */

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

interface RequirementsTabProps {
  application?: ApplicationListItem;
  /** null defensively covers a lookup miss — see DossierRequirementsData's
   * own doc comment; render the "not yet migrated" state rather than
   * throwing or showing a blank screen if it's ever actually hit. */
  requirementsData: DossierRequirementsData | null;
  onRefetch: () => Promise<void>;
  onActivity: (
    descriptionKey: string,
    params: Record<string, string> | undefined,
    type: ActivityEvent["type"]
  ) => void;
}

interface PendingUpload {
  slotId: string;
  replacesEvidenceId?: string;
}

interface ViewDialogState {
  evidenceLabel: string;
  url: string;
  mimeType: string;
}

export function RequirementsTab({ application, requirementsData, onRefetch, onActivity }: RequirementsTabProps) {
  const locale = useLocale() as Locale;
  const t = useTranslations();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadRef = useRef<PendingUpload | null>(null);
  const [busySlotId, setBusySlotId] = useState<string | null>(null);
  const [expandedHistorySlotIds, setExpandedHistorySlotIds] = useState<Set<string>>(new Set());
  const [viewDialog, setViewDialog] = useState<ViewDialogState | null>(null);

  if (!application) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={FileText}
            title={t("dossier.documents.noApplicationTitle")}
            description={t("dossier.documents.noApplicationDescription")}
          />
        </CardContent>
      </Card>
    );
  }

  if (!requirementsData) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={FileText}
            title={t("dossier.documents.notMigratedTitle")}
            description={t("dossier.documents.notMigratedDescription")}
          />
        </CardContent>
      </Card>
    );
  }

  if (requirementsData.loadError) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={FileText}
            title={t("dossier.documents.loadErrorTitle")}
            description={t("dossier.documents.loadErrorDescription")}
          />
        </CardContent>
      </Card>
    );
  }

  const slots = [...requirementsData.requirementSlots].sort((a, b) => a.displayOrder - b.displayOrder);
  const satisfiedCount = slots.filter((slot) => slot.status === "satisfied").length;
  const totalSlots = slots.length;

  const evidenceBySlotId = (slotId: string) =>
    requirementsData.evidence.filter((item) => item.requirementSlotId === slotId);

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

    const slot = slots.find((s) => s.id === target.slotId);
    const label = slot?.name[locale] ?? slot?.code ?? "";

    setBusySlotId(target.slotId);
    const formData = new FormData();
    formData.set("applicationId", slot?.applicationId ?? "");
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

    // Per the architecture review, item 8: refetch and replace, never
    // optimistically merge — a single upload can silently also change the
    // Slot's status, and the "partial" branch below exists precisely
    // because that side effect can fail independently of the upload
    // itself.
    await onRefetch();

    if (result.status === "partial") {
      toast.info(t("dossier.documents.toasts.evidenceUploadPartial"));
      return;
    }

    onActivity(
      target.replacesEvidenceId ? "documentReplaced" : "documentStatusChanged",
      { document: label },
      "documento_recibido"
    );
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

    setViewDialog({ evidenceLabel: evidence.fileName, url: result.url, mimeType: evidence.mimeType });
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

    // Review never changes Slot status (architecture review item 24: "an
    // Evidence review and a Requirement completion judgment are
    // independent — never infer one from the other") — refetched anyway,
    // for the same "no optimistic merging" discipline as every other
    // mutation here.
    await onRefetch();
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

    await onRefetch();
    const label = slot.name[locale] ?? slot.code;
    const statusLabel = t(`statuses.requirementSlotStatus.${status}`);
    onActivity(
      "documentStatusChanged",
      { document: label, status: statusLabel },
      "estado_modificado"
    );
    toast.success(
      t("dossier.documents.toasts.requirementStatusUpdated", { requirement: label, status: statusLabel })
    );
  };

  const toggleHistory = (slotId: string) => {
    setExpandedHistorySlotIds((prev) => {
      const next = new Set(prev);
      if (next.has(slotId)) {
        next.delete(slotId);
      } else {
        next.add(slotId);
      }
      return next;
    });
  };

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept={ALLOWED_MIME_TYPES.join(",")}
        className="hidden"
        onChange={handleFileSelected}
      />

      <Card>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex-1">
            <div className="mb-1 flex items-center justify-between text-sm">
              <span className="font-medium text-foreground">{t("dossier.documents.progressTitle")}</span>
              <span className="text-muted-foreground">
                {t("dossier.documents.requirementsCompleted", { completed: satisfiedCount, total: totalSlots })}
              </span>
            </div>
            <Progress value={totalSlots > 0 ? (satisfiedCount / totalSlots) * 100 : 0} />
          </div>
          {totalSlots > 0 && satisfiedCount === totalSlots && (
            <StatusBadge
              label={t("dossier.documents.documentSetComplete")}
              className="bg-success/10 text-success border-success/20 shrink-0"
            />
          )}
        </CardContent>
      </Card>

      <div className="space-y-3">
        {slots.map((slot) => {
          const slotEvidence = evidenceBySlotId(slot.id);
          const currentEvidence = slotEvidence.filter((item) => !item.supersededByEvidenceId);
          const historicalEvidence = slotEvidence.filter((item) => item.supersededByEvidenceId);
          const isBusy = busySlotId === slot.id;
          const isTerminal = slot.status === "satisfied" || slot.status === "waived";
          const isDocumentKind = slot.requirementKind === "document";
          const historyExpanded = expandedHistorySlotIds.has(slot.id);
          const name = slot.name[locale] ?? slot.code;
          const description = slot.description[locale];

          return (
            <Card key={slot.id}>
              <CardContent className="space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-foreground">{name}</p>
                      <StatusBadge
                        label={t(`statuses.requirementSlotStatus.${slot.status}`)}
                        className={REQUIREMENT_SLOT_STATUS_BADGE_CLASS[slot.status]}
                      />
                      <span className="text-xs text-muted-foreground">
                        {slot.required ? t("dossier.documents.required") : t("dossier.documents.optional")}
                      </span>
                    </div>
                    {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    {isDocumentKind && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={isBusy || isTerminal}
                        onClick={() => triggerFileSelect(slot.id)}
                      >
                        <Upload className="size-3.5" />
                        {t("dossier.documents.addEvidence")}
                      </Button>
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button variant="outline" size="sm" disabled={isBusy}>
                            {t("dossier.documents.changeStatus")}
                          </Button>
                        }
                      />
                      <DropdownMenuContent align="end">
                        <DropdownMenuGroup>
                          <DropdownMenuLabel>{t("dossier.documents.newStatus")}</DropdownMenuLabel>
                        </DropdownMenuGroup>
                        <DropdownMenuSeparator />
                        {REQUIREMENT_SLOT_STATUS_TRANSITIONABLE.map((status) => (
                          <DropdownMenuItem
                            key={status}
                            disabled={status === slot.status}
                            onClick={() => handleSlotStatusChange(slot, status)}
                          >
                            {t(`statuses.requirementSlotStatus.${status}`)}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {isDocumentKind && (currentEvidence.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t("dossier.documents.noEvidenceYet")}</p>
                ) : (
                  <div className="space-y-2">
                    {currentEvidence.map((item) => (
                      <EvidenceRow
                        key={item.id}
                        evidence={item}
                        locale={locale}
                        disabled={isBusy}
                        onView={() => handleView(item)}
                        onReplace={() => triggerFileSelect(slot.id, item.id)}
                        onReview={() => handleReview(item)}
                      />
                    ))}
                  </div>
                ))}

                {isDocumentKind && historicalEvidence.length > 0 && (
                  <div className="border-t border-border pt-2">
                    <button
                      type="button"
                      onClick={() => toggleHistory(slot.id)}
                      className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    >
                      {historyExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                      {t("dossier.documents.viewHistory", { count: historicalEvidence.length })}
                    </button>
                    {historyExpanded && (
                      <div className="mt-2 space-y-2">
                        {historicalEvidence.map((item) => (
                          <EvidenceRow
                            key={item.id}
                            evidence={item}
                            locale={locale}
                            disabled={isBusy}
                            superseded
                            onView={() => handleView(item)}
                            onReview={() => handleReview(item)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}

        {totalSlots === 0 && (
          <div className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
            {t("dossier.documents.noEvidenceYet")}
          </div>
        )}
      </div>

      <Dialog open={viewDialog !== null} onOpenChange={(open) => !open && setViewDialog(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("dossier.documents.viewDialogTitle")}</DialogTitle>
            <DialogDescription>{viewDialog?.evidenceLabel}</DialogDescription>
          </DialogHeader>
          {viewDialog && (
            <div className="space-y-3">
              {viewDialog.mimeType.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={viewDialog.url}
                  alt={viewDialog.evidenceLabel}
                  className="max-h-[70vh] w-full rounded-md border border-border object-contain"
                />
              ) : (
                <iframe
                  src={viewDialog.url}
                  title={viewDialog.evidenceLabel}
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

interface EvidenceRowProps {
  evidence: DocumentEvidence;
  locale: Locale;
  disabled: boolean;
  superseded?: boolean;
  onView: () => void;
  onReplace?: () => void;
  onReview: () => void;
}

/** One Evidence item within a Requirement Slot card — filename, uploaded
 * date, reviewed date + reviewer (when reviewed), a superseded badge when
 * historical, and its own view/replace/review actions. Review is always
 * per-item, never per-Slot (architecture review item 23). */
function EvidenceRow({ evidence, locale, disabled, superseded, onView, onReplace, onReview }: EvidenceRowProps) {
  const t = useTranslations();

  return (
    <div
      className={
        "flex flex-col gap-2 rounded-md border border-border p-2.5 sm:flex-row sm:items-center sm:justify-between" +
        (superseded ? " opacity-60" : "")
      }
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-medium text-foreground">{evidence.fileName}</p>
          {superseded && (
            <span className="rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {t("dossier.documents.supersededBadge")}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          {t("dossier.documents.uploadedOn", { date: formatDate(evidence.uploadedAt, locale) })}
          {evidence.reviewedAt
            ? ` · ${t("dossier.documents.reviewedOn", { date: formatDate(evidence.reviewedAt, locale) })}` +
              (evidence.reviewedByFullName
                ? ` · ${t("dossier.documents.reviewedBy", { name: evidence.reviewedByFullName })}`
                : "")
            : ""}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="outline" size="sm" disabled={disabled} onClick={onView}>
          <Eye className="size-3.5" />
          {t("dossier.documents.view")}
        </Button>
        {onReplace && (
          <Button variant="outline" size="sm" disabled={disabled} onClick={onReplace}>
            <RefreshCw className="size-3.5" />
            {t("dossier.documents.replace")}
          </Button>
        )}
        {!evidence.reviewedAt && (
          <Button variant="outline" size="sm" disabled={disabled} onClick={onReview}>
            <CheckCircle2 className="size-3.5" />
            {t("dossier.documents.review")}
          </Button>
        )}
      </div>
    </div>
  );
}
