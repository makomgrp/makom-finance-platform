"use client";

import { useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RequiredFieldsNote, RequiredMark } from "@/components/shared/required-mark";
import { PRIMARY_SOCIAL_NETWORKS } from "@/types";
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
  // MILESTONE 23: free text, replacing the closed list of 10 fabricated
  // companies. Milestone 18 had already stopped this defaulting to
  // COMPANIES[0] (which silently persisted every new client as an employee
  // of Grupo Kativo), but an empty dropdown over fictitious employers is
  // still unusable for real intake: ODL's actual employers are not a known
  // closed set. Empty stays valid and persists NULL — the honest value for
  // "we did not ask".
  employerName: "",
  position: "",
  monthlySalary: "",
  birthDate: "",
  nationality: "Panameña",
  address: "",
  observations: "",
  primarySocialNetwork: "",
  primarySocialNetworkOther: "",
};

export function RealClientFormDialog({
  trigger,
  onSaved,
  initialClient,
  open: controlledOpen,
  onOpenChange,
}: RealClientFormDialogProps) {
  const t = useTranslations();
  const tSocial = useTranslations("socialNetworks");
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
          employerName: initialClient.employerName ?? "",
          // MILESTONE 26B-2A — these five may legitimately be missing on a
          // client who came through the public portal, so they prefill as
          // EMPTY INPUTS for staff to complete.
          //
          // `?? ""` on the salary rather than String(...): String(undefined)
          // produces the literal text "undefined", which would sit in the
          // field looking like a value and then be saved as NaN.
          position: initialClient.position ?? "",
          monthlySalary:
            initialClient.monthlySalary === undefined ? "" : String(initialClient.monthlySalary),
          birthDate: initialClient.birthDate ?? "",
          nationality: initialClient.nationality ?? "",
          address: initialClient.address ?? "",
          observations: initialClient.observations ?? "",
          primarySocialNetwork: initialClient.primarySocialNetwork ?? "",
          primarySocialNetworkOther: initialClient.primarySocialNetworkOther ?? "",
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
      employerName: form.employerName.trim() || undefined,
      // LEGACY PASS-THROUGH, never edited. record_client_profile_update writes
      // every column it is handed, so a fixture client's existing company code
      // must be returned unchanged or the save would erase the only value that
      // still renders its employer. Undefined for every client created since
      // Milestone 23, which is exactly right — they never had one.
      companyLegacyId: initialClient?.companyLegacyId,
      position: form.position,
      monthlySalary: Number(form.monthlySalary) || 0,
      birthDate: form.birthDate,
      nationality: form.nationality,
      address: form.address,
      observations: form.observations || undefined,
      primarySocialNetwork: form.primarySocialNetwork || undefined,
      primarySocialNetworkOther: form.primarySocialNetworkOther || undefined,
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
              <Label htmlFor="fullName">{t("clients.form.fullName")}<RequiredMark /></Label>
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
              <Label htmlFor="identificationNumber">{t("clients.form.idNumber")}<RequiredMark /></Label>
              <Input
                id="identificationNumber"
                required
                value={form.identificationNumber}
                onChange={(e) => update("identificationNumber", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="phone">{t("clients.form.phone")}<RequiredMark /></Label>
              <Input
                id="phone"
                required
                value={form.phone}
                onChange={(e) => update("phone", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email">{t("clients.form.email")}<RequiredMark /></Label>
              <Input
                id="email"
                type="email"
                required
                value={form.email}
                onChange={(e) => update("email", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="employerName">{t("clients.form.employer")}</Label>
              <Input
                id="employerName"
                value={form.employerName}
                placeholder={t("clients.form.employerPlaceholder")}
                onChange={(e) => update("employerName", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="position">{t("clients.form.position")}<RequiredMark /></Label>
              <Input
                id="position"
                required
                value={form.position}
                onChange={(e) => update("position", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="monthlySalary">{t("clients.form.monthlySalary")}<RequiredMark /></Label>
              <Input
                id="monthlySalary"
                type="number"
                min="0"
                // MILESTONE 26B-24 — sin `step`, HTML asume 1 y el navegador
                // rechaza B/. 1,850.50 pidiendo "1850 o 1851". La columna es
                // numeric(12,2): los centavos siempre cupieron en el modelo, y
                // obligar a redondear un salario real es inventar el dato. Mismo
                // par que ya usa el monto solicitado en Nueva solicitud.
                step="0.01"
                inputMode="decimal"
                required
                value={form.monthlySalary}
                onChange={(e) => update("monthlySalary", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="birthDate">{t("clients.form.birthDate")}<RequiredMark /></Label>
              <Input
                id="birthDate"
                type="date"
                required
                value={form.birthDate}
                onChange={(e) => update("birthDate", e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="nationality">{t("clients.form.nationality")}<RequiredMark /></Label>
              <Input
                id="nationality"
                required
                value={form.nationality}
                onChange={(e) => update("nationality", e.target.value)}
              />
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="address">{t("clients.form.address")}<RequiredMark /></Label>
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
            <div className="space-y-1.5">
              {/* MILESTONE 26B-25.1 — mismo catálogo y mismo comportamiento que
                  el formulario público: sin él, un cliente captado por WhatsApp
                  jamás podría tener este dato. Opcional a propósito — de la
                  mayoría de los históricos simplemente no se sabe. */}
              <Label htmlFor="primarySocialNetwork">{t("clients.form.socialNetwork")}</Label>
              <Select
                value={form.primarySocialNetwork || undefined}
                onValueChange={(value) => {
                  const next = value ?? "";
                  update("primarySocialNetwork", next);
                  // Pasar de «Otros» a una red catalogada limpia la descripción:
                  // el CHECK la prohíbe ahí, y conservarla guardaría un texto
                  // que ya no describe nada.
                  if (next !== "other") update("primarySocialNetworkOther", "");
                }}
              >
                <SelectTrigger id="primarySocialNetwork" className="w-full">
                  <SelectValue placeholder={t("common.optional")}>
                    {(value: string) => tSocial(value as "instagram")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PRIMARY_SOCIAL_NETWORKS.map((network) => (
                    <SelectItem key={network} value={network}>
                      {tSocial(network)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {form.primarySocialNetwork === "other" && (
              <div className="space-y-1.5">
                <Label htmlFor="primarySocialNetworkOther">
                  {t("clients.form.socialNetworkOther")}
                  <RequiredMark />
                </Label>
                <Input
                  id="primarySocialNetworkOther"
                  required
                  maxLength={60}
                  value={form.primarySocialNetworkOther}
                  onChange={(e) => update("primarySocialNetworkOther", e.target.value)}
                />
              </div>
            )}
          </div>

          <RequiredFieldsNote />

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
