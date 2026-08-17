"use client";

import { useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { COMPANIES } from "@/lib/demo-data";
import { createClientAction, updateClientProfileAction } from "@/app/(app)/clientes/actions";
import type { Client, IdentificationType } from "@/types";

/**
 * Milestone 14C — the real-Client-Engine counterpart to
 * src/components/clients/client-form-dialog.tsx. That component stays
 * completely untouched (it is still used by the Dossier's client-edit
 * flow, which remains on the demo Client model until Milestone 14D) —
 * this is a deliberate, separate component rather than a shared/forked
 * one, so touching Dossier is never a risk of changing this file. Same
 * visual layout and field set as the original; the only differences are
 * the underlying field names (identificationType/identificationNumber vs.
 * idType/idNumber, companyLegacyId vs. companyId) and that submission now
 * persists to Supabase via createClientAction/updateClientProfileAction
 * instead of building a purely local object.
 */

interface RealClientFormDialogProps {
  trigger?: ReactNode;
  onSaved: (client: Client) => void;
  initialClient?: Client;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const EMPTY_FORM = {
  fullName: "",
  identificationType: "cedula" as IdentificationType,
  identificationNumber: "",
  phone: "",
  email: "",
  // MILESTONE 18: deliberately EMPTY, not COMPANIES[0]. This field used
  // to default to the first entry in the static company list, so every
  // client created through the CRM was silently persisted as an employee
  // of Grupo Kativo unless the operator noticed and changed it — the CRM
  // was writing fabricated employer data, not merely displaying it.
  // Employer is optional at both the schema level (clients.company_legacy_id
  // is nullable) and the service level (CreateClientInput.companyLegacyId
  // is optional, mapped `?? null`), so an untouched field now persists
  // NULL, which is the honest value for "we did not ask".
  companyLegacyId: "",
  position: "",
  monthlySalary: "",
  birthDate: "",
  nationality: "Panameña",
  address: "",
  observations: "",
};

export function RealClientFormDialog({
  trigger,
  onSaved,
  initialClient,
  open: controlledOpen,
  onOpenChange,
}: RealClientFormDialogProps) {
  const t = useTranslations();
  const [internalOpen, setInternalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = (value: boolean) => {
    if (onOpenChange) onOpenChange(value);
    if (!isControlled) setInternalOpen(value);
  };
  const [form, setForm] = useState(() =>
    initialClient
      ? {
          fullName: initialClient.fullName,
          identificationType: initialClient.identificationType,
          identificationNumber: initialClient.identificationNumber,
          phone: initialClient.phone,
          email: initialClient.email,
          companyLegacyId: initialClient.companyLegacyId ?? "",
          position: initialClient.position,
          monthlySalary: String(initialClient.monthlySalary),
          birthDate: initialClient.birthDate,
          nationality: initialClient.nationality,
          address: initialClient.address,
          observations: initialClient.observations ?? "",
        }
      : EMPTY_FORM
  );

  const update = (field: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);

    const profileFields = {
      fullName: form.fullName,
      identificationType: form.identificationType as IdentificationType,
      identificationNumber: form.identificationNumber,
      phone: form.phone,
      email: form.email,
      companyLegacyId: form.companyLegacyId || undefined,
      position: form.position,
      monthlySalary: Number(form.monthlySalary) || 0,
      birthDate: form.birthDate,
      nationality: form.nationality,
      address: form.address,
      observations: form.observations || undefined,
    };

    const result = initialClient
      ? await updateClientProfileAction({ clientId: initialClient.id, ...profileFields })
      : await createClientAction(profileFields);

    setIsSubmitting(false);

    if (result.status !== "success") {
      if (result.code === "DUPLICATE_IDENTIFICATION") {
        toast.error(t("clients.toasts.duplicateIdentification"));
      } else {
        toast.error(t(initialClient ? "clients.toasts.updateError" : "clients.toasts.createError"));
      }
      return;
    }

    onSaved(result.client);
    toast.success(
      initialClient ? t("clients.toasts.clientUpdated") : t("clients.toasts.clientCreated")
    );
    setOpen(false);
    if (!initialClient) setForm(EMPTY_FORM);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger render={trigger as ReactElement} />}
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {initialClient ? t("clients.form.titleEdit") : t("clients.form.titleNew")}
          </DialogTitle>
          <DialogDescription>
            {initialClient
              ? t("clients.form.descriptionEdit")
              : t("clients.form.descriptionNew")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="fullName">{t("clients.form.fullName")}</Label>
              <Input
                id="fullName"
                required
                value={form.fullName}
                onChange={(e) => update("fullName", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="identificationType">{t("clients.form.idType")}</Label>
              <Select
                value={form.identificationType}
                onValueChange={(value) => value && update("identificationType", value)}
              >
                <SelectTrigger id="identificationType" className="w-full">
                  <SelectValue>
                    {(value: string) =>
                      value === "cedula"
                        ? t("clients.form.idTypeCedula")
                        : t("clients.form.idTypePassport")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cedula">{t("clients.form.idTypeCedula")}</SelectItem>
                  <SelectItem value="pasaporte">{t("clients.form.idTypePassport")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="identificationNumber">{t("clients.form.idNumber")}</Label>
              <Input
                id="identificationNumber"
                required
                value={form.identificationNumber}
                onChange={(e) => update("identificationNumber", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="phone">{t("clients.form.phone")}</Label>
              <Input
                id="phone"
                required
                value={form.phone}
                onChange={(e) => update("phone", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">{t("clients.form.email")}</Label>
              <Input
                id="email"
                type="email"
                required
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="companyLegacyId">{t("clients.form.company")}</Label>
              <Select
                value={form.companyLegacyId}
                onValueChange={(value) => value && update("companyLegacyId", value)}
              >
                <SelectTrigger id="companyLegacyId" className="w-full">
                  <SelectValue>
                    {(value: string) =>
                      COMPANIES.find((company) => company.id === value)?.name ??
                      t("clients.form.selectCompany")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {COMPANIES.map((company) => (
                    <SelectItem key={company.id} value={company.id}>
                      {company.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="position">{t("clients.form.position")}</Label>
              <Input
                id="position"
                required
                value={form.position}
                onChange={(e) => update("position", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="monthlySalary">{t("clients.form.monthlySalary")}</Label>
              <Input
                id="monthlySalary"
                type="number"
                min="0"
                required
                value={form.monthlySalary}
                onChange={(e) => update("monthlySalary", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="birthDate">{t("clients.form.birthDate")}</Label>
              <Input
                id="birthDate"
                type="date"
                required
                value={form.birthDate}
                onChange={(e) => update("birthDate", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="nationality">{t("clients.form.nationality")}</Label>
              <Input
                id="nationality"
                required
                value={form.nationality}
                onChange={(e) => update("nationality", e.target.value)}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="address">{t("clients.form.address")}</Label>
              <Input
                id="address"
                required
                value={form.address}
                onChange={(e) => update("address", e.target.value)}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="observations">{t("clients.form.observations")}</Label>
              <Textarea
                id="observations"
                rows={3}
                value={form.observations}
                onChange={(e) => update("observations", e.target.value)}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isSubmitting}>
              {t("clients.form.cancel")}
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {initialClient ? t("clients.form.submitEdit") : t("clients.form.submitNew")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
