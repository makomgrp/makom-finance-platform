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
import type { Client, IdentificationType } from "@/types";

interface ClientFormDialogProps {
  trigger?: ReactNode;
  onSave: (client: Client) => void;
  initialClient?: Client;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const EMPTY_FORM = {
  fullName: "",
  idType: "Cédula" as IdentificationType,
  idNumber: "",
  phone: "",
  email: "",
  companyId: COMPANIES[0]?.id ?? "",
  position: "",
  monthlySalary: "",
  birthDate: "",
  nationality: "Panameña",
  address: "",
  observations: "",
};

export function ClientFormDialog({
  trigger,
  onSave,
  initialClient,
  open: controlledOpen,
  onOpenChange,
}: ClientFormDialogProps) {
  const t = useTranslations();
  const [internalOpen, setInternalOpen] = useState(false);
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
          idType: initialClient.idType,
          idNumber: initialClient.idNumber,
          phone: initialClient.phone,
          email: initialClient.email,
          companyId: initialClient.companyId,
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

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const client: Client = {
      id: initialClient?.id ?? `cl-demo-${Date.now()}`,
      fullName: form.fullName,
      idType: form.idType as IdentificationType,
      idNumber: form.idNumber,
      phone: form.phone,
      email: form.email,
      companyId: form.companyId,
      position: form.position,
      monthlySalary: Number(form.monthlySalary) || 0,
      birthDate: form.birthDate,
      nationality: form.nationality,
      address: form.address,
      observations: form.observations || undefined,
      status: initialClient?.status ?? "prospecto",
      registeredAt: initialClient?.registeredAt ?? new Date().toISOString().slice(0, 10),
      assignedAdvisorId: initialClient?.assignedAdvisorId ?? "u-004",
    };

    onSave(client);
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
              <Label htmlFor="idType">{t("clients.form.idType")}</Label>
              <Select
                value={form.idType}
                onValueChange={(value) => value && update("idType", value)}
              >
                <SelectTrigger id="idType" className="w-full">
                  <SelectValue>
                    {(value: string) =>
                      value === "Cédula"
                        ? t("clients.form.idTypeCedula")
                        : t("clients.form.idTypePassport")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Cédula">{t("clients.form.idTypeCedula")}</SelectItem>
                  <SelectItem value="Pasaporte">{t("clients.form.idTypePassport")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="idNumber">{t("clients.form.idNumber")}</Label>
              <Input
                id="idNumber"
                required
                value={form.idNumber}
                onChange={(e) => update("idNumber", e.target.value)}
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
              <Label htmlFor="companyId">{t("clients.form.company")}</Label>
              <Select
                value={form.companyId}
                onValueChange={(value) => value && update("companyId", value)}
              >
                <SelectTrigger id="companyId" className="w-full">
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
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("clients.form.cancel")}
            </Button>
            <Button type="submit">
              {initialClient ? t("clients.form.submitEdit") : t("clients.form.submitNew")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
