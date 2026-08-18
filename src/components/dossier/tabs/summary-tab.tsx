"use client";

import { useLocale, useTranslations } from "next-intl";
import { FileText } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { getCompanyById } from "@/lib/demo-data";
import { formatCurrency, formatDateTime } from "@/lib/format";
import type { Locale } from "@/i18n/config";
import type { ApplicationListItem, Client } from "@/types";
import type { DossierRequirementsData } from "@/components/dossier/dossier-view";

interface SummaryTabProps {
  client: Client;
  application?: ApplicationListItem;
  /** Milestone 12E1: the same Requirement Slot + Evidence bundle
   * RequirementsTab already receives (dossier-view.tsx's
   * activeRequirementsData) — no new fetch, no new service method.
   * null means no real Application bridge exists yet for the active
   * demo application; see the three-way fallback below, which mirrors
   * RequirementsTab's own fallback states exactly. */
  requirementsData: DossierRequirementsData | null;
}

export function SummaryTab({ client, application, requirementsData }: SummaryTabProps) {
  const locale = useLocale() as Locale;
  const t = useTranslations();
  // Milestone 14D: companyLegacyId is the same DELIBERATE, TEMPORARY
  // bridge to the still-demo Company model this milestone leaves in
  // place (Companies Engine is explicitly out of scope) — undefined for
  // a client with no employer selected, unlike the demo model's required
  // companyId.
  const company = client.companyLegacyId ? getCompanyById(client.companyLegacyId) : undefined;
  // MILESTONE 23: employerName (real free text) is authoritative; the
  // static COMPANIES bridge is consulted ONLY as a fallback for fixture
  // rows created before that column existed. Never the other way round.
  const employerLabel = client.employerName ?? company?.name ?? "—";

  // Milestone 12E1: "how many document requirements for this Application
  // require no further action" — document-kind Requirement Slots whose
  // status is satisfied OR waived. Deliberately NOT required-only (an
  // outstanding optional Slot is still real remaining work), NOT Evidence
  // existence (a file having arrived means nothing is being reviewed yet,
  // not that nothing further is needed), and NOT submitted/under_review
  // (those are still open, not completed). Never touches legacy
  // dossier_documents.status or DossierDocument — see the Milestone 12E
  // architecture review, Question 1.
  const documentSlots = requirementsData?.requirementSlots.filter(
    (slot) => slot.requirementKind === "document"
  ) ?? [];
  const completedCount = documentSlots.filter(
    (slot) => slot.status === "satisfied" || slot.status === "waived"
  ).length;
  const totalSlots = documentSlots.length;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>{t("dossier.summary.mainInfoTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted-foreground">{t("dossier.summary.employer")}</dt>
              <dd className="text-sm font-medium text-foreground">{employerLabel}</dd>
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
                  {application.productName[locale]}
                </dd>
              </div>
            )}
            <div>
              <dt className="text-xs text-muted-foreground">{t("dossier.summary.nextAction")}</dt>
              <dd className="text-sm font-medium text-foreground">
                {/* nextAction has no home on the real Application (Milestone
                    13A architecture review: a workflow/task-engine concept,
                    deliberately not recreated here) — always the fallback
                    until a future CRM-workflow milestone. */}
                {t("dossier.summary.noNextAction")}
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
          {!application ? (
            <EmptyState
              icon={FileText}
              title={t("dossier.documents.noApplicationTitle")}
              description={t("dossier.documents.noApplicationDescription")}
            />
          ) : !requirementsData ? (
            <EmptyState
              icon={FileText}
              title={t("dossier.documents.notMigratedTitle")}
              description={t("dossier.documents.notMigratedDescription")}
            />
          ) : requirementsData.loadError ? (
            <EmptyState
              icon={FileText}
              title={t("dossier.documents.loadErrorTitle")}
              description={t("dossier.documents.loadErrorDescription")}
            />
          ) : totalSlots > 0 ? (
            <>
              <div>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">
                    {t("dossier.summary.requirementsCompleted")}
                  </span>
                  <span className="font-medium text-foreground">
                    {t("dossier.summary.requirementsOf", {
                      completed: completedCount,
                      total: totalSlots,
                    })}
                  </span>
                </div>
                <Progress value={(completedCount / totalSlots) * 100} />
              </div>
              {completedCount === totalSlots ? (
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
              {t("dossier.summary.noDocumentRequirements")}
            </p>
          )}

          <div className="border-t border-border pt-3">
            <dt className="text-xs text-muted-foreground">{t("dossier.summary.lastUpdate")}</dt>
            <dd className="text-sm font-medium text-foreground">
              {application ? formatDateTime(application.statusChangedAt ?? application.createdAt, locale) : "—"}
            </dd>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
