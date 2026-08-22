"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertTriangle,
  Building2,
  MailWarning,
  Power,
  RotateCcw,
  Send,
  Shuffle,
  SlidersHorizontal,
} from "lucide-react";
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
import { UserBranchesDialog } from "@/components/settings/user-branches-dialog";
import {
  resendStaffInvitation,
  setStaffAutoAssignmentAction,
  setStaffUserActive,
  setStaffUserRole,
} from "@/app/(app)/configuracion/actions";
import { useCapability } from "@/lib/auth/use-capability";
import { canActOnStaffTarget } from "@/lib/auth/capabilities";
import { useCurrentProfile } from "@/lib/auth/current-profile-context";
import { LANGUAGE_CONFIG } from "@/lib/config/language";
import type { DelegatableCapability } from "@/lib/auth/capabilities";
import type { Branch, BranchMembership, StaffUser, UserRole } from "@/types";

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
  /* MILESTONE 25C-3 — the unscoped `branches` prop was REMOVED. It carried
   * every branch, including inactive ones and ones outside the caller's reach,
   * and fed the branch-assignment dialog. Deleting it rather than leaving it
   * unused is deliberate: a prop that still exists is a prop someone can wire
   * back up. `assignableBranches` below is the only branch list this section
   * receives. */
  /** Milestone 25A — every staff branch membership, resolved server-side in one
   * read rather than a query per row. */
  branchMemberships: BranchMembership[];
  /** MILESTONE 25C-3 — roles this caller may hand out (rule A2 mirrored
   * server-side; the database re-checks). */
  assignableRoles: UserRole[];
  /** MILESTONE 25C-3 — ACTIVE branches inside this caller's OWN scope. Fed to
   * every "assign someone to a branch" control, so an out-of-scope branch name
   * never reaches the browser. Distinct from `branches` above, which is the
   * administration list and deliberately includes inactive rows. */
  assignableBranches: Branch[];
  /** True when the Supabase read failed — shows an explicit error state
   * instead of silently falling back to any other data source. */
  hasError: boolean;
}

export function UsersSection({
  users,
  grantsByProfileId,
  branchMemberships,
  assignableRoles,
  assignableBranches,
  hasError,
}: UsersSectionProps) {
  const t = useTranslations();
  const router = useRouter();
  // MILESTONE 24 — one gate per operation, replacing the single `user:manage`.
  // Each is independently delegatable to an individual, so a gerente holding
  // only `user:invite` sees the invite and resend controls and nothing else.
  const canInviteUsers = useCapability("user:invite");
  const canSetUserRole = useCapability("user:set_role");
  const canSetUserActive = useCapability("user:set_active");
  // MILESTONE 26B-6B — the same authority that decides who owns a process
  // decides who is fed new ones. Held by administrador and gerente.
  const canAssignAdvisor = useCapability("application:assign_advisor");
  // Administrador only — never delegatable, in TypeScript or in the database.
  const canManagePermissions = useCapability("user:manage_permissions");
  // Milestone 25A — branch scope is a THIRD axis, not a capability. The
  // dialog behind this gate edits memberships (branch:manage) and, separately,
  // scope mode (user:manage_permissions) — delegating the former must never
  // hand out the latter.
  const canManageBranches = useCapability("branch:manage");

  /** MILESTONE 25C-3 — this profile's memberships, from the directory-wide read
   * the page already performed. No query per row, and no second authorization
   * path: these rows were resolved server-side. */
  const membershipsFor = (profileId: string) =>
    branchMemberships.filter((membership) => membership.profileId === profileId);
  /** Whether ANY row-level control is available to this viewer. Drives the
   * actions column header, which should not appear as an empty column. */
  const canUseAnyRowAction =
    canInviteUsers || canSetUserActive || canManagePermissions || canManageBranches;
  const currentProfile = useCurrentProfile();
  const [busyProfileId, setBusyProfileId] = useState<string | null>(null);
  const [permissionsUser, setPermissionsUser] = useState<StaffUser | null>(null);
  const [branchesUser, setBranchesUser] = useState<StaffUser | null>(null);

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

  const handleAutoAssignmentToggle = async (user: StaffUser) => {
    setBusyProfileId(user.id);
    const result = await setStaffAutoAssignmentAction({
      profileId: user.id,
      enabled: !user.autoAssignmentEnabled,
    });
    setBusyProfileId(null);

    if (result.status !== "success") {
      toast.error(t("settings.users.autoAssignment.error"));
      return;
    }

    toast.success(
      t(
        user.autoAssignmentEnabled
          ? "settings.users.autoAssignment.disabled"
          : "settings.users.autoAssignment.enabled",
        { name: user.fullName }
      )
    );
    // Re-read rather than patch: the badge, the button label and the rotation
    // pool all derive from this one flag, and a local guess would disagree with
    // the next load.
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
        {canInviteUsers && (
          <InviteUserDialog
            onInvited={() => router.refresh()}
            assignableRoles={assignableRoles}
            assignableBranches={assignableBranches}
          />
        )}
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
                              {/* MILESTONE 25C-3 — same caller-aware list the
                                  onboarding wizard uses. A gerente never sees
                                  "Administrador" here either; update_staff_role
                                  re-checks A2 regardless. */}
                              {assignableRoles.map((role) => (
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
                          {/* Milestone 25A — national reach is the widest scope
                              anyone can hold, so it is visible at a glance
                              rather than hidden one dialog deep. */}
                          {/* MILESTONE 25C-3 — NATIONAL BY ROLE, not just by
                              declared mode. An administrador holds national
                              reach because of their role and needs no
                              memberships at all; showing them as branchless
                              (which the previous check did, since their stored
                              mode is 'branch') was simply wrong. */}
                          {(user.role === "administrador" ||
                            user.branchScopeMode === "national") && (
                            <StatusBadge
                              label={t("settings.users.scopeSummary.national")}
                              className="border-primary/20 bg-primary/10 text-primary"
                            />
                          )}
                          {/* A non-national employee with no membership cannot
                              reach any operational data. Stated plainly rather
                              than left as a silent blank — an administrator
                              reading this list needs to notice it. */}
                          {/* MILESTONE 26B-6B — being in the automatic lead
                              rotation is a distinct fact from being active, and
                              an administrator has to be able to answer "who is
                              receiving leads right now?" by reading this list.
                              Shown only for advisors, since nobody else can be
                              in an advisor rotation. */}
                          {user.role === "asesor" && user.autoAssignmentEnabled && (
                            <StatusBadge
                              label={t("settings.users.autoAssignment.badge")}
                              className="border-navy/20 bg-navy/10 text-navy"
                            />
                          )}
                          {user.role !== "administrador" &&
                            user.branchScopeMode !== "national" &&
                            membershipsFor(user.id).length === 0 && (
                              <StatusBadge
                                label={t("settings.users.scopeSummary.none")}
                                className="border-border bg-muted text-muted-foreground"
                              />
                            )}
                        </div>
                      </TableCell>
                      {canUseAnyRowAction && (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            {/* MILESTONE 26B-6B — participation in automatic
                                lead distribution. Offered only for advisors
                                (nobody else can be in an advisor rotation) and
                                only to management; `application:assign_advisor`
                                is the same authority that decides who owns a
                                process, and the Server Action re-checks it. */}
                            {canAssignAdvisor && user.role === "asesor" && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={isBusy}
                                onClick={() => handleAutoAssignmentToggle(user)}
                                title={t("settings.users.autoAssignment.hint")}
                              >
                                <Shuffle className="size-3.5" />
                                {user.autoAssignmentEnabled
                                  ? t("settings.users.autoAssignment.disable")
                                  : t("settings.users.autoAssignment.enable")}
                              </Button>
                            )}
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
                              </Button>
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
                            {/* Milestone 25A — B3: never offered on one's own
                                row, because the database refuses every
                                self-modification of branch scope. */}
                            {(canManageBranches || canManagePermissions) && !isSelf && (
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={isBusy}
                                onClick={() => setBranchesUser(user)}
                              >
                                <Building2 className="size-3.5" />
                                {t("settings.branches.scope.trigger")}
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

            {branchesUser && (
              <UserBranchesDialog
                key={branchesUser.id}
                user={branchesUser}
                scopeMode={branchesUser.branchScopeMode}
                memberships={branchMemberships}
                branches={assignableBranches}
                open={branchesUser !== null}
                onOpenChange={(value) => !value && setBranchesUser(null)}
                onChanged={() => router.refresh()}
              />
            )}

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
