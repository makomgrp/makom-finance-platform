"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ShieldCheck, Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  grantStaffUserCapability,
  revokeStaffUserCapability,
} from "@/app/(app)/configuracion/actions";
import { DELEGATABLE_CAPABILITIES, type DelegatableCapability } from "@/lib/auth/capabilities";
import type { StaffUser } from "@/types";

/**
 * Additional permissions for one staff member (Milestone 24).
 *
 * WHAT THIS IS FOR. ODL's administrador travels; the gerente has to be able to
 * run routine staff administration without waiting for him. This dialog is
 * where that delegation is decided — one employee at a time, one permission at
 * a time, each an immediate audited change.
 *
 * NOT A GENERIC ACL EDITOR, deliberately. It lists ONLY the three delegatable
 * staff-management permissions, each with a plain-language sentence describing
 * what the person will be able to do. Technical capability identifiers such as
 * `user:invite` never appear on screen — they are the wire format, not the
 * product. An ODL administrator should be able to read this dialog and know
 * exactly what they are handing over.
 *
 * WHAT IT CANNOT DO, BY CONSTRUCTION:
 *   - grant `user:manage_permissions` (absent from DELEGATABLE_CAPABILITIES,
 *     and refused by a database CHECK constraint)
 *   - appear at all for someone without `user:manage_permissions`, which only
 *     administrador holds
 *   - edit one's own permissions (A5, refused by the RPC; the caller hides the
 *     entry point as a courtesy)
 *
 * The database is authoritative for every one of those. This component hiding a
 * checkbox is UX, not security.
 */

interface UserPermissionsDialogProps {
  user: StaffUser;
  /** Capabilities currently granted to this user, resolved server-side. */
  grantedCapabilities: DelegatableCapability[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after a successful mutation so the caller can refresh. */
  onChanged: () => void;
}

export function UserPermissionsDialog({
  user,
  grantedCapabilities,
  open,
  onOpenChange,
  onChanged,
}: UserPermissionsDialogProps) {
  const t = useTranslations();
  const [busyCapability, setBusyCapability] = useState<string | null>(null);
  // Mirrors the server list so a toggle reflects immediately; the authoritative
  // value still arrives on the next refresh.
  const [granted, setGranted] = useState<Set<string>>(new Set(grantedCapabilities));

  /* TARGET role, not the viewer's: an administrador already holds every
     capability, so a delegation checklist would be meaningless for them.
     Not an authorization decision — this dialog only renders at all for a
     holder of user:manage_permissions. */
  const isAdministrador = user.role === "administrador";

  const handleToggle = async (capability: DelegatableCapability, next: boolean) => {
    setBusyCapability(capability);
    const result = next
      ? await grantStaffUserCapability({ profileId: user.id, capability })
      : await revokeStaffUserCapability({ profileId: user.id, capability });
    setBusyCapability(null);

    if (result.status !== "success") {
      toast.error(
        t(
          result.code === "FORBIDDEN"
            ? "settings.users.permissions.toasts.forbidden"
            : "settings.users.permissions.toasts.error"
        )
      );
      return;
    }

    setGranted((prev) => {
      const updated = new Set(prev);
      if (next) updated.add(capability);
      else updated.delete(capability);
      return updated;
    });

    toast.success(
      t(
        next
          ? "settings.users.permissions.toasts.granted"
          : "settings.users.permissions.toasts.revoked",
        { permission: t(`settings.users.permissions.capabilities.${capability}.label`) }
      )
    );
    onChanged();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("settings.users.permissions.title")}</DialogTitle>
          <DialogDescription>
            {t("settings.users.permissions.description", { name: user.fullName })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("settings.users.permissions.baseRole")}
            </p>
            <StatusBadge
              label={t(`roles.${user.role}`)}
              className="border-border bg-muted text-foreground"
            />
          </div>

          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("settings.users.permissions.additional")}
            </p>

            {isAdministrador ? (
              /* An administrador already holds every capability in the system,
                 so a delegation checklist would be meaningless here — and
                 ticking a box would imply it granted something. Say so plainly
                 instead. */
              <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                <ShieldCheck className="mt-0.5 size-4 shrink-0" />
                {t("settings.users.permissions.notApplicableAdmin")}
              </p>
            ) : (
              <div className="space-y-3">
                {DELEGATABLE_CAPABILITIES.map((capability) => {
                  const checked = granted.has(capability);
                  const inputId = `capability-${capability}`;

                  return (
                    <div
                      key={capability}
                      className="flex items-start gap-3 rounded-lg border border-border p-3"
                    >
                      <Checkbox
                        id={inputId}
                        checked={checked}
                        disabled={busyCapability !== null}
                        onCheckedChange={(value) => handleToggle(capability, value === true)}
                        className="mt-0.5"
                      />
                      <div className="space-y-1">
                        <Label htmlFor={inputId} className="cursor-pointer font-medium">
                          {t(`settings.users.permissions.capabilities.${capability}.label`)}
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          {t(`settings.users.permissions.capabilities.${capability}.description`)}
                        </p>
                      </div>
                    </div>
                  );
                })}

                <p className="flex items-start gap-2 text-xs text-muted-foreground">
                  <Info className="mt-0.5 size-3.5 shrink-0" />
                  {t("settings.users.permissions.roleChangeWarning")}
                </p>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("settings.users.permissions.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
