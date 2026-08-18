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
import { inviteStaffUser, assignProfileBranchAction } from "@/app/(app)/configuracion/actions";
import { LANGUAGE_CONFIG, SUPPORTED_LANGUAGE_VALUES } from "@/lib/config/language";
import { Checkbox } from "@/components/ui/checkbox";
import type { Branch, SupportedLanguage, UserRole } from "@/types";

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
  /** MILESTONE 25C-3 — roles this caller may actually hand out, resolved
   * SERVER-SIDE (rule A2 mirrored; the database re-checks it). A gerente never
   * sees "Administrador", because offering an option that always fails teaches
   * people that errors are normal. */
  assignableRoles: UserRole[];
  /** MILESTONE 25C-3 — ACTIVE branches inside this caller's own scope, resolved
   * server-side. A branch they cannot reach is never in this list, so its NAME
   * never reaches the browser. Empty is a legitimate state (no branches exist
   * yet, or the caller has none) and the step says so. */
  assignableBranches: Branch[];
}

const EMPTY_FORM = {
  email: "",
  fullName: "",
  role: "asesor" as UserRole,
  preferredLanguage: "es" as SupportedLanguage,
};

/** Steps: details -> role -> branches -> review. Permissions are deliberately
 * NOT a step — see the component header. */
const TOTAL_STEPS = 4;

/**
 * What still needs doing after a partial run. `profileId` is the anchor: once a
 * profile exists it is NEVER created again, which is what makes every retry
 * below safe to press twice.
 */
interface PendingWork {
  profileId: string;
  email: string;
  invitationPending: boolean;
  branchIdsPending: string[];
  primaryBranchId: string | null;
}

export function InviteUserDialog({
  onInvited,
  assignableRoles,
  assignableBranches,
}: InviteUserDialogProps) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [step, setStep] = useState(1);
  const [selectedBranchIds, setSelectedBranchIds] = useState<string[]>([]);
  const [primaryBranchId, setPrimaryBranchId] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingWork | null>(null);

  const update = <K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const close = () => {
    setOpen(false);
    setForm(EMPTY_FORM);
    setError(null);
    setStep(1);
    setSelectedBranchIds([]);
    setPrimaryBranchId(null);
    setPending(null);
  };

  /**
   * PRIMARY BRANCH CAN NEVER SIT OUTSIDE THE SELECTED MEMBERSHIPS.
   *
   * Toggling a branch off that happened to be primary clears the primary too,
   * and selecting the first branch makes it primary automatically — a single
   * choice should not force a second, identical one. The database enforces the
   * same relationship independently (assign_profile_branch owns the at-most-one
   * primary invariant); this only keeps the form from ever ASKING for an
   * impossible combination.
   */
  const toggleBranch = (branchId: string) => {
    setSelectedBranchIds((prev) => {
      const next = prev.includes(branchId)
        ? prev.filter((id) => id !== branchId)
        : [...prev, branchId];
      setPrimaryBranchId((current) => {
        if (next.length === 0) return null;
        if (current && next.includes(current)) return current;
        return next[0];
      });
      return next;
    });
  };

  /**
   * Assigns the selected branches, returning the ones that did NOT land.
   *
   * Each membership is its own call because each is its own secure operation —
   * assign_profile_branch enforces B1-B6 per branch. There is deliberately no
   * bulk RPC: inventing one purely so the UI could claim atomicity would
   * replace real per-branch authorization with a single weaker check.
   */
  const assignBranches = async (profileId: string, branchIds: string[], primaryId: string | null) => {
    const failed: string[] = [];
    for (const branchId of branchIds) {
      const result = await assignProfileBranchAction(profileId, branchId, branchId === primaryId);
      if (result.status !== "success") failed.push(branchId);
    }
    return failed;
  };

  /** Advances one step, validating only what THIS step owns. The Server Action
   * re-validates everything on submit and remains the enforcement. */
  const goNext = () => {
    if (step === 1) {
      if (!form.fullName.trim()) {
        setError(t("settings.users.invite.validation.fullName"));
        return;
      }
      if (!form.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
        setError(t("settings.users.invite.validation.email"));
        return;
      }
    }
    setError(null);
    setStep((current) => Math.min(current + 1, TOTAL_STEPS));
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

    // ========================================================================
    // THE PROFILE NOW EXISTS. EVERYTHING BELOW IS RECOVERABLE.
    // ========================================================================
    //
    // Supabase Auth and Postgres cannot share a transaction, so this flow is
    // staged rather than atomic — and it reports that honestly instead of
    // pretending. From here on the profile id is the anchor: it is never
    // created twice, so any retry is safe to press repeatedly.
    //
    // Nothing is ever rolled back as compensation: no Auth account is deleted,
    // no profile is hard-deleted. An employee who exists but is missing a
    // branch is a fixable state; an employee who was silently destroyed to
    // tidy up a half-failure is not.
    const profileId = result.profileId;
    const invitationPending = result.status === "pending_invitation";

    setIsSubmitting(true);
    const failedBranches = await assignBranches(profileId, selectedBranchIds, primaryBranchId);
    setIsSubmitting(false);

    if (invitationPending || failedBranches.length > 0) {
      // PARTIAL. Never reported as plain success — the administrator is told
      // exactly what remains and given a retry for it.
      setPending({
        profileId,
        email: form.email.trim(),
        invitationPending,
        branchIdsPending: failedBranches,
        primaryBranchId,
      });
      onInvited();
      return;
    }

    toast.success(t("settings.users.invite.toasts.invited", { email: form.email.trim() }));
    close();
    onInvited();
  };

  /** Retries ONLY the branches that failed. The profile and any successful
   * memberships are left exactly as they are. */
  const retryBranches = async () => {
    if (!pending || isSubmitting) return;
    setIsSubmitting(true);
    const stillFailed = await assignBranches(
      pending.profileId,
      pending.branchIdsPending,
      pending.primaryBranchId
    );
    setIsSubmitting(false);
    setPending({ ...pending, branchIdsPending: stillFailed });
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
          <DialogTitle>{t("settings.users.onboarding.title")}</DialogTitle>
          <DialogDescription>
            {pending
              ? t("settings.users.onboarding.partialTitle")
              : t("settings.users.onboarding.stepOf", { current: step, total: TOTAL_STEPS })}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* ================= PARTIAL-RESULT PANEL =================
              Shown INSTEAD of the steps once a profile exists but work
              remains. It never offers "create" again — the profile is already
              there, and re-running creation is exactly the duplicate this
              flow must not produce. */}
          {pending ? (
            <div className="space-y-3">
              <p className="text-sm text-foreground">
                {t("settings.users.onboarding.profileCreated")}: {pending.email}
              </p>
              {pending.invitationPending && (
                <p className="text-sm text-warning">
                  {t("settings.users.onboarding.invitationPending")}
                </p>
              )}
              {pending.branchIdsPending.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm text-warning">
                    {t("settings.users.onboarding.branchesPending", {
                      count: pending.branchIdsPending.length,
                    })}
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={retryBranches}
                    disabled={isSubmitting}
                  >
                    {t("settings.users.onboarding.retryBranches")}
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                {t("settings.users.onboarding.permissionsHint")}
              </p>
            </div>
          ) : null}

          {!pending && step === 1 && (
          <>
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

          </>
          )}

          {!pending && step === 2 && (
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
                  {assignableRoles.map((role) => (
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
          )}

          {/* ================= STEP 3 — SUCURSALES =================
              Only branches this caller may actually assign into appear here;
              the list arrives already scope-filtered from the server, so an
              out-of-scope branch NAME never reaches the browser. An empty list
              is a truthful state, not an error. */}
          {!pending && step === 3 && (
            <div className="space-y-3">
              {assignableBranches.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("settings.users.onboarding.noAssignableBranches")}
                </p>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    {t("settings.users.onboarding.selectBranches")}
                  </p>
                  <div className="space-y-2">
                    {assignableBranches.map((branch) => (
                      <label
                        key={branch.id}
                        className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
                      >
                        <Checkbox
                          checked={selectedBranchIds.includes(branch.id)}
                          onCheckedChange={() => toggleBranch(branch.id)}
                          disabled={isSubmitting}
                        />
                        <span className="flex-1 truncate text-sm">{branch.name}</span>
                        {selectedBranchIds.includes(branch.id) && selectedBranchIds.length > 1 && (
                          <Button
                            type="button"
                            variant={primaryBranchId === branch.id ? "default" : "ghost"}
                            size="sm"
                            onClick={() => setPrimaryBranchId(branch.id)}
                            disabled={isSubmitting}
                          >
                            {t("settings.users.onboarding.primaryBranch")}
                          </Button>
                        )}
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* ================= STEP 4 — REVISIÓN ================= */}
          {!pending && step === 4 && (
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">
                  {t("settings.users.onboarding.reviewEmployee")}
                </dt>
                <dd className="truncate text-right">{form.fullName || form.email}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">
                  {t("settings.users.onboarding.reviewRole")}
                </dt>
                <dd>{t(`roles.${form.role}`)}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">
                  {t("settings.users.onboarding.reviewBranches")}
                </dt>
                <dd className="text-right">
                  {selectedBranchIds.length === 0
                    ? t("settings.users.onboarding.reviewNoBranches")
                    : assignableBranches
                        .filter((branch) => selectedBranchIds.includes(branch.id))
                        .map((branch) => branch.name)
                        .join(", ")}
                </dd>
              </div>
              {primaryBranchId && (
                <div className="flex justify-between gap-4">
                  <dt className="text-muted-foreground">
                    {t("settings.users.onboarding.reviewPrimary")}
                  </dt>
                  <dd>
                    {assignableBranches.find((branch) => branch.id === primaryBranchId)?.name ?? ""}
                  </dd>
                </div>
              )}
              <p className="pt-2 text-xs text-muted-foreground">
                {t("settings.users.invite.note")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("settings.users.onboarding.permissionsHint")}
              </p>
            </dl>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            {pending ? (
              // The work that succeeded is already saved; this only closes the
              // panel. Nothing is undone.
              <Button type="button" onClick={close} disabled={isSubmitting}>
                {t("settings.users.onboarding.done")}
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={close} disabled={isSubmitting}>
                  {t("settings.users.invite.cancel")}
                </Button>
                {step > 1 && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setStep((current) => current - 1)}
                    disabled={isSubmitting}
                  >
                    {t("settings.users.onboarding.back")}
                  </Button>
                )}
                {step < TOTAL_STEPS ? (
                  // TYPE="BUTTON", deliberately: a submit button here would let
                  // Enter on step 1 create the employee before the operator has
                  // seen the role or branch steps.
                  <Button type="button" onClick={goNext} disabled={isSubmitting}>
                    {t("settings.users.onboarding.next")}
                  </Button>
                ) : (
                  <Button type="submit" disabled={isSubmitting}>
                    {isSubmitting
                      ? t("settings.users.invite.submitting")
                      : t("settings.users.onboarding.finish")}
                  </Button>
                )}
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
