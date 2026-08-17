"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { inviteStaffUser } from "@/app/(app)/configuracion/actions";
import { USER_ROLE_VALUES } from "@/lib/config/user-role";
import { LANGUAGE_CONFIG, SUPPORTED_LANGUAGE_VALUES } from "@/lib/config/language";
import type { SupportedLanguage, UserRole } from "@/types";

/**
 * Invite a staff member (Milestone 21) — the replacement for the toast-only
 * button Milestone 18 removed.
 *
 * Collects only what `create_staff_profile` actually needs: e-mail, name,
 * role and preferred language. No password field exists anywhere in this
 * flow by design — the invited person sets their own through Supabase's
 * invitation e-mail, so no temporary secret is ever created, shown or
 * transmitted.
 *
 * THREE OUTCOMES, not two. Besides success and failure there is
 * `pending_invitation`: the profile was created but the Auth invitation did
 * not complete. That is surfaced as a WARNING with an explicit instruction to
 * resend — never as a success, and never as a failure that would imply
 * nothing was created. See inviteStaffUser's doc comment for why the
 * orchestration cannot be atomic.
 */

interface InviteUserDialogProps {
  onInvited: () => void;
}

const EMPTY_FORM = {
  email: "",
  fullName: "",
  role: "asesor" as UserRole,
  preferredLanguage: "es" as SupportedLanguage,
};

export function InviteUserDialog({ onInvited }: InviteUserDialogProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const update = <K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const close = () => {
    setOpen(false);
    setForm(EMPTY_FORM);
    setError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    // Mirrors the Server Action's own checks so the operator gets an
    // immediate message; the action remains the enforcement.
    if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
      setError(t("settings.users.invite.validation.email"));
      return;
    }
    if (!form.fullName.trim()) {
      setError(t("settings.users.invite.validation.fullName"));
      return;
    }

    setError(null);
    setIsSubmitting(true);
    const result = await inviteStaffUser({
      email: form.email,
      fullName: form.fullName,
      role: form.role,
      preferredLanguage: form.preferredLanguage,
    });
    setIsSubmitting(false);

    if (result.status === "error") {
      const key =
        result.code === "DUPLICATE_EMAIL"
          ? "settings.users.invite.toasts.duplicateEmail"
          : result.code === "ALREADY_REGISTERED"
            ? "settings.users.invite.toasts.alreadyRegistered"
            : result.code === "FORBIDDEN" || result.code === "UNAUTHENTICATED"
              ? "settings.users.invite.toasts.forbidden"
              : result.code === "INVALID_INPUT"
                ? "settings.users.invite.toasts.invalidInput"
                : "settings.users.invite.toasts.error";
      // Dialog stays open — nothing the operator typed is discarded.
      setError(t(key));
      return;
    }

    if (result.status === "pending_invitation") {
      // The profile EXISTS. Never reported as plain success.
      toast.warning(t("settings.users.invite.toasts.pending"));
    } else {
      toast.success(t("settings.users.invite.toasts.invited", { email: form.email.trim() }));
    }

    close();
    onInvited();
  };

  return (
    <Dialog open={open} onOpenChange={(value) => (value ? setOpen(true) : close())}>
      <DialogTrigger
        render={
          <Button size="sm" variant="outline">
            <UserPlus className="size-4" />
            {t("settings.users.invite.trigger")}
          </Button>
        }
      />
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("settings.users.invite.title")}</DialogTitle>
          <DialogDescription>{t("settings.users.invite.description")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invite-full-name">{t("settings.users.invite.fullName")}</Label>
            <Input
              id="invite-full-name"
              value={form.fullName}
              onChange={(event) => update("fullName", event.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="invite-email">{t("settings.users.invite.email")}</Label>
            <Input
              id="invite-email"
              type="email"
              value={form.email}
              onChange={(event) => update("email", event.target.value)}
              disabled={isSubmitting}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="invite-role">{t("settings.users.invite.role")}</Label>
              <Select
                value={form.role}
                onValueChange={(value) => value && update("role", value as UserRole)}
                disabled={isSubmitting}
              >
                <SelectTrigger id="invite-role">
                  <SelectValue>{(value: string) => t(`roles.${value}`)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {USER_ROLE_VALUES.map((role) => (
                    <SelectItem key={role} value={role}>
                      {t(`roles.${role}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="invite-language">{t("settings.users.invite.language")}</Label>
              <Select
                value={form.preferredLanguage}
                onValueChange={(value) =>
                  value && update("preferredLanguage", value as SupportedLanguage)
                }
                disabled={isSubmitting}
              >
                <SelectTrigger id="invite-language">
                  <SelectValue>
                    {(value: string) => LANGUAGE_CONFIG[value as SupportedLanguage].nativeName}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_LANGUAGE_VALUES.map((language) => (
                    <SelectItem key={language} value={language}>
                      {LANGUAGE_CONFIG[language].nativeName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <p className="text-xs text-muted-foreground">{t("settings.users.invite.note")}</p>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close} disabled={isSubmitting}>
              {t("settings.users.invite.cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting
                ? t("settings.users.invite.submitting")
                : t("settings.users.invite.submit")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
