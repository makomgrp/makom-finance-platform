"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Eye, RefreshCw, Upload, FileText } from "lucide-react";
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
  DOCUMENT_STATUS_BADGE_CLASS,
  DOCUMENT_STATUS_TRANSITIONABLE,
  DOCUMENT_TYPE_ORDER,
} from "@/lib/config/document";
import {
  uploadDossierDocument,
  setDossierDocumentStatus,
  getDossierDocumentViewUrl,
} from "@/app/(app)/expedientes/actions";
import { formatDate } from "@/lib/format";
import type { Locale } from "@/i18n/config";
import type { ActivityEvent, DocumentStatus, DossierDocument, LoanApplication } from "@/types";

const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

interface DocumentsTabProps {
  application?: LoanApplication;
  documents: DossierDocument[];
  onDocumentChange: (document: DossierDocument) => void;
  onActivity: (
    descriptionKey: string,
    params: Record<string, string> | undefined,
    type: ActivityEvent["type"]
  ) => void;
  /** True when the initial server-side load of this client's documents
   * failed. Never silently falls back to an empty/demo state — see the
   * Milestone 8 architecture review's failure-state design. */
  loadError: boolean;
}

interface ViewDialogState {
  documentLabel: string;
  url: string;
  mimeType: string;
}

export function DocumentsTab({
  application,
  documents,
  onDocumentChange,
  onActivity,
  loadError,
}: DocumentsTabProps) {
  const locale = useLocale() as Locale;
  const t = useTranslations();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadDocId = useRef<string | null>(null);
  const [busyDocumentId, setBusyDocumentId] = useState<string | null>(null);
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

  if (loadError) {
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

  const orderedDocs = DOCUMENT_TYPE_ORDER.map(
    (type) => documents.find((doc) => doc.type === type)!
  ).filter(Boolean);

  const verifiedCount = orderedDocs.filter((doc) => doc.status === "verificado").length;
  const totalDocs = orderedDocs.length;

  const handleStatusChange = async (doc: DossierDocument, status: DocumentStatus) => {
    setBusyDocumentId(doc.id);
    const result = await setDossierDocumentStatus({ documentId: doc.id, status });
    setBusyDocumentId(null);

    if (result.status !== "success") {
      toast.error(t("dossier.documents.toasts.statusChangeError"));
      return;
    }

    onDocumentChange(result.document);
    const label = t(`statuses.documentType.${doc.type}`);
    const statusLabel = t(`statuses.document.${status}`);
    onActivity(
      "documentStatusChanged",
      { document: label, status: statusLabel },
      status === "verificado" ? "documento_verificado" : "estado_modificado"
    );
    toast.success(t("dossier.documents.toasts.statusUpdated", { document: label, status: statusLabel }));
  };

  const triggerFileSelect = (doc: DossierDocument) => {
    pendingUploadDocId.current = doc.id;
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    const documentId = pendingUploadDocId.current;
    event.target.value = "";
    pendingUploadDocId.current = null;
    if (!file || !documentId) return;

    const doc = documents.find((item) => item.id === documentId);
    if (!doc) return;

    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      toast.error(t("dossier.documents.toasts.invalidFileType"));
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      toast.error(t("dossier.documents.toasts.fileTooLarge"));
      return;
    }

    setBusyDocumentId(documentId);
    const formData = new FormData();
    formData.set("documentId", documentId);
    formData.set("file", file);
    const result = await uploadDossierDocument(formData);
    setBusyDocumentId(null);

    if (result.status !== "success") {
      toast.error(t("dossier.documents.toasts.uploadError"));
      return;
    }

    onDocumentChange(result.document);
    const label = t(`statuses.documentType.${doc.type}`);
    const wasReplace = doc.hasFile;
    onActivity(
      wasReplace ? "documentReplaced" : "documentStatusChanged",
      { document: label },
      "documento_recibido"
    );
    toast.success(t(`dossier.documents.toasts.${wasReplace ? "replaced" : "uploaded"}`, { document: label }));
  };

  const handleView = async (doc: DossierDocument) => {
    if (!doc.hasFile) {
      toast.info(t("dossier.documents.toasts.notReceivedYet"));
      return;
    }

    setBusyDocumentId(doc.id);
    const result = await getDossierDocumentViewUrl(doc.id);
    setBusyDocumentId(null);

    if (result.status !== "success") {
      toast.error(t("dossier.documents.toasts.viewError"));
      return;
    }

    setViewDialog({
      documentLabel: t(`statuses.documentType.${doc.type}`),
      url: result.url,
      mimeType: doc.mimeType ?? "",
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
              <span className="font-medium text-foreground">
                {t("dossier.documents.progressTitle")}
              </span>
              <span className="text-muted-foreground">
                {t("dossier.documents.requirementsCompleted", {
                  completed: verifiedCount,
                  total: totalDocs,
                })}
              </span>
            </div>
            <Progress value={(verifiedCount / totalDocs) * 100} />
          </div>
          {verifiedCount === totalDocs && (
            <StatusBadge
              label={t("dossier.documents.documentSetComplete")}
              className="bg-success/10 text-success border-success/20 shrink-0"
            />
          )}
        </CardContent>
      </Card>

      <div className="space-y-3">
        {orderedDocs.map((doc) => {
          const typeLabel = t(`statuses.documentType.${doc.type}`);
          const typeDescription = t(`statuses.documentType.${doc.type}_description`);
          const isBusy = busyDocumentId === doc.id;

          return (
            <Card key={doc.id}>
              <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">{typeLabel}</p>
                    <StatusBadge
                      label={t(`statuses.document.${doc.status}`)}
                      className={DOCUMENT_STATUS_BADGE_CLASS[doc.status]}
                    />
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{typeDescription}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {doc.uploadedAt
                      ? t("dossier.documents.receivedOn", { date: formatDate(doc.uploadedAt, locale) })
                      : t("dossier.documents.notReceived")}
                    {doc.reviewedByFullName
                      ? ` · ${t("dossier.documents.reviewedBy", { name: doc.reviewedByFullName })}`
                      : ""}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Button variant="outline" size="sm" disabled={isBusy} onClick={() => handleView(doc)}>
                    <Eye className="size-3.5" />
                    {t("dossier.documents.view")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isBusy}
                    onClick={() => triggerFileSelect(doc)}
                  >
                    {doc.hasFile ? (
                      <>
                        <RefreshCw className="size-3.5" />
                        {t("dossier.documents.replace")}
                      </>
                    ) : (
                      <>
                        <Upload className="size-3.5" />
                        {t("dossier.documents.upload")}
                      </>
                    )}
                  </Button>
                  {doc.hasFile && (
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
                        {DOCUMENT_STATUS_TRANSITIONABLE.map((status) => (
                          <DropdownMenuItem
                            key={status}
                            disabled={status === doc.status}
                            onClick={() => handleStatusChange(doc, status)}
                          >
                            {t(`statuses.document.${status}`)}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={viewDialog !== null} onOpenChange={(open) => !open && setViewDialog(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("dossier.documents.viewDialogTitle")}</DialogTitle>
            <DialogDescription>{viewDialog?.documentLabel}</DialogDescription>
          </DialogHeader>
          {viewDialog && (
            <div className="space-y-3">
              {viewDialog.mimeType.startsWith("image/") ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={viewDialog.url}
                  alt={viewDialog.documentLabel}
                  className="max-h-[70vh] w-full rounded-md border border-border object-contain"
                />
              ) : (
                <iframe
                  src={viewDialog.url}
                  title={viewDialog.documentLabel}
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
