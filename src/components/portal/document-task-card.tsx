"use client";

import { useId, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Eye, Loader2, Paperclip, Plus, RefreshCw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PortalDocumentTask } from "@/lib/services/portal-documents";
import type { LocalizedText } from "@/types";

/**
 * ============================================================================
 * ONE DOCUMENT, ONE SMALL TASK (26B-3)
 * ============================================================================
 *
 * Step 3 is a checklist of errands, not a wall of file inputs. Each card shows
 * one requirement: what it is, whether it is done, what was sent, and the one
 * or two things the customer can do about it.
 *
 * WHAT IS DELIBERATELY NOT SHOWN: requirement codes, slot ids, storage paths,
 * bucket names, MIME types, review verdicts. A customer needs to know whether
 * ODL has their pay slips — not how the system files them.
 *
 * STATUS IS NEVER COLOUR ALONE. A complete task carries a check icon, the word
 * "recibido(s)" and a count; a required-but-missing one says so in words. The
 * green tint is the last signal, not the only one.
 */

export interface DocumentTaskCardProps {
  task: PortalDocumentTask;
  /** Uploads run through the parent so one card cannot fight another. */
  onUpload: (slotId: string, files: FileList, replacesEvidenceId?: string) => Promise<void>;
  onView: (evidenceId: string) => Promise<void>;
  busy: boolean;
  /** Set when THIS card is the one currently uploading. */
  uploading: boolean;
  errorMessage?: string;
}

export function DocumentTaskCard({
  task,
  onUpload,
  onView,
  busy,
  uploading,
  errorMessage,
}: DocumentTaskCardProps) {
  const t = useTranslations("portal.step3");
  const locale = useLocale() as keyof LocalizedText;
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const [replacing, setReplacing] = useState<string | undefined>();
  const [viewingId, setViewingId] = useState<string | undefined>();

  const liveFiles = task.files.filter((f) => !f.isSuperseded);
  const needed = task.minFiles ?? 1;
  const remaining = Math.max(0, needed - liveFiles.length);

  const handleView = async (evidenceId: string) => {
    setViewingId(evidenceId);
    try {
      await onView(evidenceId);
    } finally {
      setViewingId(undefined);
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border p-4 transition-colors",
        task.isComplete ? "border-success/30 bg-success/[0.04]" : "border-border bg-card"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground sm:text-[0.9375rem]">
            {task.name[locale] ?? task.name.es}
          </p>
          {task.description && (
            <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">
              {task.description[locale] ?? task.description.es}
            </p>
          )}

          {/* The instruction that actually tells them what to do. */}
          {!task.isComplete && needed > 1 && (
            <p className="mt-1.5 text-sm font-medium text-foreground">
              {t("needFiles", { count: needed })}
            </p>
          )}

          <div className="mt-2 flex flex-wrap items-center gap-2">
            {task.isComplete ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2.5 py-1 text-xs font-medium text-success">
                <Check className="size-3.5" aria-hidden="true" />
                {t("received", { count: liveFiles.length })}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                {task.required ? t("statusPending") : t("statusOptionalPending")}
              </span>
            )}

            {!task.required && (
              <span className="text-xs font-medium text-muted-foreground">{t("optional")}</span>
            )}

            {/* A copy now, the original at signing — said quietly, because it
                is information rather than an obstacle. */}
            {task.originalRequiredLater && (
              <span className="text-xs text-muted-foreground">{t("originalLater")}</span>
            )}
          </div>
        </div>
      </div>

      {/* ---- Files already sent ----------------------------------------- */}
      {liveFiles.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {liveFiles.map((file) => (
            <li
              key={file.evidenceId}
              className="flex items-center justify-between gap-2 rounded-lg border border-border/70 bg-background px-3 py-2"
            >
              {/* `min-w-0` + `truncate` are what stop a 90-character scan
                  filename from pushing the buttons off a 375px screen. */}
              <span className="flex min-w-0 items-center gap-2">
                <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate text-sm text-foreground" title={file.fileName}>
                  {file.fileName}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  // 44px square on touch widths, compact with its label from
                  // `sm` up. Two adjacent 32px icon buttons are a genuinely
                  // hard target on a phone, and these sit side by side.
                  className="size-11 gap-1 px-0 sm:h-8 sm:w-auto sm:px-2"
                  disabled={busy}
                  onClick={() => void handleView(file.evidenceId)}
                >
                  {viewingId === file.evidenceId ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Eye className="size-3.5" aria-hidden="true" />
                  )}
                  <span className="sr-only sm:not-sr-only">{t("view")}</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="size-11 gap-1 px-0 sm:h-8 sm:w-auto sm:px-2"
                  disabled={busy}
                  onClick={() => {
                    setReplacing(file.evidenceId);
                    replaceRef.current?.click();
                  }}
                >
                  <RefreshCw className="size-3.5" aria-hidden="true" />
                  <span className="sr-only sm:not-sr-only">{t("replace")}</span>
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {errorMessage && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {errorMessage}
        </p>
      )}

      {/* ---- Upload ------------------------------------------------------ */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={inputId}
          ref={inputRef}
          type="file"
          // `multiple` mirrors the requirement's own config, so a
          // single-document requirement cannot receive a batch by accident.
          multiple={task.allowsMultipleFiles}
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) void onUpload(task.slotId, files);
            // Reset so selecting the SAME file again still fires a change.
            e.target.value = "";
          }}
        />
        <input
          ref={replaceRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/webp"
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            const files = e.target.files;
            if (files && files.length > 0) void onUpload(task.slotId, files, replacing);
            setReplacing(undefined);
            e.target.value = "";
          }}
        />

        <Button
          type="button"
          variant={task.isComplete ? "outline" : "default"}
          className="h-11 gap-1.5 px-4"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : liveFiles.length > 0 ? (
            <Plus className="size-4" aria-hidden="true" />
          ) : (
            <Upload className="size-4" aria-hidden="true" />
          )}
          {uploading
            ? t("uploading")
            : liveFiles.length > 0
              ? t("addAnother")
              : t("upload")}
        </Button>

        {/* Only ever says how many are still NEEDED — never implies that extra
            optional files are outstanding. */}
        {!task.isComplete && remaining > 0 && liveFiles.length > 0 && (
          <span className="text-xs text-muted-foreground">{t("stillNeed", { count: remaining })}</span>
        )}
      </div>
    </div>
  );
}
