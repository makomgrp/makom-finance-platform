"use client";

import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Mail, Phone } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ApplicationStatusMenu } from "@/components/applications/application-status-menu";
import { BranchOriginLabel } from "@/components/shared/branch-origin-label";
import { APPLICATION_STATUS_TRANSITIONS } from "@/lib/config/application";
import { PIPELINE_STAGE_ORDER, isPortalDrivenStage } from "@/lib/config/pipeline";
import { formatRelativeTime, getInitials } from "@/lib/format";
import { useCapability } from "@/lib/auth/use-capability";
import type { Locale } from "@/i18n/config";

import type { ApplicationStatus, PipelineCard } from "@/types";

/**
 * ============================================================================
 * THE OPERATIONAL PIPELINE (26B-5A)
 * ============================================================================
 *
 * One board for the whole journey: prospects still working through the portal
 * beside applications ODL has formally received. ODL wants to be able to call
 * someone who stalled at Step 2, and that is impossible if the CRM only learns
 * about a customer once they finish.
 *
 * ----------------------------------------------------------------------------
 * ONE BOARD DOES NOT MEAN ONE KIND OF THING
 * ----------------------------------------------------------------------------
 * A lead and a formal application are shown together and treated differently
 * throughout: a lead has no official number, is not a row in the formal table,
 * carries phone and email because chasing it is the point, and cannot be moved
 * by staff. A submitted application shows its number, its advisor and its
 * branch, and staff decide where it goes next.
 *
 * ----------------------------------------------------------------------------
 * THE FIRST THREE COLUMNS ARE NOT STAFF-MOVABLE, ON PURPOSE
 * ----------------------------------------------------------------------------
 * Nuevo, Paso 2 and Paso 3 are statements about what the CUSTOMER has done, and
 * they are derived from the customer's own data on every read. A staff member
 * dragging a card into "Paso 3" would be asserting the applicant uploaded
 * documents they did not — and the assertion would silently vanish on the next
 * refresh anyway. So those cards have no status control at all, rather than one
 * that appears to work and does not.
 */

interface PipelineKanbanProps {
  cards: PipelineCard[];
  onStatusChange: (applicationId: string, status: ApplicationStatus) => void;
}

export function PipelineKanban({ cards, onStatusChange }: PipelineKanbanProps) {
  const canSetApplicationStatus = useCapability("application:set_status");
  const t = useTranslations();

  return (
    // Horizontal scroll rather than wrapping: seven columns cannot fit a phone,
    // and a board that reflows into a single column stops being a board.
    <div className="flex gap-4 overflow-x-auto pb-2">
      {PIPELINE_STAGE_ORDER.map((stage) => {
        const columnCards = cards.filter((card) => card.stage === stage);

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
              {columnCards.map((card) =>
                card.kind === "lead" ? (
                  <LeadCard key={card.id} card={card} />
                ) : (
                  <ApplicationCard
                    key={card.id}
                    card={card}
                    canSetApplicationStatus={canSetApplicationStatus}
                    onStatusChange={onStatusChange}
                  />
                )
              )}

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
  );
}

/**
 * A prospect still in the portal.
 *
 * Contact details are on the face of the card because the entire reason for
 * capturing leads this early is that someone can pick up the phone. No official
 * number appears, because there is not one.
 */
function LeadCard({ card }: { card: PipelineCard }) {
  const locale = useLocale() as Locale;
  const t = useTranslations();

  return (
    <Card className="gap-3">
      <CardContent className="space-y-2.5">
        <div className="flex items-start justify-between gap-2">
          {/* A lead has no application dossier to open — it is not an
              application yet — so this goes to the prospect's own profile. */}
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

        <p className="text-xs text-muted-foreground">{card.productName[locale]}</p>

        {/* Selectable so an advisor can copy a number straight into a dialler. */}
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

        {/* What they have actually finished — never colour alone. */}
        <p className="text-[11px] font-medium text-foreground">
          {t(`pipeline.leadProgress.${card.stage}` as "pipeline.leadProgress.nuevo")}
        </p>

        {/* MILESTONE 26B-5B — DOCUMENT PROGRESS IS A PASO 3 CONCERN.
            Requirement slots are snapshotted when the application is created,
            so a prospect who has only finished Step 2 already has four of them
            and the card read "0/4 recibidos" — reporting a deficiency against a
            stage the customer has not reached, and making a perfectly on-track
            lead look neglected. The counter appears once documents are actually
            what this person is working on. */}
        {card.stage === "paso_3" && card.documentsRequired > 0 && (
          <p className="text-[11px] text-muted-foreground tabular-nums">
            {t("applications.documentsReceivedShort", {
              received: card.documentsReceived,
              total: card.documentsRequired,
            })}
          </p>
        )}

        <p className="text-[11px] text-muted-foreground">
          {formatRelativeTime(card.lastActivityAt, locale, t)}
        </p>
      </CardContent>
    </Card>
  );
}

/** A formally received application. */
function ApplicationCard({
  card,
  canSetApplicationStatus,
  onStatusChange,
}: {
  card: PipelineCard;
  canSetApplicationStatus: boolean;
  onStatusChange: (applicationId: string, status: ApplicationStatus) => void;
}) {
  const locale = useLocale() as Locale;
  const t = useTranslations();
  const legalTargets = APPLICATION_STATUS_TRANSITIONS[card.status];
  const receivedPercent =
    card.documentsRequired > 0
      ? Math.round((card.documentsReceived / card.documentsRequired) * 100)
      : 0;

  return (
    <Card className="gap-3">
      <CardContent className="space-y-3">
        <div>
          <Link
            href={`/solicitudes/${card.id}`}
            className="rounded-sm font-mono text-sm font-medium text-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {card.applicationNumber}
          </Link>
          <p className="mt-0.5 text-xs text-muted-foreground">{card.fullName}</p>
        </div>

        <p className="text-xs text-muted-foreground">{card.productName[locale]}</p>

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

        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <Avatar className="size-5">
              <AvatarFallback className="bg-primary/10 text-[10px] font-semibold text-primary">
                {card.advisorFullName ? getInitials(card.advisorFullName) : "—"}
              </AvatarFallback>
            </Avatar>
            <span className="truncate text-[11px] text-muted-foreground">
              {card.advisorFullName ?? t("common.unassigned")}
            </span>
          </div>
          <span className="shrink-0 text-[11px] text-muted-foreground">
            {formatRelativeTime(card.lastActivityAt, locale, t)}
          </span>
        </div>

        <BranchOriginLabel origin={card.branchOrigin} />

        {/* Only formal applications get a status control, and only when the
            viewer holds the capability — the menu is the same authorized action
            the table uses, not a second path around it. */}
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
