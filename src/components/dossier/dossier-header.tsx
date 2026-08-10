"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ArrowLeft, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/shared/status-badge";
import { ApplicationStatusMenu } from "@/components/applications/application-status-menu";
import { RealClientFormDialog } from "@/components/clients/real-client-form-dialog";
import { REAL_CLIENT_STATUS_BADGE_CLASS } from "@/lib/config/client-status";
import { APPLICATION_STATUS_BADGE_CLASS, APPLICATION_STATUS_TRANSITIONS } from "@/lib/config/application";
import { formatDate, getInitials } from "@/lib/format";
import type { Locale } from "@/i18n/config";
import type { ApplicationListItem, ApplicationStatus, RealClient } from "@/types";

interface DossierHeaderProps {
  client: RealClient;
  applications: ApplicationListItem[];
  activeApplication?: ApplicationListItem;
  onSelectApplication: (applicationId: string) => void;
  onClientUpdate: (client: RealClient) => void;
  onApplicationStatusChange: (applicationId: string, status: ApplicationStatus) => void;
}

export function DossierHeader({
  client,
  applications,
  activeApplication,
  onSelectApplication,
  onClientUpdate,
  onApplicationStatusChange,
}: DossierHeaderProps) {
  const router = useRouter();
  const locale = useLocale() as Locale;
  const t = useTranslations();
  // Advisor is only ever rendered in the activeApplication branch below
  // (matching the pre-13E behavior exactly — client.assignedAdvisorId was
  // never actually displayed in the no-application branch either), and
  // now comes resolved from the real engine (assignedAdvisorFullName),
  // not a demo lookup.
  const legalStatusTargets = activeApplication ? APPLICATION_STATUS_TRANSITIONS[activeApplication.status] : [];

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <Button
        variant="ghost"
        size="sm"
        className="mb-3 -ml-2 text-muted-foreground"
        onClick={() => router.push("/clientes")}
      >
        <ArrowLeft className="size-4" />
        {t("dossier.backToClients")}
      </Button>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-4">
          <Avatar className="size-14">
            <AvatarFallback className="bg-primary/10 text-lg font-semibold text-primary">
              {getInitials(client.fullName)}
            </AvatarFallback>
          </Avatar>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-xl font-semibold text-foreground">{client.fullName}</h2>
              <StatusBadge
                label={t(`statuses.client.${client.status}`)}
                className={REAL_CLIENT_STATUS_BADGE_CLASS[client.status]}
              />
            </div>
            {activeApplication ? (
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {activeApplication.applicationNumber}
                </span>
                <span>{activeApplication.productName[locale]}</span>
                <span>
                  {t("dossier.advisor")}: {activeApplication.assignedAdvisorFullName ?? t("common.unassigned")}
                </span>
                <span>
                  {t("dossier.createdOn")}: {formatDate(activeApplication.createdAt, locale)}
                </span>
              </div>
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">
                {t("dossier.noApplication")} · {t("dossier.registeredOn")}:{" "}
                {formatDate(client.createdAt, locale)}
              </p>
            )}

            {applications.length > 1 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {applications.map((app) => (
                  <button
                    key={app.id}
                    onClick={() => onSelectApplication(app.id)}
                    className={
                      "rounded-full border px-2.5 py-1 text-xs transition-colors " +
                      (app.id === activeApplication?.id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:bg-muted")
                    }
                  >
                    {app.applicationNumber}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {activeApplication && (
            <>
              <StatusBadge
                label={t(`statuses.applicationStatus.${activeApplication.status}`)}
                className={APPLICATION_STATUS_BADGE_CLASS[activeApplication.status]}
              />
              <ApplicationStatusMenu
                options={legalStatusTargets.map((status) => ({
                  value: status,
                  label: t(`statuses.applicationStatus.${status}`),
                }))}
                triggerDisabled={legalStatusTargets.length === 0}
                onChange={(status) => onApplicationStatusChange(activeApplication.id, status as ApplicationStatus)}
              />
            </>
          )}
          <RealClientFormDialog
            initialClient={client}
            onSaved={onClientUpdate}
            trigger={
              <Button variant="outline" size="sm">
                <Pencil className="size-3.5" />
                {t("dossier.editClient")}
              </Button>
            }
          />
        </div>
      </div>
    </div>
  );
}
