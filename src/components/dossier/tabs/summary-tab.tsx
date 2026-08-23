"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { FileText, PhoneCall } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  LogFollowUpDialog,
  type LogFollowUpSubmit,
} from "@/components/applications/log-follow-up-dialog";
import { logFollowUpAction } from "@/app/(app)/solicitudes/actions";
import { useCapability } from "@/lib/auth/use-capability";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { getCompanyById } from "@/lib/demo-data";
import { formatCurrency, formatDateTime } from "@/lib/format";
import type { Locale } from "@/i18n/config";
import type { ApplicationListItem, Client } from "@/types";
import type { DossierRequirementsData } from "@/components/dossier/dossier-view";
import type { ActiveDraftContext } from "@/lib/services/pipeline";

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
  /**
   * MILESTONE 26B-5B — the portal process currently running, if any.
   *
   * When present it is the AUTHORITY for employer, position, salary, expenses
   * and payroll deduction, because those belong to the application and can
   * differ between two applications of the same person (26B-5). The `clients`
   * columns are a stale profile snapshot and are only consulted when there is
   * no live process to read from.
   */
  activeDraft?: ActiveDraftContext;
}

export function SummaryTab({ client, application, requirementsData, activeDraft }: SummaryTabProps) {
  const router = useRouter();
  // MILESTONE 26B-15 — registrar seguimiento SIN salir del expediente.
  //
  // Reutiliza el mismo diálogo y la misma Server Action que el Kanban ya usa
  // (`LogFollowUpDialog` + `logFollowUpAction`): no hay una segunda tabla, ni
  // un segundo formulario, ni una segunda regla de validación que mantener en
  // sincronía. Lo único nuevo aquí es el punto de entrada.
  //
  // El botón se muestra con `note:create`, la misma capacidad que la acción
  // exige en el servidor, para que un enlace visible y una petición aceptada
  // no puedan discrepar.
  const canLogFollowUp = useCapability("note:create");
  const [followUpOpen, setFollowUpOpen] = useState(false);

  const handleLogFollowUp = async (values: LogFollowUpSubmit) => {
    if (!activeDraft) return;
    const result = await logFollowUpAction({
      applicationId: activeDraft.applicationId,
      contactMethod: values.contactMethod,
      outcome: values.outcome,
      note: values.note,
      nextAction: values.nextAction,
      nextActionAt: values.nextActionAt,
    });
    if (result.status !== "success") {
      toast.error(t("followUp.toasts.saveError"));
      return;
    }
    toast.success(t("followUp.toasts.saved"));
    setFollowUpOpen(false);
    // Última interacción y próxima acción las resuelve el servidor; refrescar
    // es lo que las trae al día sin duplicar ese cálculo en el cliente.
    router.refresh();
  };

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
  //
  // MILESTONE 26B-5B / 26B-6C — WHICH EMPLOYER IS "CURRENT"?
  //
  // 26B-5B read the live draft FIRST, because a portal prospect's `clients` row
  // held nothing and the field rendered "—" while their draft plainly said
  // Makom Capital Group. That was a workaround for a missing write, and 26B-6C
  // removed the reason for it: Step 1 and Step 2 now synchronise employer,
  // position and salary onto the client record, which is the CURRENT PROFILE by
  // definition.
  //
  // Leaving the draft in front then became actively wrong. A client may now
  // hold SEVERAL processes (26B-6C made returning customers reuse one client),
  // so "the active draft" is one process among many — and preferring it meant
  // this card showed that draft's employer while "Datos personales", reading
  // the client record, showed the real current one. Two tabs of the same
  // dossier disagreed, and the one contradicting the customer's actual profile
  // was the summary.
  //
  // The client record leads. The draft remains a FALLBACK for the rows the
  // sync has never touched — leads created before 26B-6C — so nothing that
  // rendered a value before renders "—" now.
  const employerLabel =
    client.employerName ?? activeDraft?.employerName ?? company?.name ?? "—";

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
              {/* TypeScript does NOT flag a bare `undefined` in JSX — it just
                  renders nothing, leaving a silently blank field. The em dash
                  is the project's convention for "no value", and saying it
                  explicitly is what stops absence from looking like a bug. */}
              <dd className="text-sm font-medium text-foreground">
                {/* Current profile first — see employerLabel above. */}
                {client.position ?? activeDraft?.jobTitle ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("dossier.summary.monthlySalary")}
              </dt>
              <dd className="text-sm font-medium text-foreground">
                {(() => {
                  // Current profile first — see employerLabel above.
                  const salary = client.monthlySalary ?? activeDraft?.monthlyIncome;
                  return salary === undefined ? "—" : formatCurrency(salary);
                })()}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("dossier.summary.directDiscount")}
              </dt>
              {/* MILESTONE 26B-5B — three states, not two.
                  This read `company?.directDiscount ? yes : no`, so a prospect
                  nobody had asked yet was reported as "La empresa no aplica" —
                  a definite negative answer manufactured out of missing data.
                  The applicant's own answer on the live draft comes first, and
                  "unanswered" is now allowed to say so. */}
              <dd className="text-sm font-medium text-foreground">
                {activeDraft?.payrollDeductionAvailable
                  ? t(`payrollDeduction.${activeDraft.payrollDeductionAvailable}`)
                  : company?.directDiscount
                    ? t("dossier.summary.directDiscountYes")
                    : company
                      ? t("dossier.summary.directDiscountNo")
                      : "—"}
              </dd>
            </div>
            {(application ?? activeDraft) && (
              <div>
                <dt className="text-xs text-muted-foreground">{t("dossier.summary.loanType")}</dt>
                <dd className="text-sm font-medium text-foreground">
                  {(application?.productName ?? activeDraft!.productName)[locale]}
                </dd>
              </div>
            )}

            {/* The live process, stated plainly. Only rendered when there is no
                formal application: once one exists it owns this space, and its
                own dossier is the place for its detail. */}
            {!application && activeDraft && (
              <>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("dossier.summary.currentStage")}
                  </dt>
                  <dd className="text-sm font-medium text-foreground">
                    {t(`pipeline.stages.${activeDraft.stage}`)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {t("dossier.summary.requestedAmount")}
                  </dt>
                  <dd className="text-sm font-medium text-foreground">
                    {formatCurrency(activeDraft.requestedAmount)}
                  </dd>
                </div>
              </>
            )}
            {/* MILESTONE 26B-6 — WHO IS WORKING THIS, AND WHAT IS PROMISED.
                Operational facts, deliberately beside — never merged into —
                the customer's portal stage above. Calling someone does not
                advance them, and advancing does not mean anyone called. */}
            {activeDraft && (
              <div>
                <dt className="text-xs text-muted-foreground">{t("followUp.advisor")}</dt>
                <dd className="text-sm font-medium text-foreground">
                  {activeDraft.advisorFullName ?? t("followUp.unassigned")}
                </dd>
              </div>
            )}

            {activeDraft && (
              <div>
                <dt className="text-xs text-muted-foreground">{t("followUp.lastContact")}</dt>
                <dd className="text-sm font-medium text-foreground">
                  {activeDraft.followUp?.lastContactAt
                    ? `${formatDateTime(activeDraft.followUp.lastContactAt, locale)} · ${t(`followUp.methods.${activeDraft.followUp.lastContactMethod}` as "followUp.methods.call")} · ${t(`followUp.outcomes.${activeDraft.followUp.lastContactOutcome}` as "followUp.outcomes.contacted")}`
                    : t("followUp.noContactRecorded")}
                </dd>
              </div>
            )}

            <div>
              <dt className="text-xs text-muted-foreground">{t("dossier.summary.nextAction")}</dt>
              {/* Real now, and derived from the oldest outstanding commitment
                  rather than stored twice. */}
              <dd className="text-sm font-medium text-foreground">
                {activeDraft?.followUp?.nextAction ?? t("dossier.summary.noNextAction")}
              </dd>
            </div>

            {activeDraft && canLogFollowUp && (
              <div className="pt-1">
                <Button variant="outline" size="sm" onClick={() => setFollowUpOpen(true)}>
                  <PhoneCall className="size-3.5" />
                  {t("followUp.logFollowUp")}
                </Button>
              </div>
            )}

            {activeDraft?.followUp?.nextActionAt && (
              <div>
                <dt className="text-xs text-muted-foreground">{t("followUp.nextActionDate")}</dt>
                <dd className="text-sm font-medium text-foreground">
                  {formatDateTime(activeDraft.followUp.nextActionAt, locale)}
                  {activeDraft.followUp.nextActionUrgency === "overdue" && (
                    <span className="ml-2 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
                      {t("followUp.overdue")}
                    </span>
                  )}
                  {activeDraft.followUp.nextActionUrgency === "today" && (
                    <span className="ml-2 rounded-full bg-navy/10 px-2 py-0.5 text-xs font-medium text-navy">
                      {t("followUp.today")}
                    </span>
                  )}
                </dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      <LogFollowUpDialog
        open={followUpOpen}
        onOpenChange={setFollowUpOpen}
        subjectName={client.fullName}
        onSubmit={handleLogFollowUp}
      />

      <Card>
        <CardHeader>
          <CardTitle>{t("dossier.summary.documentStatusTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!application && activeDraft ? (
            /* MILESTONE 26B-5B — there IS a process, so this must not claim
               otherwise. What is true is that nothing has been sent yet, and
               that is what it says. No official number, no implication that a
               formal application exists. */
            <div className="space-y-1">
              <p className="text-sm font-medium text-foreground">
                {t("dossier.processInProgress")} · {t(`pipeline.stages.${activeDraft.stage}`)}
              </p>
              <p className="text-sm text-muted-foreground">
                {activeDraft.documentsReceived === 0
                  ? t("dossier.summary.noDocumentsYet")
                  : t("applications.documentsReceivedShort", {
                      received: activeDraft.documentsReceived,
                      total: activeDraft.documentsRequired,
                    })}
              </p>
            </div>
          ) : !application ? (
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
