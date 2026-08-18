"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Building2, Globe2, Star, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/shared/status-badge";
import {
  assignProfileBranchAction,
  removeProfileBranchAction,
  setProfileBranchScopeModeAction,
  setProfilePrimaryBranchAction,
} from "@/app/(app)/configuracion/actions";
import { useCapability } from "@/lib/auth/use-capability";
import type { Branch, BranchMembership, BranchScopeMode, StaffUser } from "@/types";

/**
 * Branch scope for one staff member (Milestone 25A).
 *
 * TWO INDEPENDENT CONTROLS, and the separation is the security model:
 *
 *   ALCANCE  'Sucursales' or 'Nacional' — how FAR this person's reach extends.
 *            Administrador-only (`user:manage_permissions`), because national
 *            is the widest thing anyone can be given and `branch:manage` is
 *            delegatable. Delegating an ACTION must never delegate DATA SCOPE.
 *   SUCURSALES  which specific branches. `branch:manage`, and a delegated
 *            holder may only assign branches they themselves belong to (B1),
 *            never to a target whose reach already exceeds theirs (B2), and
 *            never to themselves (B3).
 *
 * NO UUIDs ARE SHOWN. Branches are identified by code and name; ids exist only
 * in the wire payload. NO STATIC BRANCH LIST — every option comes from the live
 * `branches` table, so a CRM with no branches offers nothing to assign and says
 * so.
 *
 * The database enforces every rule above independently; this component hiding a
 * control is a courtesy, not the boundary.
 */

interface UserBranchesDialogProps {
  user: StaffUser;
  scopeMode: BranchScopeMode;
  memberships: BranchMembership[];
  /** Active branches available to assign, resolved server-side. */
  branches: Branch[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
}

export function UserBranchesDialog({
  user,
  scopeMode,
  memberships,
  branches,
  open,
  onOpenChange,
  onChanged,
}: UserBranchesDialogProps) {
  const t = useTranslations();
  const canManageBranches = useCapability("branch:manage");
  const canManageScopeMode = useCapability("user:manage_permissions");
  const [busy, setBusy] = useState(false);
  const [pendingBranchId, setPendingBranchId] = useState("");

  const assigned = memberships.filter((m) => m.profileId === user.id);
  const assignedIds = new Set(assigned.map((m) => m.branchId));
  const assignable = branches.filter((b) => b.active && !assignedIds.has(b.id));
  const branchById = new Map(branches.map((b) => [b.id, b]));
  const isNational = scopeMode === "national";

  const report = (ok: boolean, successKey: string, code?: string) => {
    if (ok) {
      toast.success(t(successKey));
      onChanged();
      return;
    }
    toast.error(
      t(
        code === "FORBIDDEN"
          ? "settings.branches.scope.toasts.forbidden"
          : "settings.branches.scope.toasts.error"
      )
    );
  };

  const handleScopeMode = async (mode: BranchScopeMode) => {
    if (mode === scopeMode) return;
    setBusy(true);
    const result = await setProfileBranchScopeModeAction(user.id, mode);
    setBusy(false);
    report(
      result.status === "success",
      mode === "national"
        ? "settings.branches.scope.toasts.setNational"
        : "settings.branches.scope.toasts.setBranch",
      result.status === "error" ? result.code : undefined
    );
  };

  const handleAssign = async () => {
    if (!pendingBranchId) return;
    setBusy(true);
    const result = await assignProfileBranchAction(user.id, pendingBranchId, assigned.length === 0);
    setBusy(false);
    setPendingBranchId("");
    report(
      result.status === "success",
      "settings.branches.scope.toasts.assigned",
      result.status === "error" ? result.code : undefined
    );
  };

  const handleRemove = async (branchId: string) => {
    setBusy(true);
    const result = await removeProfileBranchAction(user.id, branchId);
    setBusy(false);
    report(
      result.status === "success",
      "settings.branches.scope.toasts.removed",
      result.status === "error" ? result.code : undefined
    );
  };

  const handlePrimary = async (branchId: string) => {
    setBusy(true);
    const result = await setProfilePrimaryBranchAction(user.id, branchId);
    setBusy(false);
    report(
      result.status === "success",
      "settings.branches.scope.toasts.primarySet",
      result.status === "error" ? result.code : undefined
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("settings.branches.scope.title")}</DialogTitle>
          <DialogDescription>
            {t("settings.branches.scope.description", { name: user.fullName })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5">
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("settings.branches.scope.mode")}
            </p>
            {canManageScopeMode ? (
              <Select
                value={scopeMode}
                disabled={busy}
                onValueChange={(value) => value && handleScopeMode(value as BranchScopeMode)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(value: string) => t(`settings.branches.scope.modes.${value}`)}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="branch">
                    {t("settings.branches.scope.modes.branch")}
                  </SelectItem>
                  <SelectItem value="national">
                    {t("settings.branches.scope.modes.national")}
                  </SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <StatusBadge
                label={t(`settings.branches.scope.modes.${scopeMode}`)}
                className="border-border bg-muted text-foreground"
              />
            )}
            <p className="text-xs text-muted-foreground">
              {t("settings.branches.scope.modeHint")}
            </p>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("settings.branches.scope.assigned")}
            </p>

            {isNational ? (
              /* National reach makes an explicit branch list meaningless — it
                 already covers every branch, including ones created tomorrow.
                 Say that rather than showing a list that implies limits. */
              <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                <Globe2 className="mt-0.5 size-4 shrink-0" />
                {t("settings.branches.scope.nationalNotice")}
              </p>
            ) : assigned.length === 0 ? (
              <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                <Building2 className="mt-0.5 size-4 shrink-0" />
                {t("settings.branches.scope.none")}
              </p>
            ) : (
              <ul className="space-y-2">
                {assigned.map((membership) => {
                  const branch = branchById.get(membership.branchId);
                  if (!branch) return null;
                  return (
                    <li
                      key={membership.branchId}
                      className="flex items-center justify-between gap-2 rounded-lg border border-border p-3"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {branch.code} · {branch.name}
                        </span>
                        {membership.isPrimary && (
                          <span className="text-xs text-muted-foreground">
                            {t("settings.branches.scope.primary")}
                          </span>
                        )}
                      </span>
                      {canManageBranches && (
                        <span className="flex shrink-0 gap-1">
                          {!membership.isPrimary && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              onClick={() => handlePrimary(membership.branchId)}
                            >
                              <Star className="size-3.5" />
                              {t("settings.branches.scope.makePrimary")}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={busy}
                            onClick={() => handleRemove(membership.branchId)}
                          >
                            <X className="size-4" />
                            <span className="sr-only">{t("settings.branches.scope.remove")}</span>
                          </Button>
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}

            {canManageBranches && !isNational && (
              <div className="flex gap-2">
                <Select
                  value={pendingBranchId}
                  disabled={busy || assignable.length === 0}
                  onValueChange={(value) => value && setPendingBranchId(value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={t("settings.branches.scope.selectBranch")}>
                      {(value: string) => {
                        const branch = branchById.get(value);
                        return branch
                          ? `${branch.code} · ${branch.name}`
                          : t("settings.branches.scope.selectBranch");
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {assignable.map((branch) => (
                      <SelectItem key={branch.id} value={branch.id}>
                        {branch.code} · {branch.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  disabled={busy || !pendingBranchId}
                  onClick={handleAssign}
                >
                  {t("settings.branches.scope.assign")}
                </Button>
              </div>
            )}

            {assignable.length === 0 && !isNational && canManageBranches && (
              <p className="text-xs text-muted-foreground">
                {branches.length === 0
                  ? t("settings.branches.scope.noBranchesConfigured")
                  : t("settings.branches.scope.allAssigned")}
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("settings.branches.scope.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
