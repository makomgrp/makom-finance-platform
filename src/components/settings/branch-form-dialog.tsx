"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  createBranchAction,
  updateBranchAction,
} from "@/app/(app)/configuracion/actions";
import type { Branch } from "@/types";

/**
 * Create or edit a branch (Milestone 25A).
 *
 * `code` is the branch's STABLE MACHINE IDENTITY — short, uppercase, and the
 * thing every foreign key would refer to if it referred to anything but the id.
 * `name` is display only and freely editable, which is exactly why identity
 * does not live in it (the Milestone 21 legacy_id lesson).
 *
 * NO FABRICATED DEFAULTS. Every field starts empty; nothing is pre-filled with
 * a plausible Panama location. ODL's real branch list comes from the business,
 * and a helpful-looking placeholder is how invented data gets into a system.
 */

interface BranchFormDialogProps {
  /** Absent = create. Present = edit. */
  branch?: Branch;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSaved: () => void;
}

const EMPTY_FORM = {
  code: "",
  name: "",
  province: "",
  city: "",
  address: "",
  phone: "",
  email: "",
  isHeadquarters: false,
};

export function BranchFormDialog({
  branch,
  trigger,
  open: controlledOpen,
  onOpenChange,
  onSaved,
}: BranchFormDialogProps) {
  const t = useTranslations();
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (value: boolean) => {
    if (onOpenChange) onOpenChange(value);
    if (!isControlled) setInternalOpen(value);
  };

  const [form, setForm] = useState(() =>
    branch
      ? {
          code: branch.code,
          name: branch.name,
          province: branch.province,
          city: branch.city ?? "",
          address: branch.address ?? "",
          phone: branch.phone ?? "",
          email: branch.email ?? "",
          isHeadquarters: branch.isHeadquarters,
        }
      : EMPTY_FORM
  );
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const update = <K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    // Mirrors the Server Action's checks so the operator gets an immediate
    // message; the action and the database CHECK remain the enforcement.
    const code = form.code.trim().toUpperCase();
    if (!/^[A-Z0-9-]{2,12}$/.test(code)) {
      setError(t("settings.branches.form.validation.code"));
      return;
    }
    if (!form.name.trim()) {
      setError(t("settings.branches.form.validation.name"));
      return;
    }
    if (!form.province.trim()) {
      setError(t("settings.branches.form.validation.province"));
      return;
    }

    setError(null);
    setIsSubmitting(true);
    const payload = {
      code,
      name: form.name,
      province: form.province,
      city: form.city || undefined,
      address: form.address || undefined,
      phone: form.phone || undefined,
      email: form.email || undefined,
      isHeadquarters: form.isHeadquarters,
    };
    const result = branch
      ? await updateBranchAction(branch.id, payload)
      : await createBranchAction(payload);
    setIsSubmitting(false);

    if (result.status !== "success") {
      const key =
        result.code === "DUPLICATE_CODE"
          ? "settings.branches.toasts.duplicateCode"
          : result.code === "FORBIDDEN" || result.code === "UNAUTHENTICATED"
            ? "settings.branches.toasts.forbidden"
            : result.code === "INVALID_INPUT"
              ? "settings.branches.toasts.invalidInput"
              : "settings.branches.toasts.error";
      // Dialog stays open — nothing the operator typed is discarded.
      setError(t(key));
      return;
    }

    toast.success(
      branch ? t("settings.branches.toasts.updated") : t("settings.branches.toasts.created")
    );
    setOpen(false);
    if (!branch) setForm(EMPTY_FORM);
    onSaved();
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger render={trigger as React.ReactElement} />}
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {branch ? t("settings.branches.form.titleEdit") : t("settings.branches.form.titleNew")}
          </DialogTitle>
          <DialogDescription>{t("settings.branches.form.description")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="branch-code">{t("settings.branches.form.code")}</Label>
              <Input
                id="branch-code"
                value={form.code}
                disabled={isSubmitting}
                onChange={(e) => update("code", e.target.value.toUpperCase())}
              />
              <p className="text-xs text-muted-foreground">
                {t("settings.branches.form.codeHint")}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="branch-name">{t("settings.branches.form.name")}</Label>
              <Input
                id="branch-name"
                value={form.name}
                disabled={isSubmitting}
                onChange={(e) => update("name", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="branch-province">{t("settings.branches.form.province")}</Label>
              <Input
                id="branch-province"
                value={form.province}
                disabled={isSubmitting}
                onChange={(e) => update("province", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="branch-city">{t("settings.branches.form.city")}</Label>
              <Input
                id="branch-city"
                value={form.city}
                disabled={isSubmitting}
                onChange={(e) => update("city", e.target.value)}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="branch-address">{t("settings.branches.form.address")}</Label>
              <Input
                id="branch-address"
                value={form.address}
                disabled={isSubmitting}
                onChange={(e) => update("address", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="branch-phone">{t("settings.branches.form.phone")}</Label>
              <Input
                id="branch-phone"
                value={form.phone}
                disabled={isSubmitting}
                onChange={(e) => update("phone", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="branch-email">{t("settings.branches.form.email")}</Label>
              <Input
                id="branch-email"
                type="email"
                value={form.email}
                disabled={isSubmitting}
                onChange={(e) => update("email", e.target.value)}
              />
            </div>
          </div>

          <div className="flex items-start gap-3 rounded-lg border border-border p-3">
            <Checkbox
              id="branch-hq"
              checked={form.isHeadquarters}
              disabled={isSubmitting}
              onCheckedChange={(value) => update("isHeadquarters", value === true)}
              className="mt-0.5"
            />
            <div className="space-y-1">
              <Label htmlFor="branch-hq" className="cursor-pointer font-medium">
                <Building2 className="mr-1.5 inline size-3.5" />
                {t("settings.branches.form.isHeadquarters")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("settings.branches.form.isHeadquartersHint")}
              </p>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t("settings.branches.form.saving") : t("settings.branches.form.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
