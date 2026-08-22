"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ApplicationStatusMenu } from "@/components/applications/application-status-menu";
import { APPLICATION_STATUS_ORDER, APPLICATION_STATUS_TRANSITIONS } from "@/lib/config/application";
import { formatRelativeTime, getInitials } from "@/lib/format";
import { useCapability } from "@/lib/auth/use-capability";
import type { Locale } from "@/i18n/config";
import type { ApplicationListItem, ApplicationStatus } from "@/types";

interface ApplicationsKanbanProps {
  applications: ApplicationListItem[];
  /** See ApplicationsTableProps — same shape, same "missing key = 0 of 0"
   * contract. */
  /** MILESTONE 26B-5 — reception and review, kept apart. */
  documentProgress: Record<string, { received: number; reviewed: number; total: number }>;
  onStatusChange: (applicationId: string, status: ApplicationStatus) => void;
}

export function ApplicationsKanban({ applications, documentProgress, onStatusChange }: ApplicationsKanbanProps) {
  // Milestone 16 — same capability and reasoning as ApplicationsTable; the
  // kanban is just the other view of the same list.
  const canSetApplicationStatus = useCapability("application:set_status");
  const router = useRouter();
  const locale = useLocale() as Locale;
  const t = useTranslations();

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {APPLICATION_STATUS_ORDER.map((status) => {
        const columnApps = applications.filter((app) => app.status === status);

        return (
          <div key={status} className="w-72 shrink-0">
            <div className="mb-3 flex items-center justify-between px-1">
              <h3 className="text-sm font-semibold text-foreground">
                {t(`statuses.applicationStatus.${status}`)}
              </h3>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                {columnApps.length}
              </span>
            </div>

            <div className="space-y-3">
              {columnApps.map((app) => {
                const docs = documentProgress[app.id] ?? { received: 0, reviewed: 0, total: 0 };
                const receivedPercent =
                  docs.total > 0 ? Math.round((docs.received / docs.total) * 100) : 0;
                const legalTargets = APPLICATION_STATUS_TRANSITIONS[app.status];

                return (
                  <Card key={app.id} className="gap-3">
                    <CardContent className="space-y-3">
                      <div>
                        <button
                          onClick={() => router.push(`/expedientes/${app.clientId}?solicitud=${app.id}`)}
                          className="text-sm font-medium text-foreground hover:underline"
                        >
                          {app.clientFullName}
                        </button>
                        {/* The number opens this specific application (26B-5). */}
                        <Link
                          href={`/solicitudes/${app.id}`}
                          className="rounded-sm text-xs text-muted-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                        >
                          {app.applicationNumber}
                        </Link>
                      </div>

                      <p className="text-xs text-muted-foreground">{app.productName[locale]}</p>

                      <div>
                        <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                          <span>{t("applications.columns.documentation")}</span>
                          <span className="tabular-nums">
                            {t("applications.documentsReceivedShort", {
                              received: docs.received,
                              total: docs.total,
                            })}
                          </span>
                        </div>
                        <Progress value={receivedPercent} />
                        {/* Review stated separately — a bar that folded both in
                            is what showed 0% for a full set of documents. */}
                        <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                          {t("applications.documentsReviewedShort", {
                            reviewed: docs.reviewed,
                            total: docs.total,
                          })}
                        </p>
                      </div>

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <Avatar className="size-5">
                            <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">
                              {app.assignedAdvisorFullName ? getInitials(app.assignedAdvisorFullName) : "—"}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-[11px] text-muted-foreground">
                            {app.assignedAdvisorFullName ?? t("common.unassigned")}
                          </span>
                        </div>
                        <span className="text-[11px] text-muted-foreground">
                          {formatRelativeTime(app.statusChangedAt ?? app.createdAt, locale, t)}
                        </span>
                      </div>

                      {canSetApplicationStatus && (
                        <ApplicationStatusMenu
                          options={legalTargets.map((target) => ({
                            value: target,
                            label: t(`statuses.applicationStatus.${target}`),
                          }))}
                          triggerDisabled={legalTargets.length === 0}
                          onChange={(newStatus) => onStatusChange(app.id, newStatus as ApplicationStatus)}
                          triggerLabel={t("applications.statusMenu.move")}
                          className="w-full"
                        />
                      )}
                    </CardContent>
                  </Card>
                );
              })}

              {columnApps.length === 0 && (
                <div className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
                  {t("applications.noApplicationsInColumn")}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
