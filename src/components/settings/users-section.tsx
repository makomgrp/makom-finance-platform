"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, MailWarning, Power, RotateCcw, Send, SlidersHorizontal } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { InviteUserDialog } from "@/components/settings/invite-user-dialog";
import { UserPermissionsDialog } from "@/components/settings/user-permissions-dialog";
import {
  resendStaffInvitation,
  setStaffUserActive,
  setStaffUserRole,
} from "@/app/(app)/configuracion/actions";
import { useCapability } from "@/lib/auth/use-capability";
import { canActOnStaffTarget } from "@/lib/auth/capabilities";
import { useCurrentProfile } from "@/lib/auth/current-profile-context";
import { LANGUAGE_CONFIG } from "@/lib/config/language";
import { USER_ROLE_VALUES } from "@/lib/config/user-role";
import type { DelegatableCapability } from "@/lib/auth/capabilities";
import type { StaffUser, UserRole } from "@/types";

/**
 * Settings > Users (Milestone 21) — real staff administration.
 *
 * WHAT CHANGED. The directory itself was already real, but it used
 * `profiles.legacy_id` as its id and silently skipped any row without one —
 * which was already hiding the deactivated QA account, and would have hidden
 * every user invited from here, since new profiles never get a legacy_id.
 * `StaffUser.id` is now `profiles.id` and no row is filtered.
 *
 * FOUR ADMINISTRATIVE ACTIONS AS OF MILESTONE 24, each gated on its OWN
 * capability rather than a single `user:manage`: invite/resend
 * (`user:invite`), change role (`user:set_role`), deactivate/reactivate
 * (`user:set_active`), and manage additional permissions
 * (`user:manage_permissions`). All four are enforced server-side by their
 * Server Action's requireCapability().
 *
 * The first three are DELEGATABLE — an administrador may grant them to an
 * individual, so a gerente can run staff operations without becoming an
 * administrador. The fourth never is: it is the privilege boundary, held by
 * administrador alone and refused by a database CHECK constraint if anyone
 * tries to delegate it.
 *
 * THERE IS NO DELETE, deliberately. Milestone 21's approved policy is
 * deactivate-only: `active = false` already blocks CRM access completely
 * (getCurrentProfile() returns null for it), while the row and every audit
 * fact attributed to it are retained permanently. The schema agrees —
 * messages.sender_profile_id is ON DELETE RESTRICT.
 *
 * No auth internals are shown. The linked/pending distinction is a boolean;
 * the underlying auth UUID never reaches this component.
 */

interface UsersSectionProps {
  users: StaffUser[];
  /** Milestone 24 — delegated capabilities per profile id, resolved
   * server-side. A profile with no entry simply has no delegated extras. */
  grantsByProfileId: Record<string, DelegatableCapability[]>;
  /** True when the Supabase read failed — shows an explicit error state
   * instead of silently falling back to any other data source. */
  hasError: boolean;
}

export function UsersSection({ users, grantsByProfileId, hasError }: UsersSectionProps) {
  const t = useTranslations();
  const router = useRouter();
  // MILESTONE 24 — one gate per operation, replacing the single `user:manage`.
  // Each is independently delegatable to an individual, so a gerente holding
  // only `user:invite` sees the invite and resend controls and nothing else.
  const canInviteUsers = useCapability("user:invite");
  const canSetUserRole = useCapability("user:set_role");
  const canSetUserActive = useCapability("user:set_active");
  // Administrador only — never delegatable, in TypeScript or in the database.
  const canManagePermissions = useCapability("user:manage_permissions");
  /** Whether ANY row-level control is available to this viewer. Drives the
   * actions column header, which should not appear as an empty column. */
  const canUseAnyRowAction = canInviteUsers || canSetUserActive || canManagePermissions;
  const currentProfile = useCurrentProfile();
  const [busyProfileId, setBusyProfileId] = useState<string | null>(null);
  const [permissionsUser, setPermissionsUser] = useState<StaffUser | null>(null);

  const handleRoleChange = async (user: StaffUser, role: UserRole) => {
    if (role === user.role) return;
    setBusyProfileId(user.id);
    const result = await setStaffUserRole({ profileId: user.id, role });
    setBusyProfileId(null);

    if (result.status !== "success") {
      toast.error(
        t(
          result.code === "LAST_ADMINISTRATOR"
            ? "settings.users.toasts.lastAdministrator"
            : "settings.users.toasts.roleError"
        )
      );
      return;
    }
    toast.success(
      t("settings.users.toasts.roleChanged", { name: user.fullName, role: t(`roles.${role}`) })
    );
    router.refresh();
  };

  const handleActiveToggle = async (user: StaffUser) => {
    setBusyProfileId(user.id);
    const result = await setStaffUserActive({ profileId: user.id, active: !user.active });
    setBusyProfileId(null);

    if (result.status !== "success") {
      toast.error(
        t(
          result.code === "CANNOT_DEACTIVATE_SELF"
            ? "settings.users.toasts.cannotDeactivateSelf"
            : result.code === "LAST_ADMINISTRATOR"
              ? "settings.users.toasts.lastAdministrator"
              : "settings.users.toasts.activeError"
        )
      );
      return;
    }
    toast.success(
      t(user.active ? "settings.users.toasts.deactivated" : "settings.users.toasts.reactivated", {
        name: user.fullName,
      })
    );
    router.refresh();
  };

  const handleResend = async (user: StaffUser) => {
    setBusyProfileId(user.id);
    const result = await resendStaffInvitation(user.id);
    setBusyProfileId(null);

    if (result.status !== "success") {
      toast.error(t("settings.users.toasts.resendError"));
      return;
    }
    toast.success(t("settings.users.toasts.resent", { email: user.email }));
    router.refresh();
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>{t("settings.users.title")}</CardTitle>
        {canInviteUsers && <InviteUserDialog onInvited={() => router.refresh()} />}
      </CardHeader>
      <CardContent>
        {hasError ? (
          <EmptyState
            icon={AlertTriangle}
            title={t("settings.users.loadErrorTitle")}
            description={t("settings.users.loadErrorDescription")}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("settings.users.columns.name")}</TableHead>
                  <TableHead>{t("settings.users.columns.email")}</TableHead>
                  <TableHead>{t("settings.users.columns.role")}</TableHead>
                  <TableHead>{t("settings.users.columns.language")}</TableHead>
                  <TableHead>{t("settings.users.columns.status")}</TableHead>
                  {canUseAnyRowAction && (
                    <TableHead className="text-right">{t("common.actions")}</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => {
                  const isBusy = busyProfileId === user.id;
                  const isSelf = user.id === currentProfile.id;
                  /* A1 mirrored in the UI: only an administrador may act on an
                     administrador. The RPCs enforce this regardless — hiding
                     the control just avoids offering an action that would be
                     refused. */
                  /* A1 mirrored from the database as a UI courtesy: never
                     offer a control the RPC would refuse. See
                     canActOnStaffTarget — this is target protection, not
                     caller authorization. */
                  const isProtectedTarget = !canActOnStaffTarget(currentProfile.role, user.role);

                  return (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium text-foreground">{user.fullName}</TableCell>
                      <TableCell className="text-muted-foreground">{user.email}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {canSetUserRole && !isSelf && !isProtectedTarget ? (
                          <Select
                            value={user.role}
                            onValueChange={(value) =>
                              value && handleRoleChange(user, value as UserRole)
                            }
                            disabled={isBusy}
                          >
                            <SelectTrigger className="w-40">
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
                        ) : (
                          t(`roles.${user.role}`)
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="rounded border border-border px-1.5 py-0.5 text-[11px] font-medium text-foreground">
                            {LANGUAGE_CONFIG[user.preferredLanguage].abbreviation}
                          </span>
                          {LANGUAGE_CONFIG[user.preferredLanguage].nativeName}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <StatusBadge
                            label={
                              user.active
                                ? t("settings.users.active")
                                : t("settings.users.inactive")
                            }
                            className={
                              user.active
                                ? "bg-success/10 text-success border-success/20"
                                : "bg-muted text-muted-foreground border-border"
                            }
                          />
                          {/* A profile with no linked Auth account is a
                              pending invitation — a documented, legitimate
                              state, not a broken row. It is also why the
                              person is absent from the Chat directory. */}
                          {!user.authLinked && (
                            <StatusBadge
                              label={t("settings.users.pendingInvitation")}
                              className="bg-warning/10 text-warning border-warning/20"
                            />
                          )}
                        </div>
                      </TableCell>
                      {canUseAnyRowAction && (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {canInviteUsers && !user.authLinked && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={isBusy}
                                onClick={() => handleResend(user)}
                              >
                                <Send className="size-3.5" />
                                {t("settings.users.resend")}
                              </Button>
                            )}
                            {/* Self-deactivation is refused by the RPC too —
                                the last administrator must not be able to
                                lock themselves out. Hidden here as a
                                courtesy; the database is the enforcement. */}
                            {canSetUserActive && !isSelf && !isProtectedTarget && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={isBusy}
                                onClick={() => handleActiveToggle(user)}
                              >
                                {user.active ? (
                                  <>
                                    <Power className="size-3.5" />
                                    {t("settings.users.deactivate")}
                                  </>
                                ) : (
                                  <>
                                    <RotateCcw className="size-3.5" />
                                    {t("settings.users.reactivate")}
                                  </>
                                )}
                            {/* Milestone 24 — administrador only. Never shown
                                for one's own row: A5 refuses self-grant at the
                                database, and offering the control would imply
                                otherwise. */}
                            {canManagePermissions && !isSelf && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={isBusy}
                                onClick={() => setPermissionsUser(user)}
                              >
                                <SlidersHorizontal className="size-3.5" />
                                {t("settings.users.permissions.trigger")}
                              </Button>
                            )}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            {permissionsUser && (
              <UserPermissionsDialog
                key={permissionsUser.id}
                user={permissionsUser}
                grantedCapabilities={grantsByProfileId[permissionsUser.id] ?? []}
                open={permissionsUser !== null}
                onOpenChange={(value) => !value && setPermissionsUser(null)}
                onChanged={() => router.refresh()}
              />
            )}

            {users.some((user) => !user.authLinked) && (
              <p className="mt-3 flex items-start gap-2 text-xs text-muted-foreground">
                <MailWarning className="mt-0.5 size-3.5 shrink-0" />
                {t("settings.users.pendingInvitationHint")}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
