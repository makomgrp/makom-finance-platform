"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CONTACT_METHODS, CONTACT_OUTCOMES } from "@/lib/config/follow-up";
import type { ContactMethod, ContactOutcome } from "@/types";

/**
 * ============================================================================
 * RECORDING WHAT AN ADVISOR ALREADY DID (26B-6)
 * ============================================================================
 *
 * This form SENDS NOTHING. It records a call, WhatsApp message or email that a
 * human already made, and optionally the next thing they committed to. No
 * messaging, no reminders — that is a later milestone's job, and this is the
 * data it will read.
 *
 * WHAT IT REFUSES TO SAVE: an empty record. Method and outcome are always
 * required, because "we contacted them somehow, and something happened" is not
 * information anyone can act on later. Outcome `other` additionally requires a
 * note, since on its own it says strictly nothing.
 *
 * THE NEXT ACTION IS ALL OR NOTHING. A description with no date can never
 * become due, and a date with no description tells the next reader nothing —
 * so the form asks for both or neither, matching the database CHECK constraint
 * rather than discovering it as an error.
 */

export interface LogFollowUpSubmit {
  contactMethod: ContactMethod;
  outcome: ContactOutcome;
  note?: string;
  nextAction?: string;
  nextActionAt?: string;
}

interface LogFollowUpDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Whose process this is, for the dialog title. */
  subjectName?: string;
  onSubmit: (values: LogFollowUpSubmit) => Promise<void>;
}

export function LogFollowUpDialog({
  open,
  onOpenChange,
  subjectName,
  onSubmit,
}: LogFollowUpDialogProps) {
  const t = useTranslations();
  const [method, setMethod] = useState<ContactMethod>("call");
  const [outcome, setOutcome] = useState<ContactOutcome>("contacted");
  const [note, setNote] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [nextActionAt, setNextActionAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setMethod("call");
    setOutcome("contacted");
    setNote("");
    setNextAction("");
    setNextActionAt("");
    setError(null);
  };

  const handleSubmit = async () => {
    if (saving) return;

    if (outcome === "other" && note.trim().length === 0) {
      setError(t("followUp.errors.noteRequiredForOther"));
      return;
    }
    // Both halves or neither — the same rule the constraint enforces.
    if (Boolean(nextAction.trim()) !== Boolean(nextActionAt)) {
      setError(t("followUp.errors.nextActionPair"));
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        contactMethod: method,
        outcome,
        note: note.trim() || undefined,
        nextAction: nextAction.trim() || undefined,
        // datetime-local yields wall-clock text with no zone; `new Date()`
        // reads it in the advisor's own timezone, which is what they meant.
        nextActionAt: nextActionAt ? new Date(nextActionAt).toISOString() : undefined,
      });
      reset();
      onOpenChange(false);
    } catch {
      setError(t("followUp.errors.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {subjectName ? `${t("followUp.logFollowUp")} · ${subjectName}` : t("followUp.logFollowUp")}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">{t("followUp.contactMethod")}</span>
            <Select value={method} onValueChange={(v) => setMethod(v as ContactMethod)}>
              <SelectTrigger>
                {/* base-ui renders the raw VALUE unless given a mapper, so this
                    read "call" instead of "Llamada" in the closed trigger. */}
                <SelectValue>
                  {(value: string) => t(`followUp.methods.${value}` as "followUp.methods.call")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {CONTACT_METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {t(`followUp.methods.${m}` as "followUp.methods.call")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">{t("followUp.outcome")}</span>
            <Select value={outcome} onValueChange={(v) => setOutcome(v as ContactOutcome)}>
              <SelectTrigger>
                <SelectValue>
                  {(value: string) => t(`followUp.outcomes.${value}` as "followUp.outcomes.contacted")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {CONTACT_OUTCOMES.map((o) => (
                  <SelectItem key={o} value={o}>
                    {t(`followUp.outcomes.${o}` as "followUp.outcomes.contacted")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-foreground">
              {t("followUp.note")}
              {outcome === "other" && <span className="text-destructive"> *</span>}
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              maxLength={1000}
              className="min-h-20 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </label>

          <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-sm font-medium text-foreground">{t("followUp.nextAction")}</p>
            <Input
              value={nextAction}
              onChange={(e) => setNextAction(e.target.value)}
              maxLength={200}
              placeholder={t("followUp.nextActionPlaceholder")}
            />
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{t("followUp.nextActionDate")}</span>
              <Input
                type="datetime-local"
                value={nextActionAt}
                onChange={(e) => setNextActionAt(e.target.value)}
              />
            </label>
          </div>

          {error && (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          )}

          <div className="flex flex-col gap-2 sm:flex-row-reverse">
            <Button type="button" onClick={() => void handleSubmit()} disabled={saving}>
              {saving ? t("common.saving") : t("followUp.save")}
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
