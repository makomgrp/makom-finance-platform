"use client";

import { useMemo } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { CalendarClock, Mail, Phone } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ApplicationStatusMenu } from "@/components/applications/application-status-menu";
import { AdvisorAssignMenu } from "@/components/applications/advisor-assign-menu";
import { useSearchParamState } from "@/lib/hooks/use-search-param-state";
import { APPLICATION_STATUS_TRANSITIONS } from "@/lib/config/application";
import { PIPELINE_STAGE_ORDER, isPortalDrivenStage } from "@/lib/config/pipeline";
import { formatDateTime, formatRelativeTime, getInitials } from "@/lib/format";
import { useCapability } from "@/lib/auth/use-capability";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/config";
import type { ApplicationStatus, AssignableAdvisor, PipelineCard } from "@/types";

/**
 * ============================================================================
 * THE OPERATIONAL PIPELINE (26B-5A, follow-up layer 26B-6)
 * ============================================================================
 *
 * One board for the whole journey, now carrying the second half of the picture:
 * not just how far the CUSTOMER has got, but what ODL is doing about them.
 *
 * ----------------------------------------------------------------------------
 * TWO AXES THAT MUST NEVER MERGE
 * ----------------------------------------------------------------------------
 * The COLUMN is the customer's portal progress, derived from their own data.
 * The advisor, the last contact and the next action are ODL's internal work.
 * Calling someone does not move their card, and moving their card is not
 * something staff can do at all in the first three stages — those are
 * statements about what the applicant did, and are recomputed on every read.
 *
 * ----------------------------------------------------------------------------
 * WHAT NEEDS ATTENTION IS VISIBLE WITHOUT BEING LOUD
 * ----------------------------------------------------------------------------
 * Overdue is the one thing that earns a warning colour. "Sin asignar" is stated
 * plainly and left neutral: an unassigned new lead is normal, and painting every
 * one of them as an error would make the colour meaningless by lunchtime.
 */

type AdvisorFilter = "all" | "unassigned" | string;
type FollowUpFilter = "all" | "overdue" | "today" | "none";

/** The query-string vocabulary. Anything else falls back to "all". */
const FOLLOW_UP_FILTERS = ["all", "overdue", "today", "none"] as const satisfies readonly FollowUpFilter[];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PipelineKanbanProps {
  cards: PipelineCard[];
  onStatusChange: (applicationId: string, status: ApplicationStatus) => void;
  /** Keyed by application id — the same shape the table already receives. */
  assignableAdvisorsByApplication: Record<string, AssignableAdvisor[]>;
  onAdvisorChange: (applicationId: string, advisorProfileId: string | null) => void;
  onLogFollowUp: (card: PipelineCard) => void;
  onCompleteAction: (applicationId: string, followUpId: string) => void;
}

export function PipelineKanban({
  cards,
  onStatusChange,
  assignableAdvisorsByApplication,
  onAdvisorChange,
  onLogFollowUp,
  onCompleteAction,
}: PipelineKanbanProps) {
  const canSetApplicationStatus = useCapability("application:set_status");
  const canAssignAdvisor = useCapability("application:assign_advisor");
  const canLogFollowUp = useCapability("note:create");
  const t = useTranslations();

  // MILESTONE 26B-8 — both filters live in the query string so the Dashboard
  // can link straight to "overdue" or "unassigned", and so a reload or Back
  // returns to the same board. See use-search-param-state.ts for why a
  // hand-typed value cannot widen what the viewer is allowed to see.
  const { read, readGuarded, write } = useSearchParamState();
  const followUpFilter = read<FollowUpFilter>("followup", FOLLOW_UP_FILTERS, "all");
  const advisorFilter: AdvisorFilter = readGuarded(
    "advisor",
    // "unassigned", or a real advisor id. An id nobody on this board holds is
    // not an error — it filters to nothing, which is the honest answer to
    // "show me that person's work" when they have none here.
    (value) => value === "unassigned" || UUID_PATTERN.test(value),
    "all"
  );
  const setAdvisorFilter = (value: AdvisorFilter) =>
    write({ advisor: { value, defaultValue: "all" } });
  const setFollowUpFilter = (value: FollowUpFilter) =>
    write({ followup: { value, defaultValue: "all" } });

  // The filter's option list is the union of everyone assignable anywhere on
  // this board — derived from data already loaded, not a second query.
  const advisorOptions = useMemo(() => {
    const byId = new Map<string, AssignableAdvisor>();
    for (const list of Object.values(assignableAdvisorsByApplication)) {
      for (const advisor of list) byId.set(advisor.id, advisor);
    }
    // Anyone currently assigned must remain selectable even if they have since
    // stopped being assignable — otherwise their filter silently disappears
    // while their cards stay on the board.
    for (const card of cards) {
      if (card.advisorProfileId && card.advisorFullName && !byId.has(card.advisorProfileId)) {
        byId.set(card.advisorProfileId, {
          id: card.advisorProfileId,
          fullName: card.advisorFullName,
          role: "asesor",
        });
      }
    }
    return [...byId.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [assignableAdvisorsByApplication, cards]);

  const visibleCards = useMemo(() => {
    return cards.filter((card) => {
      if (advisorFilter === "unassigned" && card.advisorProfileId) return false;
      if (advisorFilter !== "all" && advisorFilter !== "unassigned") {
        if (card.advisorProfileId !== advisorFilter) return false;
      }

      const urgency = card.followUp?.nextActionUrgency;
      if (followUpFilter === "overdue" && urgency !== "overdue") return false;
      if (followUpFilter === "today" && urgency !== "today") return false;
      if (followUpFilter === "none" && card.followUp?.nextAction) return false;

      return true;
    });
  }, [cards, advisorFilter, followUpFilter]);

  return (
    <div className="flex flex-col gap-4">
      {/* ---- Operational filters -------------------------------------- */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          {t("followUp.advisor")}
          <Select value={advisorFilter} onValueChange={(v) => setAdvisorFilter(v as AdvisorFilter)}>
            <SelectTrigger className="w-52">
              {/* base-ui renders the raw VALUE unless given a mapper — the same
                  render-prop the status filter already uses. */}
              <SelectValue>
                {(value: string) =>
                  value === "all"
                    ? t("followUp.filters.allAdvisors")
                    : value === "unassigned"
                      ? t("followUp.unassigned")
                      : (advisorOptions.find((a) => a.id === value)?.fullName ?? value)
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("followUp.filters.allAdvisors")}</SelectItem>
              <SelectItem value="unassigned">{t("followUp.unassigned")}</SelectItem>
              {advisorOptions.map((advisor) => (
                <SelectItem key={advisor.id} value={advisor.id}>
                  {advisor.fullName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          {t("followUp.followUpLabel")}
          <Select value={followUpFilter} onValueChange={(v) => setFollowUpFilter(v as FollowUpFilter)}>
            <SelectTrigger className="w-52">
              <SelectValue>
                {(value: string) =>
                  value === "all"
                    ? t("followUp.filters.allFollowUps")
                    : value === "overdue"
                      ? t("followUp.overdue")
                      : value === "today"
                        ? t("followUp.today")
                        : t("followUp.noNextAction")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("followUp.filters.allFollowUps")}</SelectItem>
              <SelectItem value="overdue">{t("followUp.overdue")}</SelectItem>
              <SelectItem value="today">{t("followUp.today")}</SelectItem>
              <SelectItem value="none">{t("followUp.noNextAction")}</SelectItem>
            </SelectContent>
          </Select>
        </label>
      </div>

      {/* Horizontal scroll rather than wrapping: seven columns cannot fit a
          phone, and a board that reflows into one column stops being a board. */}
      <div className="flex gap-4 overflow-x-auto pb-2">
        {PIPELINE_STAGE_ORDER.map((stage) => {
          const columnCards = visibleCards.filter((card) => card.stage === stage);

          return (
            <section key={stage} aria-label={t(`pipeline.stages.${stage}`)} className="w-72 shrink-0">
              <div className="mb-3 flex items-center justify-between px-1">
                <h3 className="text-sm font-semibold text-foreground">
                  {t(`pipeline.stages.${stage}`)}
                </h3>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground tabular-nums">
                  {columnCards.length}
                </span>
              </div>

              <div className="space-y-3">
                {columnCards.map((card) => (
                  <PipelineCardView
                    key={card.id}
                    card={card}
                    advisors={assignableAdvisorsByApplication[card.id] ?? []}
                    canAssignAdvisor={canAssignAdvisor}
                    canLogFollowUp={canLogFollowUp}
                    canSetApplicationStatus={canSetApplicationStatus}
                    onAdvisorChange={onAdvisorChange}
                    onStatusChange={onStatusChange}
                    onLogFollowUp={onLogFollowUp}
                    onCompleteAction={onCompleteAction}
                  />
                ))}

                {columnCards.length === 0 && (
                  <div className="rounded-lg border border-dashed border-border py-6 text-center text-xs text-muted-foreground">
                    {t("pipeline.emptyColumn")}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function PipelineCardView({
  card,
  advisors,
  canAssignAdvisor,
  canLogFollowUp,
  canSetApplicationStatus,
  onAdvisorChange,
  onStatusChange,
  onLogFollowUp,
  onCompleteAction,
}: {
  card: PipelineCard;
  advisors: AssignableAdvisor[];
  canAssignAdvisor: boolean;
  canLogFollowUp: boolean;
  canSetApplicationStatus: boolean;
  onAdvisorChange: (applicationId: string, advisorProfileId: string | null) => void;
  onStatusChange: (applicationId: string, status: ApplicationStatus) => void;
  onLogFollowUp: (card: PipelineCard) => void;
  onCompleteAction: (applicationId: string, followUpId: string) => void;
}) {
  const locale = useLocale() as Locale;
  const t = useTranslations();
  const isLead = card.kind === "lead";
  const legalTargets = APPLICATION_STATUS_TRANSITIONS[card.status];
  const receivedPercent =
    card.documentsRequired > 0
      ? Math.round((card.documentsReceived / card.documentsRequired) * 100)
      : 0;

  return (
    <Card className="gap-3">
      <CardContent className="space-y-2.5">
        {/* ---- Identity ------------------------------------------------- */}
        {isLead ? (
          <div className="flex items-start justify-between gap-2">
            {/* A lead has no application dossier to open — it is not an
                application yet — so this goes to the prospect's profile. */}
            <Link
              href={`/expedientes/${card.clientId}`}
              className="rounded-sm text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {card.fullName}
            </Link>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
              {t("pipeline.sourcePortal")}
            </span>
          </div>
        ) : (
          <div>
            {/* MILESTONE 26B-23B.1 — a manual draft is a card of this kind and
                has no number yet, so the title falls back to the same word its
                dossier header uses rather than rendering an empty link. Not
                monospaced when it is a word instead of a reference, and muted
                because there is nothing to quote back to a customer yet. */}
            <Link
              href={`/solicitudes/${card.id}`}
              className={
                "rounded-sm text-sm font-medium underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none " +
                (card.applicationNumber
                  ? "font-mono text-foreground"
                  : "italic text-muted-foreground")
              }
            >
              {card.applicationNumber ?? t("applicationDossier.draftLabel")}
            </Link>
            <p className="mt-0.5 text-xs text-muted-foreground">{card.fullName}</p>
          </div>
        )}

        <p className="text-xs text-muted-foreground">{card.productName[locale]}</p>

        {/* ---- Contact details, for leads only -------------------------- */}
        {/* Selectable so an advisor can copy a number straight into a dialler.
            A submitted application is worked from its dossier, so the card does
            not need to carry them. */}
        {isLead && (
          <div className="flex flex-col gap-1">
            {card.phone && (
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Phone className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate select-all">{card.phone}</span>
              </span>
            )}
            {card.email && (
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Mail className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate select-all" title={card.email}>
                  {card.email}
                </span>
              </span>
            )}
          </div>
        )}

        {/* ---- Stage-relevant progress (26B-5B) ------------------------- */}
        {isLead ? (
          <>
            <p className="text-[11px] font-medium text-foreground">
              {t(`pipeline.leadProgress.${card.stage}` as "pipeline.leadProgress.nuevo")}
            </p>
            {/* Document progress is a Paso 3 concern. Slots are snapshotted at
                creation, so showing it earlier reports a deficiency against a
                stage the customer has not reached. */}
            {card.stage === "paso_3" && card.documentsRequired > 0 && (
              <p className="text-[11px] text-muted-foreground tabular-nums">
                {t("applications.documentsReceivedShort", {
                  received: card.documentsReceived,
                  total: card.documentsRequired,
                })}
              </p>
            )}
          </>
        ) : (
          <div>
            <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{t("applications.columns.documentation")}</span>
              <span className="tabular-nums">
                {t("applications.documentsReceivedShort", {
                  received: card.documentsReceived,
                  total: card.documentsRequired,
                })}
              </span>
            </div>
            <Progress value={receivedPercent} />
            <p className="mt-1 text-[11px] text-muted-foreground tabular-nums">
              {t("applications.documentsReviewedShort", {
                reviewed: card.documentsReviewed,
                total: card.documentsRequired,
              })}
            </p>
          </div>
        )}

        {/* ================= OPERATIONAL CONTEXT (26B-6) ================= */}
        <div className="flex flex-col gap-1.5 border-t border-border/60 pt-2.5">
          {/* Advisor. The menu is the SAME authorized action the table uses. */}
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5">
              <Avatar className="size-5">
                <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">
                  {card.advisorFullName ? getInitials(card.advisorFullName) : "—"}
                </AvatarFallback>
              </Avatar>
              {/* The assign menu's trigger already names the current advisor,
                  so repeating it here printed "Sin asignar" twice on every
                  unowned card. The name is shown only when there is no menu. */}
              {!canAssignAdvisor && (
                <span className="truncate text-[11px] text-muted-foreground">
                  {card.advisorFullName ?? t("followUp.unassigned")}
                </span>
              )}
            </span>
            {canAssignAdvisor && (
              <AdvisorAssignMenu
                advisors={advisors}
                currentAdvisorProfileId={card.advisorProfileId}
                currentAdvisorFullName={card.advisorFullName}
                onChange={(advisorProfileId) => onAdvisorChange(card.id, advisorProfileId)}
              />
            )}
          </div>

          {/* Next action. Overdue is the one thing that earns a colour. */}
          {card.followUp?.nextAction && card.followUp.nextActionAt ? (
            <div
              className={cn(
                "flex items-start gap-1.5 rounded-md px-2 py-1.5 text-[11px]",
                card.followUp.nextActionUrgency === "overdue"
                  ? "bg-warning/10 text-warning"
                  : card.followUp.nextActionUrgency === "today"
                    ? "bg-navy/10 text-navy"
                    : "bg-muted text-muted-foreground"
              )}
            >
              <CalendarClock className="mt-px size-3 shrink-0" aria-hidden="true" />
              <span className="min-w-0">
                {/* Never colour alone — the state is written out. */}
                <span className="font-medium">
                  {card.followUp.nextActionUrgency === "overdue"
                    ? t("followUp.overdue")
                    : card.followUp.nextActionUrgency === "today"
                      ? t("followUp.today")
                      : formatDateTime(card.followUp.nextActionAt, locale)}
                </span>
                <span className="block break-words">{card.followUp.nextAction}</span>
                {/* Completing is what stops an action being overdue. Offered
                    right beside the commitment rather than buried in a menu,
                    because it is the single most common thing to do next. */}
                {canLogFollowUp && card.followUp.nextActionFollowUpId && (
                  <button
                    type="button"
                    onClick={() =>
                      onCompleteAction(card.id, card.followUp!.nextActionFollowUpId!)
                    }
                    className="mt-1 rounded-sm font-medium underline underline-offset-2 hover:opacity-80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                  >
                    {t("followUp.completeAction")}
                  </button>
                )}
              </span>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground">{t("followUp.noNextAction")}</p>
          )}

          {/* Last contact — real staff contact, never portal activity. */}
          <p className="text-[11px] text-muted-foreground">
            {card.followUp?.lastContactAt
              ? `${t("followUp.lastContact")}: ${formatRelativeTime(card.followUp.lastContactAt, locale, t)} · ${t(`followUp.outcomes.${card.followUp.lastContactOutcome}` as "followUp.outcomes.contacted")}`
              : t("followUp.noContactRecorded")}
          </p>

          {canLogFollowUp && (
            <button
              type="button"
              onClick={() => onLogFollowUp(card)}
              className="w-full rounded-md border border-border px-2 py-1.5 text-[11px] font-medium text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {t("followUp.logFollowUp")}
            </button>
          )}
        </div>

        {/* MILESTONE 26B-6 — the branch label is deliberately NOT on the card.
            Rendered here it printed a bare "Sin asignar" directly beneath the
            advisor block, which reads as though the ADVISOR were unassigned
            when it only meant the file has no branch. Branch stays on the table
            and the application dossier, where it is labelled. */}

        {/* Only formal applications get a status control — the first three
            stages are the customer's own progress, not a staff decision. */}
        {canSetApplicationStatus && !isPortalDrivenStage(card.stage) && (
          <ApplicationStatusMenu
            options={legalTargets.map((target) => ({
              value: target,
              label: t(`statuses.applicationStatus.${target}`),
            }))}
            triggerDisabled={legalTargets.length === 0}
            onChange={(newStatus) => onStatusChange(card.id, newStatus as ApplicationStatus)}
            triggerLabel={t("applications.statusMenu.move")}
            className="w-full"
          />
        )}
      </CardContent>
    </Card>
  );
}
