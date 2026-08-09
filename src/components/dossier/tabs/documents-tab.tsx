"use client";

import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Eye, RefreshCw, FileText } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DOCUMENT_STATUS_BADGE_CLASS, DOCUMENT_STATUS_ORDER, DOCUMENT_TYPE_ORDER } from "@/lib/config/document";
import { getUserById } from "@/lib/demo-data";
import { useCurrentProfile } from "@/lib/auth/current-profile-context";
import { formatDate } from "@/lib/format";
import type { Locale } from "@/i18n/config";
import type { ActivityEvent, DocumentRecord, DocumentStatus, LoanApplication } from "@/types";

interface DocumentsTabProps {
  application?: LoanApplication;
  documents: DocumentRecord[];
  onDocumentsChange: (documents: DocumentRecord[]) => void;
  onActivity: (
    descriptionKey: string,
    params: Record<string, string> | undefined,
    type: ActivityEvent["type"]
  ) => void;
}

export function DocumentsTab({
  application,
  documents,
  onDocumentsChange,
  onActivity,
}: DocumentsTabProps) {
  const locale = useLocale() as Locale;
  const t = useTranslations();
  const profile = useCurrentProfile();

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

  const orderedDocs = DOCUMENT_TYPE_ORDER.map(
    (type) => documents.find((doc) => doc.type === type)!
  ).filter(Boolean);

  const verifiedCount = orderedDocs.filter((doc) => doc.status === "verificado").length;
  const totalDocs = orderedDocs.length;

  const updateDocument = (documentId: string, changes: Partial<DocumentRecord>) => {
    onDocumentsChange(documents.map((doc) => (doc.id === documentId ? { ...doc, ...changes } : doc)));
  };

  const handleStatusChange = (doc: DocumentRecord, status: DocumentStatus) => {
    updateDocument(doc.id, {
      status,
      reviewedByUserId: profile.id,
    });
    const label = t(`statuses.documentType.${doc.type}`);
    const statusLabel = t(`statuses.document.${status}`);
    onActivity(
      "documentStatusChanged",
      { document: label, status: statusLabel },
      status === "verificado" ? "documento_verificado" : "estado_modificado"
    );
    toast.success(t("dossier.documents.toasts.statusUpdated", { document: label, status: statusLabel }));
  };

  const handleReplace = (doc: DocumentRecord) => {
    const label = t(`statuses.documentType.${doc.type}`);
    updateDocument(doc.id, {
      status: "recibido",
      receivedAt: new Date().toISOString(),
      reviewedByUserId: undefined,
      fileNameDemo: `${doc.type}-reemplazo.pdf`,
    });
    onActivity("documentReplaced", { document: label }, "documento_recibido");
    toast.success(t("dossier.documents.toasts.replaced", { document: label }));
  };

  const handleView = (doc: DocumentRecord) => {
    if (!doc.fileNameDemo) {
      toast.info(t("dossier.documents.toasts.notReceivedYet"));
      return;
    }
    toast.info(t("dossier.documents.toasts.previewSimulated", { fileName: doc.fileNameDemo }));
  };

  return (
    <div className="space-y-4">
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
          const reviewer = doc.reviewedByUserId
            ? doc.reviewedByUserId === profile.id
              ? profile
              : getUserById(doc.reviewedByUserId)
            : undefined;

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
                    {doc.receivedAt
                      ? t("dossier.documents.receivedOn", { date: formatDate(doc.receivedAt, locale) })
                      : t("dossier.documents.notReceived")}
                    {reviewer
                      ? ` · ${t("dossier.documents.reviewedBy", { name: reviewer.fullName })}`
                      : ""}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleView(doc)}>
                    <Eye className="size-3.5" />
                    {t("dossier.documents.view")}
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => handleReplace(doc)}>
                    <RefreshCw className="size-3.5" />
                    {t("dossier.documents.replace")}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button variant="outline" size="sm">
                          {t("dossier.documents.changeStatus")}
                        </Button>
                      }
                    />
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>{t("dossier.documents.newStatus")}</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {DOCUMENT_STATUS_ORDER.map((status) => (
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
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
