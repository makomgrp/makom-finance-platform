"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertTriangle, Building2, Pencil, Plus, Power, RotateCcw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { BranchFormDialog } from "@/components/settings/branch-form-dialog";
import { setBranchActiveAction } from "@/app/(app)/configuracion/actions";
import { useCapability } from "@/lib/auth/use-capability";
import type { Branch } from "@/types";

/**
 * Configuración → Sucursales (Milestone 25A).
 *
 * TWO CAPABILITIES, NOT ONE. Creating a branch defines ODL's organizational
 * structure and is administrador-only (`branch:create`, non-delegatable);
 * editing and activating existing branches is `branch:manage`, which an
 * administrador may delegate to a gerente so day-to-day operations continue
 * while Damion travels.
 *
 * THE EMPTY STATE IS THE COMMON CASE TODAY, and it is deliberately truthful.
 * No branch exists until ODL supplies its real list, and this screen does NOT
 * invent plausible Panama locations to look populated — the whole point of
 * Milestones 18 and 22 was removing fabricated data, not adding new kinds.
 *
 * NO DELETE. Branches are permanent foreign-key targets on historical clients
 * and applications; deactivation is the only removal this product has.
 */

interface BranchesSectionProps {
  branches: Branch[];
  /** Staff count per branch id, resolved server-side. */
  staffCountByBranchId: Record<string, number>;
  /** True when the read failed — an explicit error state, never an empty list
   * that would read as "no branches configured". */
  hasError: boolean;
}

export function BranchesSection({
  branches,
  staffCountByBranchId,
  hasError,
}: BranchesSectionProps) {
  const t = useTranslations();
  const router = useRouter();
  const canCreateBranch = useCapability("branch:create");
  const canManageBranches = useCapability("branch:manage");
  const [editingBranch, setEditingBranch] = useState<Branch | null>(null);
  const [busyBranchId, setBusyBranchId] = useState<string | null>(null);

  const handleActiveToggle = async (branch: Branch) => {
    setBusyBranchId(branch.id);
    const result = await setBranchActiveAction(branch.id, !branch.active);
    setBusyBranchId(null);

    if (result.status !== "success") {
      toast.error(
        t(
          result.code === "FORBIDDEN"
            ? "settings.branches.toasts.forbidden"
            : "settings.branches.toasts.error"
        )
      );
      return;
    }

    toast.success(
      branch.active
        ? t("settings.branches.toasts.deactivated", { name: branch.name })
        : t("settings.branches.toasts.reactivated", { name: branch.name })
    );
    router.refresh();
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>{t("settings.branches.title")}</CardTitle>
        {canCreateBranch && (
          <BranchFormDialog
            onSaved={() => router.refresh()}
            trigger={
              <Button size="sm" variant="outline">
                <Plus className="size-4" />
                {t("settings.branches.create")}
              </Button>
            }
          />
        )}
      </CardHeader>
      <CardContent>
        {hasError ? (
          <EmptyState
            icon={AlertTriangle}
            title={t("settings.branches.loadErrorTitle")}
            description={t("settings.branches.loadErrorDescription")}
          />
        ) : branches.length === 0 ? (
          /* Truthful empty state. No demo branches, ever. */
          <EmptyState
            icon={Building2}
            title={t("settings.branches.emptyTitle")}
            description={t("settings.branches.emptyDescription")}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("settings.branches.columns.code")}</TableHead>
                  <TableHead>{t("settings.branches.columns.name")}</TableHead>
                  <TableHead>{t("settings.branches.columns.province")}</TableHead>
                  <TableHead>{t("settings.branches.columns.city")}</TableHead>
                  <TableHead>{t("settings.branches.columns.status")}</TableHead>
                  <TableHead className="text-center">
                    {t("settings.branches.columns.staff")}
                  </TableHead>
                  {canManageBranches && (
                    <TableHead className="text-right">{t("common.actions")}</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {branches.map((branch) => {
                  const isBusy = busyBranchId === branch.id;

                  return (
                    <TableRow key={branch.id}>
                      <TableCell className="font-medium text-foreground">{branch.code}</TableCell>
                      <TableCell className="text-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          {branch.name}
                          {branch.isHeadquarters && (
                            <StatusBadge
                              label={t("settings.branches.headquarters")}
                              className="border-border bg-muted text-muted-foreground"
                            />
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{branch.province}</TableCell>
                      <TableCell className="text-muted-foreground">{branch.city ?? "—"}</TableCell>
                      <TableCell>
                        <StatusBadge
                          label={
                            branch.active
                              ? t("settings.branches.active")
                              : t("settings.branches.inactive")
                          }
                          className={
                            branch.active
                              ? "bg-success/10 text-success border-success/20"
                              : "bg-muted text-muted-foreground border-border"
                          }
                        />
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground">
                        {staffCountByBranchId[branch.id] ?? 0}
                      </TableCell>
                      {canManageBranches && (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isBusy}
                              onClick={() => setEditingBranch(branch)}
                            >
                              <Pencil className="size-3.5" />
                              {t("common.edit")}
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isBusy}
                              onClick={() => handleActiveToggle(branch)}
                            >
                              {branch.active ? (
                                <>
                                  <Power className="size-3.5" />
                                  {t("settings.branches.deactivate")}
                                </>
                              ) : (
                                <>
                                  <RotateCcw className="size-3.5" />
                                  {t("settings.branches.reactivate")}
                                </>
                              )}
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}

        {editingBranch && (
          <BranchFormDialog
            key={editingBranch.id}
            branch={editingBranch}
            open={editingBranch !== null}
            onOpenChange={(value) => !value && setEditingBranch(null)}
            onSaved={() => {
              setEditingBranch(null);
              router.refresh();
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}
