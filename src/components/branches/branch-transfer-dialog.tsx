"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * The branch transfer dialog (Milestone 25B-3) — shared by the client and the
 * application transfer, because the operator is answering the same question in
 * both cases: "where should this go?"
 *
 * IT HOLDS NO RULES. It loads its options from a Server Action, renders two
 * names and a confirm button, and reports the chosen id back. It does not know
 * what a branch scope is, cannot compute one, and never decides whether a
 * transfer is allowed — the caller has already gated the affordance on
 * `branch:transfer`, and the database re-authorizes both sides of the move
 * regardless of what this component sends.
 *
 * NAMES IN, NAMES OUT. The operator sees branch NAMES only. Ids exist solely as
 * opaque option values behind the select and are never rendered — a UUID in a
 * dialog is an implementation detail leaking into somebody's workday.
 *
 * AN UNASSIGNED RECORD SHOWS "Sin asignar" / "Unassigned", never a blank and
 * never an invented branch. That state is real and common right now: every
 * legacy and public-intake record is unassigned until an administrator routes
 * it, which is precisely what this dialog is for.
 */
export interface BranchTransferOption {
  id: string;
  name: string;
}

export type BranchTransferOptionsResult =
  | { status: "success"; currentBranchName: string | null; destinations: BranchTransferOption[] }
  | { status: "error"; code: string };

interface BranchTransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "client" picks the client wording, "application" the application wording.
   * The only difference between the two uses. */
  entity: "client" | "application";
  /** Loads current branch + destinations. Invoked on open, never at import. */
  loadOptions: () => Promise<BranchTransferOptionsResult>;
  /** Performs the transfer. Resolves to null on success, or a message to show. */
  onConfirm: (destinationBranchId: string) => Promise<string | null>;
}

export function BranchTransferDialog({
  open,
  onOpenChange,
  entity,
  loadOptions,
  onConfirm,
}: BranchTransferDialogProps) {
  const t = useTranslations();
  // MOUNT IS THE TRIGGER, NOT AN OPEN FLAG. Every caller renders this component
  // only while a transfer is in progress ({target && <BranchTransferDialog …>}),
  // so it mounts fresh each time and its initial state IS the reset. That is
  // why `isLoading` starts true and why the effect below never has to clear
  // stale state — there is none. Resetting inside the effect would also be a
  // direct setState in an effect body, which react-hooks/set-state-in-effect
  // correctly rejects.
  const [isLoading, setIsLoading] = useState(true);
  const [currentBranchName, setCurrentBranchName] = useState<string | null>(null);
  const [destinations, setDestinations] = useState<BranchTransferOption[]>([]);
  const [destinationId, setDestinationId] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Options are fetched when the dialog opens, not when the row renders: a page
  // holding a branch directory per row would be a lot of reads for a menu
  // almost nobody opens.
  useEffect(() => {
    let cancelled = false;

    void loadOptions().then((result) => {
      if (cancelled) return;
      setIsLoading(false);
      if (result.status !== "success") {
        setDestinations([]);
        setCurrentBranchName(null);
        setError(t("branchTransfer.errorNotFound"));
        return;
      }
      setCurrentBranchName(result.currentBranchName);
      setDestinations(result.destinations);
    });

    return () => {
      cancelled = true;
    };
    // `loadOptions` is a fresh closure on every render; depending on it would
    // refetch forever. Mount is the intended trigger — see the state comment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  const handleConfirm = async () => {
    if (!destinationId || isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    const message = await onConfirm(destinationId);
    setIsSubmitting(false);
    if (message) {
      // Stays open on failure so the operator can pick a different branch
      // without reopening and reloading.
      setError(message);
      return;
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {entity === "client" ? t("branchTransfer.title") : t("branchTransfer.titleApplication")}
          </DialogTitle>
          <DialogDescription>
            {entity === "client"
              ? t("branchTransfer.description")
              : t("branchTransfer.descriptionApplication")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1">
            <Label>{t("branchTransfer.currentBranch")}</Label>
            <p className="text-sm text-muted-foreground">
              {currentBranchName ?? t("branchTransfer.unassigned")}
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="branch-transfer-destination">
              {t("branchTransfer.destinationBranch")}
            </Label>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">{t("branchTransfer.loading")}</p>
            ) : destinations.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("branchTransfer.noDestinations")}</p>
            ) : (
              <Select
                value={destinationId}
                onValueChange={(value) => setDestinationId(value ?? "")}
              >
                <SelectTrigger id="branch-transfer-destination">
                  <SelectValue placeholder={t("branchTransfer.selectDestination")} />
                </SelectTrigger>
                <SelectContent>
                  {destinations.map((branch) => (
                    <SelectItem key={branch.id} value={branch.id}>
                      {branch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
            {t("branchTransfer.cancel")}
          </Button>
          <Button onClick={handleConfirm} disabled={!destinationId || isSubmitting || isLoading}>
            {t("branchTransfer.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
