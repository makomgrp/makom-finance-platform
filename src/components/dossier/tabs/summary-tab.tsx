"use client";

import { useLocale, useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/shared/status-badge";
import { getCompanyById } from "@/lib/demo-data";
import { formatCurrency, formatDateTime } from "@/lib/format";
import type { Locale } from "@/i18n/config";
import type { Client, DossierDocument, LoanApplication } from "@/types";

interface SummaryTabProps {
  client: Client;
  application?: LoanApplication;
  documents: DossierDocument[];
}

export function SummaryTab({ client, application, documents }: SummaryTabProps) {
  const locale = useLocale() as Locale;
  const t = useTranslations();
  const company = getCompanyById(client.companyId);
  const verifiedCount = documents.filter((doc) => doc.status === "verificado").length;
  const totalDocs = documents.length;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>{t("dossier.summary.mainInfoTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">{t("dossier.summary.company")}</dt>
              <dd className="text-sm font-medium text-foreground">{company?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("dossier.summary.position")}</dt>
              <dd className="text-sm font-medium text-foreground">{client.position}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("dossier.summary.monthlySalary")}
              </dt>
              <dd className="text-sm font-medium text-foreground">
                {formatCurrency(client.monthlySalary)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("dossier.summary.directDiscount")}
              </dt>
              <dd className="text-sm font-medium text-foreground">
                {company?.directDiscount
                  ? t("dossier.summary.directDiscountYes")
                  : t("dossier.summary.directDiscountNo")}
              </dd>
            </div>
            {application && (
              <div>
                <dt className="text-xs text-muted-foreground">{t("dossier.summary.loanType")}</dt>
                <dd className="text-sm font-medium text-foreground">
                  {t(`statuses.loanType.${application.loanType}`)}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-muted-foreground">{t("dossier.summary.nextAction")}</dt>
              <dd className="text-sm font-medium text-foreground">
                {application?.nextAction ?? t("dossier.summary.noNextAction")}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("dossier.summary.documentStatusTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {totalDocs > 0 ? (
            <>
              <div>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {t("dossier.summary.requirementsCompleted")}
                  </span>
                  <span className="font-medium text-foreground">
                    {t("dossier.summary.requirementsOf", {
                      completed: verifiedCount,
                      total: totalDocs,
                    })}
                  </span>
                </div>
                <Progress value={(verifiedCount / totalDocs) * 100} />
              </div>
              {verifiedCount === totalDocs ? (
                <StatusBadge
                  label={t("dossier.summary.documentSetComplete")}
                  className="bg-success/10 text-success border-success/20"
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  {t("dossier.summary.documentsPendingHint")}
                </p>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("dossier.summary.noApplicationDocuments")}
            </p>
          )}

          <div className="border-t border-border pt-3">
            <dt className="text-xs text-muted-foreground">{t("dossier.summary.lastUpdate")}</dt>
            <dd className="text-sm font-medium text-foreground">
              {application ? formatDateTime(application.lastActivityAt, locale) : "—"}
            </dd>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
