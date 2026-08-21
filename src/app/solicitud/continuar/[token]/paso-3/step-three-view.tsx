"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Info, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PortalProgress } from "@/components/portal/portal-progress";
import { DocumentTaskCard } from "@/components/portal/document-task-card";
import { getPortalDocumentUrl, uploadPortalDocuments } from "./actions";
import type { PortalDocumentGroup, PortalDocuments } from "@/lib/services/portal-documents";
import type { LocalizedText } from "@/types";

/**
 * ============================================================================
 * STEP 3 — THE DOCUMENT CHECKLIST (26B-3)
 * ============================================================================
 *
 * Sections the customer recognises, each a short list of tasks. The grouping
 * and the completion counts are computed on the server from real slots and real
 * files; this component renders them and owns the upload interaction.
 *
 * ONE UPLOAD AT A TIME. A single `busy` flag disables every control while a
 * file is in flight, which is what makes double-clicks and racing uploads
 * impossible without per-card bookkeeping. After a successful upload the route
 * is refreshed so the counts, statuses and file lists all come back from the
 * server rather than being guessed at locally.
 */

interface StepThreeViewProps {
  continuationToken: string;
  applicationNumber: string;
  productName: LocalizedText;
  documents: PortalDocuments;
}

export function StepThreeView({
  continuationToken,
  applicationNumber,
  productName,
  documents,
}: StepThreeViewProps) {
  const t = useTranslations("portal.step3");
  const tErrors = useTranslations("portal.errors");
  const locale = useLocale() as keyof LocalizedText;
  const router = useRouter();

  const [busy, setBusy] = useState(false);
  const [uploadingSlot, setUploadingSlot] = useState<string | undefined>();
  const [slotErrors, setSlotErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [continuing, setContinuing] = useState(false);

  const handleUpload = async (slotId: string, files: FileList, replacesEvidenceId?: string) => {
    if (busy) return;
    setBusy(true);
    setUploadingSlot(slotId);
    setSaved(false);
    setFormError(null);
    setSlotErrors((prev) => {
      const next = { ...prev };
      delete next[slotId];
      return next;
    });

    try {
      const formData = new FormData();
      formData.set("continuationToken", continuationToken);
      formData.set("requirementSlotId", slotId);
      if (replacesEvidenceId) formData.set("replacesEvidenceId", replacesEvidenceId);
      for (const file of Array.from(files)) formData.append("files", file);

      const result = await uploadPortalDocuments(formData);

      if (result.status === "error") {
        // A partial batch is reported as a partial batch. Naming the files that
        // failed is the difference between the customer fixing one scan and
        // re-sending all three.
        const message =
          result.failedFiles && result.failedFiles.length > 0
            ? t("uploadPartial", {
                failed: result.failedFiles.join(", "),
                count: result.uploaded ?? 0,
              })
            : tErrors(result.code);
        setSlotErrors((prev) => ({ ...prev, [slotId]: message }));
      }

      // Refresh even after a partial failure — whatever DID upload is real and
      // should appear immediately.
      router.refresh();
    } catch {
      setSlotErrors((prev) => ({ ...prev, [slotId]: tErrors("UPLOAD_FAILED") }));
    } finally {
      setBusy(false);
      setUploadingSlot(undefined);
    }
  };

  const handleView = async (evidenceId: string) => {
    const result = await getPortalDocumentUrl(continuationToken, evidenceId);
    if (result.status !== "ok") {
      setFormError(tErrors("NOT_FOUND"));
      return;
    }
    // Opened rather than embedded: the URL lives 90 seconds and is never
    // written anywhere the page can leak it.
    window.open(result.url, "_blank", "noopener,noreferrer");
  };

  const handleContinue = () => {
    setContinuing(true);
    router.push(`/solicitud/continuar/${continuationToken}/paso-4`);
  };

  return (
    <div className="flex flex-col gap-7 sm:gap-8">
      <PortalProgress currentStep={3} />

      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[1.75rem]">
          {t("title")}
        </h1>
        <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">
          {t("subtitle", { product: productName[locale] ?? productName.es })}
        </p>
        <p className="text-xs text-muted-foreground">
          {t("applicationRef", { number: applicationNumber })}
        </p>
      </header>

      {formError && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/[0.06] p-4">
          <p className="text-sm font-medium text-destructive">{formError}</p>
        </div>
      )}

      {saved && (
        <div role="status" className="rounded-xl border border-success/30 bg-success/[0.06] p-4">
          <p className="text-sm font-medium text-foreground">{t("savedTitle")}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("savedBody")}</p>
        </div>
      )}

      {documents.groups.map((group) => (
        <DocumentGroupSection
          key={`${group.kind}-${group.subjectId ?? "main"}`}
          group={group}
          busy={busy}
          uploadingSlot={uploadingSlot}
          slotErrors={slotErrors}
          onUpload={handleUpload}
          onView={handleView}
        />
      ))}

      {/* 26A-3 deliberately seeded no property document requirements. Saying so
          beats an empty section that looks broken, and beats inventing a
          checklist ODL never approved. */}
      {documents.hasPropertyCollateralWithoutRequirements && (
        <div className="flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-4">
          <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-foreground">{t("propertyPendingTitle")}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">{t("propertyPendingBody")}</p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row sm:items-center sm:justify-between">
        <Button
          type="button"
          variant="ghost"
          nativeButton={false}
          className="h-11 self-start px-3 text-muted-foreground hover:text-foreground"
          render={<a href={`/solicitud/continuar/${continuationToken}/paso-2`} />}
        >
          {t("back")}
        </Button>

        <div className="flex flex-col gap-3 sm:flex-row-reverse sm:items-center">
          <Button
            type="button"
            disabled={busy || continuing || !documents.allRequiredComplete}
            onClick={handleContinue}
            className="h-12 w-full px-8 text-[0.9375rem] font-semibold sm:w-auto"
          >
            {continuing && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {t("continue")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setSaved(true)}
            className="h-12 w-full px-6 text-[0.9375rem] sm:w-auto"
          >
            {t("saveForLater")}
          </Button>
        </div>
      </div>

      {/* Says WHY Continue is disabled. A greyed-out button with no explanation
          is the most common way a form strands someone. */}
      {!documents.allRequiredComplete && (
        <p className="-mt-4 text-sm text-muted-foreground sm:text-right">{t("continueBlocked")}</p>
      )}
    </div>
  );
}

function DocumentGroupSection({
  group,
  busy,
  uploadingSlot,
  slotErrors,
  onUpload,
  onView,
}: {
  group: PortalDocumentGroup;
  busy: boolean;
  uploadingSlot?: string;
  slotErrors: Record<string, string>;
  onUpload: (slotId: string, files: FileList, replacesEvidenceId?: string) => Promise<void>;
  onView: (evidenceId: string) => Promise<void>;
}) {
  const t = useTranslations("portal.step3");
  const title = t(`group_${group.kind}` as "group_applicant");

  return (
    <section className="flex flex-col gap-3" aria-labelledby={`group-${group.kind}-${group.subjectId ?? "main"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2
          id={`group-${group.kind}-${group.subjectId ?? "main"}`}
          className="text-base font-semibold text-foreground"
        >
          {title}
        </h2>
        {/* Derived from this group's own slots — the "3 de 4" the vehicle
            section needs, computed the same way for every section. */}
        <p className="text-xs font-medium text-muted-foreground">
          {t("groupProgress", { done: group.completedCount, total: group.totalCount })}
        </p>
      </div>

      <div className="flex flex-col gap-2.5">
        {group.tasks.map((task) => (
          <DocumentTaskCard
            key={task.slotId}
            task={task}
            busy={busy}
            uploading={uploadingSlot === task.slotId}
            errorMessage={slotErrors[task.slotId]}
            onUpload={onUpload}
            onView={onView}
          />
        ))}
      </div>
    </section>
  );
}
