"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { COMPANIES } from "@/lib/demo-data";
import type { Company } from "@/types";

export function CompaniesSection() {
  const t = useTranslations();
  const [companies, setCompanies] = useState<Company[]>(COMPANIES);

  const toggle = (id: string) => {
    setCompanies((prev) =>
      prev.map((company) =>
        company.id === id ? { ...company, directDiscount: !company.directDiscount } : company
      )
    );
    const company = companies.find((c) => c.id === id);
    if (company) {
      toast.success(
        company.directDiscount
          ? t("settings.companies.toastToggleOff", { name: company.name })
          : t("settings.companies.toastToggleOn", { name: company.name })
      );
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.companies.title")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("settings.companies.description")}</p>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {companies.map((company) => (
            <li key={company.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <div>
                <p className="text-sm font-medium text-foreground">{company.name}</p>
                <p className="text-xs text-muted-foreground">{company.sector}</p>
              </div>
              <Switch checked={company.directDiscount} onCheckedChange={() => toggle(company.id)} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
