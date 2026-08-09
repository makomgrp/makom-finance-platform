"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { Package, Plus, Pencil, ArrowUp, ArrowDown, Power, RotateCcw, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import {
  REQUIREMENT_KIND_ORDER,
  REQUIREMENT_STATUS_BADGE_CLASS,
  REQUIREMENT_STATUS_TRANSITIONS,
} from "@/lib/config/requirement";
import {
  createRequirementTemplate,
  updateRequirementTemplate,
  setRequirementTemplateStatus,
  moveRequirementTemplate,
} from "@/app/(app)/configuracion/actions";
import type { Locale } from "@/i18n/config";
import type { LocalizedText, RequirementKind, RequirementTemplate } from "@/types";

interface RequirementsSectionProps {
  productId: string;
  requirementTemplates: RequirementTemplate[];
  hasError: boolean;
}

interface FormState {
  code: string;
  requirementKind: RequirementKind;
  nameEs: string;
  nameEn: string;
  descriptionEs: string;
  descriptionEn: string;
  required: boolean;
}

const EMPTY_FORM: FormState = {
  code: "",
  requirementKind: "document",
  nameEs: "",
  nameEn: "",
  descriptionEs: "",
  descriptionEn: "",
  required: true,
};

function requirementToForm(requirement: RequirementTemplate): FormState {
  return {
    code: requirement.code,
    requirementKind: requirement.requirementKind,
    nameEs: requirement.name.es,
    nameEn: requirement.name.en,
    descriptionEs: requirement.description?.es ?? "",
    descriptionEn: requirement.description?.en ?? "",
    required: requirement.required,
  };
}

export function RequirementsSection({ productId, requirementTemplates: initial, hasError }: RequirementsSectionProps) {
  const locale = useLocale() as Locale;
  const t = useTranslations();
  const [requirements, setRequirements] = useState<RequirementTemplate[]>(initial);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingRequirement, setEditingRequirement] = useState<RequirementTemplate | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const openCreateDialog = () => {
    setEditingRequirement(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEditDialog = (requirement: RequirementTemplate) => {
    setEditingRequirement(requirement);
    setForm(requirementToForm(requirement));
    setDialogOpen(true);
  };

  const buildNameAndDescription = (): { name: LocalizedText; description: LocalizedText } | null => {
    const nameEs = form.nameEs.trim();
    const nameEn = form.nameEn.trim();
    if (!nameEs || !nameEn) return null;

    const descriptionEs = form.descriptionEs.trim();
    const descriptionEn = form.descriptionEn.trim();
    if (!descriptionEs || !descriptionEn) return null;

    return {
      name: { es: nameEs, en: nameEn },
      description: { es: descriptionEs, en: descriptionEn },
    };
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const details = buildNameAndDescription();
    if (!details) {
      toast.error(t("settings.productDetail.requirements.toasts.invalidForm"));
      return;
    }

    setSubmitting(true);

    if (editingRequirement) {
      const result = await updateRequirementTemplate({
        requirementTemplateId: editingRequirement.id,
        name: details.name,
        description: details.description,
        required: form.required,
      });
      setSubmitting(false);

      if (result.status !== "success") {
        toast.error(t("settings.productDetail.requirements.toasts.updateError"));
        return;
      }

      setRequirements((current) =>
        current.map((r) => (r.id === result.requirementTemplate.id ? result.requirementTemplate : r))
      );
      toast.success(
        t("settings.productDetail.requirements.toasts.updated", { name: result.requirementTemplate.name[locale] })
      );
      setDialogOpen(false);
      return;
    }

    const code = form.code.trim();
    if (!/^[a-z][a-z0-9_]{1,59}$/.test(code)) {
      setSubmitting(false);
      toast.error(t("settings.productDetail.requirements.toasts.invalidCode"));
      return;
    }

    const result = await createRequirementTemplate({
      productId,
      code,
      name: details.name,
      description: details.description,
      requirementKind: form.requirementKind,
      required: form.required,
    });
    setSubmitting(false);

    if (result.status !== "success") {
      toast.error(
        result.status === "error" && result.code === "DUPLICATE_CODE"
          ? t("settings.productDetail.requirements.toasts.duplicateCode")
          : t("settings.productDetail.requirements.toasts.createError")
      );
      return;
    }

    setRequirements((current) =>
      [...current, result.requirementTemplate].sort((a, b) => a.displayOrder - b.displayOrder)
    );
    toast.success(
      t("settings.productDetail.requirements.toasts.created", { name: result.requirementTemplate.name[locale] })
    );
    setDialogOpen(false);
  };

  const handleStatusChange = async (requirement: RequirementTemplate, targetStatus: RequirementTemplate["status"]) => {
    setBusyId(requirement.id);
    const result = await setRequirementTemplateStatus({ requirementTemplateId: requirement.id, status: targetStatus });
    setBusyId(null);

    if (result.status !== "success") {
      toast.error(t("settings.productDetail.requirements.toasts.statusChangeError"));
      return;
    }

    setRequirements((current) =>
      current.map((r) => (r.id === result.requirementTemplate.id ? result.requirementTemplate : r))
    );
    toast.success(
      t("settings.productDetail.requirements.toasts.statusUpdated", {
        name: result.requirementTemplate.name[locale],
        status: t(`statuses.requirementStatus.${targetStatus}`),
      })
    );
  };

  const handleMove = async (requirement: RequirementTemplate, direction: "up" | "down") => {
    setBusyId(requirement.id);
    const result = await moveRequirementTemplate({ requirementTemplateId: requirement.id, direction });
    setBusyId(null);

    if (result.status !== "success") {
      toast.error(t("settings.productDetail.requirements.toasts.reorderError"));
      return;
    }

    setRequirements(result.requirementTemplates);
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>{t("settings.productDetail.requirements.title")}</CardTitle>
          <p className="mt-1 text-sm text-muted-foreground">{t("settings.productDetail.requirements.description")}</p>
        </div>
        <Dialog
          open={dialogOpen}
          onOpenChange={(open) => {
            setDialogOpen(open);
            if (!open) {
              setEditingRequirement(null);
              setForm(EMPTY_FORM);
            }
          }}
        >
          <DialogTrigger
            render={
              <Button size="sm" onClick={openCreateDialog}>
                <Plus className="size-4" />
                {t("settings.productDetail.requirements.newRequirement")}
              </Button>
            }
          />
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>
                {editingRequirement
                  ? t("settings.productDetail.requirements.editDialogTitle")
                  : t("settings.productDetail.requirements.createDialogTitle")}
              </DialogTitle>
              <DialogDescription>{t("settings.productDetail.requirements.dialogDescription")}</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="requirement-code">{t("settings.productDetail.requirements.code")}</Label>
                  <Input
                    id="requirement-code"
                    required
                    disabled={!!editingRequirement}
                    placeholder="salary_letter"
                    value={form.code}
                    onChange={(event) => setForm((f) => ({ ...f, code: event.target.value }))}
                  />
                  {!editingRequirement && (
                    <p className="text-xs text-muted-foreground">
                      {t("settings.productDetail.requirements.codeHint")}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="requirement-kind">{t("settings.productDetail.requirements.kind")}</Label>
                  <Select
                    value={form.requirementKind}
                    onValueChange={(value) =>
                      value && !editingRequirement && setForm((f) => ({ ...f, requirementKind: value as RequirementKind }))
                    }
                  >
                    <SelectTrigger id="requirement-kind" className="w-full" disabled={!!editingRequirement}>
                      <SelectValue>
                        {(value: string) => t(`statuses.requirementKind.${value as RequirementKind}`)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {REQUIREMENT_KIND_ORDER.map((kind) => (
                        <SelectItem key={kind} value={kind}>
                          {t(`statuses.requirementKind.${kind}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="requirement-name-es">{t("settings.productDetail.requirements.nameEs")}</Label>
                  <Input
                    id="requirement-name-es"
                    required
                    value={form.nameEs}
                    onChange={(event) => setForm((f) => ({ ...f, nameEs: event.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="requirement-name-en">{t("settings.productDetail.requirements.nameEn")}</Label>
                  <Input
                    id="requirement-name-en"
                    required
                    value={form.nameEn}
                    onChange={(event) => setForm((f) => ({ ...f, nameEn: event.target.value }))}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="requirement-description-es">
                    {t("settings.productDetail.requirements.descriptionEs")}
                  </Label>
                  <Textarea
                    id="requirement-description-es"
                    required
                    rows={2}
                    value={form.descriptionEs}
                    onChange={(event) => setForm((f) => ({ ...f, descriptionEs: event.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="requirement-description-en">
                    {t("settings.productDetail.requirements.descriptionEn")}
                  </Label>
                  <Textarea
                    id="requirement-description-en"
                    required
                    rows={2}
                    value={form.descriptionEn}
                    onChange={(event) => setForm((f) => ({ ...f, descriptionEn: event.target.value }))}
                  />
                </div>
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
                <Label htmlFor="requirement-required">{t("settings.productDetail.requirements.required")}</Label>
                <Switch
                  id="requirement-required"
                  checked={form.required}
                  onCheckedChange={(checked) => setForm((f) => ({ ...f, required: checked === true }))}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  {t("settings.productDetail.requirements.cancel")}
                </Button>
                <Button type="submit" disabled={submitting}>
                  {editingRequirement
                    ? t("settings.productDetail.requirements.saveChanges")
                    : t("settings.productDetail.requirements.createRequirement")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {hasError ? (
          <EmptyState
            icon={AlertTriangle}
            title={t("settings.productDetail.requirements.loadErrorTitle")}
            description={t("settings.productDetail.requirements.loadErrorDescription")}
          />
        ) : requirements.length === 0 ? (
          <EmptyState
            icon={Package}
            title={t("settings.productDetail.requirements.emptyTitle")}
            description={t("settings.productDetail.requirements.emptyDescription")}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("settings.productDetail.requirements.columns.code")}</TableHead>
                  <TableHead>{t("settings.productDetail.requirements.columns.name")}</TableHead>
                  <TableHead>{t("settings.productDetail.requirements.columns.kind")}</TableHead>
                  <TableHead>{t("settings.productDetail.requirements.columns.required")}</TableHead>
                  <TableHead>{t("settings.productDetail.requirements.columns.status")}</TableHead>
                  <TableHead>{t("settings.productDetail.requirements.columns.order")}</TableHead>
                  <TableHead className="text-right">
                    {t("settings.productDetail.requirements.columns.actions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {requirements.map((requirement, index) => {
                  const isBusy = busyId === requirement.id;
                  const nextStatus = REQUIREMENT_STATUS_TRANSITIONS[requirement.status][0];

                  return (
                    <TableRow key={requirement.id}>
                      <TableCell className="font-mono text-xs text-muted-foreground">{requirement.code}</TableCell>
                      <TableCell className="font-medium text-foreground">{requirement.name[locale]}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {t(`statuses.requirementKind.${requirement.requirementKind}`)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {requirement.required
                          ? t("settings.productDetail.requirements.requiredYes")
                          : t("settings.productDetail.requirements.requiredNo")}
                      </TableCell>
                      <TableCell>
                        <StatusBadge
                          label={t(`statuses.requirementStatus.${requirement.status}`)}
                          className={REQUIREMENT_STATUS_BADGE_CLASS[requirement.status]}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={isBusy || index === 0}
                            onClick={() => handleMove(requirement, "up")}
                          >
                            <ArrowUp className="size-3.5" />
                            <span className="sr-only">{t("settings.productDetail.requirements.moveUp")}</span>
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={isBusy || index === requirements.length - 1}
                            onClick={() => handleMove(requirement, "down")}
                          >
                            <ArrowDown className="size-3.5" />
                            <span className="sr-only">{t("settings.productDetail.requirements.moveDown")}</span>
                          </Button>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isBusy}
                            onClick={() => openEditDialog(requirement)}
                          >
                            <Pencil className="size-3.5" />
                            {t("settings.productDetail.requirements.edit")}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={isBusy}
                            onClick={() => handleStatusChange(requirement, nextStatus)}
                          >
                            {nextStatus === "active" ? (
                              <>
                                {requirement.status === "inactive" ? (
                                  <RotateCcw className="size-3.5" />
                                ) : (
                                  <Power className="size-3.5" />
                                )}
                                {requirement.status === "inactive"
                                  ? t("settings.productDetail.requirements.reactivate")
                                  : t("settings.productDetail.requirements.activate")}
                              </>
                            ) : (
                              <>
                                <Power className="size-3.5" />
                                {t("settings.productDetail.requirements.deactivate")}
                              </>
                            )}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
