"use client";

import { useLocale, useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCompanyById } from "@/lib/demo-data";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Locale } from "@/i18n/config";
import type { Client } from "@/types";

interface PersonalDataTabProps {
  client: Client;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-foreground">{value || "—"}</dd>
    </div>
  );
}

export function PersonalDataTab({ client }: PersonalDataTabProps) {
  const locale = useLocale() as Locale;
  const t = useTranslations();
  // Milestone 14D: companyLegacyId is the same DELIBERATE, TEMPORARY
  // bridge to the still-demo Company model used throughout the Dossier —
  // see summary-tab.tsx's identical pattern.
  const company = client.companyLegacyId ? getCompanyById(client.companyLegacyId) : undefined;
  const idTypeLabel =
    client.identificationType === "cedula"
      ? t("clients.form.idTypeCedula")
      : t("clients.form.idTypePassport");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("dossier.personalData.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t("dossier.personalData.fullName")} value={client.fullName} />
          <Field
            label={t("dossier.personalData.identification")}
            value={`${idTypeLabel} · ${client.identificationNumber}`}
          />
          <Field label={t("dossier.personalData.phone")} value={client.phone} />
          <Field label={t("dossier.personalData.email")} value={client.email} />
          <Field label={t("dossier.personalData.company")} value={company?.name ?? "—"} />
          <Field label={t("dossier.personalData.position")} value={client.position} />
          <Field
            label={t("dossier.personalData.monthlySalary")}
            value={formatCurrency(client.monthlySalary)}
          />
          <Field
            label={t("dossier.personalData.birthDate")}
            value={formatDate(client.birthDate, locale)}
          />
          <Field label={t("dossier.personalData.nationality")} value={client.nationality} />
          <Field label={t("dossier.personalData.address")} value={client.address} />
          <Field
            label={t("dossier.personalData.registeredAt")}
            value={formatDate(client.createdAt, locale)}
          />
          <div className="sm:col-span-2 lg:col-span-3">
            <Field
              label={t("dossier.personalData.observations")}
              value={client.observations ?? t("dossier.personalData.noObservations")}
            />
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
