"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  Lock,
  MessageSquarePlus,
  MinusCircle,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { useCapability } from "@/lib/auth/use-capability";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  REVIEW_ITEM_STATES,
  REVIEW_OBSERVATION_CATEGORIES,
  REVIEW_RECOMMENDATIONS,
  REVIEW_SECTIONS,
  recommendationRequiresNote,
  type ReviewItemState,
  type ReviewObservationCategory,
  type ReviewRecommendation,
} from "@/lib/config/application-review";
import { APPLICATION_STATUS_TRANSITIONS } from "@/lib/config/application";
import {
  addReviewObservationAction,
  completeReviewAction,
  reopenReviewAction,
  setReviewItemStateAction,
  setReviewRecommendationAction,
  setSolicitudApplicationStatus,
  approveSolicitudWithAmount,
  type ReviewActionResult,
} from "@/app/(app)/solicitudes/actions";
import type { ApplicationReviewView, ReviewItemView } from "@/lib/services/application-review";
import type { ApplicationStatus } from "@/types";
import type { Locale } from "@/i18n/config";

/**
 * ============================================================================
 * MILESTONE 26B-10 — THE MANUAL REVIEW WORKSPACE
 * ============================================================================
 *
 * Where a member of staff records what they checked, what they found and what
 * they think — and where somebody with the authority decides.
 *
 * ----------------------------------------------------------------------------
 * NOTHING ON THIS SCREEN IS COMPUTED ABOUT THE APPLICANT
 * ----------------------------------------------------------------------------
 * There is no score, no percentage, no probability, no risk band and no colour
 * gradient standing in for one. The only numbers shown are counts of unanswered
 * questions and unresolved documents, which are facts about the REVIEW's
 * progress, not judgements about the person. Nothing here consults a list,
 * screens a name, or reaches an opinion; every conclusion is typed by a human
 * and attributed to them.
 *
 * ----------------------------------------------------------------------------
 * TWO CAPABILITIES, VISIBLY SEPARATE
 * ----------------------------------------------------------------------------
 * `evidence:review` (administrador, gerente, compliance) works the review.
 * `application:set_status` (administrador, gerente) decides the loan. They are
 * rendered as two distinct blocks with different headings because they are two
 * different acts: a compliance reviewer can finish a review recommending approval and
 * still have no approval control on screen — and the Server Action would refuse
 * them if they forged one.
 *
 * RECOMMENDATION IS NOT DECISION, and the layout says so: the decision block
 * shows the recommendation as INPUT to be considered, never as a default, a
 * pre-selection or a suggested button.
 */

export interface ApplicationReviewPanelProps {
  applicationId: string;
  applicationStatus: ApplicationStatus;
  review: ApplicationReviewView;
  /** MILESTONE 26B-23D — the customer's figure, so the decision block can show
   * it beside the one being decided and warn when the second exceeds it. */
  requestedAmount: number;
  /** Undefined until ODL has decided one. Never a placeholder. */
  approvedAmount?: number;
}

const ITEM_STATE_ICON = {
  pending: CircleDashed,
  verified: CheckCircle2,
  issue: AlertTriangle,
  not_applicable: MinusCircle,
} as const;

const ITEM_STATE_CLASS: Record<ReviewItemState, string> = {
  pending: "text-muted-foreground",
  verified: "text-success",
  issue: "text-destructive",
  not_applicable: "text-muted-foreground",
};

const REVIEW_STATUS_BADGE: Record<string, string> = {
  not_started: "bg-muted text-muted-foreground border-border",
  in_progress: "bg-navy/10 text-navy border-navy/20",
  completed: "bg-success/15 text-success border-success/20",
};

export function ApplicationReviewPanel({
  applicationId,
  applicationStatus,
  review: initialReview,
  requestedAmount,
  approvedAmount,
}: ApplicationReviewPanelProps) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const canReview = useCapability("evidence:review");
  const canDecide = useCapability("application:set_status");

  const [review, setReview] = useState(initialReview);
  const [isPending, startTransition] = useTransition();

  // Read-only for anyone without `evidence:review` — an asesor may see the
  // state of the review on their own file without being able to alter it.
  const locked = !canReview || review.status === "completed";

  const apply = (run: () => Promise<ReviewActionResult>) => {
    startTransition(async () => {
      const result = await run();
      if (result.status === "success") {
        setReview(result.review);
        return;
      }
      if (result.status === "blocked") {
        // Named, not vague: the reviewer is told exactly which conditions are
        // unmet so they can go and meet them.
        toast.error(
          t("review.blockedToast", {
            list: result.blockers
              .map((blocker) => t(`review.blockers.${blocker}` as "review.blockers.documents_rejected"))
              .join(" · "),
          })
        );
        return;
      }
      toast.error(t(`review.errors.${result.code}` as "review.errors.SAVE_FAILED"));
    });
  };

  return (
    <section className="flex flex-col gap-4" aria-label={t("review.sectionTitle")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
          <ClipboardCheck className="size-4 text-muted-foreground" aria-hidden="true" />
          {t("review.sectionTitle")}
        </h2>
        <StatusBadge
          label={t(`review.statuses.${review.status}` as "review.statuses.in_progress")}
          className={REVIEW_STATUS_BADGE[review.status]}
        />
      </div>

      <SummaryCard review={review} locale={locale} />

      <AttentionCard review={review} />

      <ChecklistCard review={review} locked={locked} busy={isPending} apply={apply} applicationId={applicationId} />

      <ObservationsCard
        review={review}
        locale={locale}
        canWrite={canReview}
        busy={isPending}
        apply={apply}
        applicationId={applicationId}
      />

      {canReview && (
        <RecommendationCard
          review={review}
          locale={locale}
          locked={review.status === "completed"}
          busy={isPending}
          apply={apply}
          applicationId={applicationId}
        />
      )}

      {canReview && (
        <CompletionCard review={review} busy={isPending} apply={apply} applicationId={applicationId} />
      )}

      {canDecide && (
        <DecisionCard
          review={review}
          applicationId={applicationId}
          applicationStatus={applicationStatus}
          requestedAmount={requestedAmount}
          approvedAmount={approvedAmount}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------------- */

function Panel({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}

function SummaryCard({ review, locale }: { review: ApplicationReviewView; locale: Locale }) {
  const t = useTranslations();
  return (
    <Panel title={t("review.summaryTitle")}>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        <SummaryFact label={t("review.reviewer")} value={review.reviewerFullName} />
        <SummaryFact
          label={t("review.startedAt")}
          value={review.startedAt ? formatDateTime(review.startedAt, locale) : undefined}
        />
        <SummaryFact
          label={t("review.updatedAt")}
          value={review.updatedAt ? formatDateTime(review.updatedAt, locale) : undefined}
        />
        <SummaryFact
          label={t("review.recommendationLabel")}
          value={t(
            `review.recommendations.${review.recommendation}` as "review.recommendations.pending"
          )}
        />
        <SummaryFact label={t("review.recommendedBy")} value={review.recommendationByFullName} />
        <SummaryFact
          label={t("review.completedAt")}
          value={review.completedAt ? formatDateTime(review.completedAt, locale) : undefined}
        />
      </dl>

      {review.recommendationNote && (
        <p className="rounded-lg bg-muted/60 px-3 py-2 text-sm break-words text-foreground">
          {review.recommendationNote}
        </p>
      )}

      {/* Documents, read from the one place this system counts them. Two
          numbers, never merged: received is what the customer sent, reviewed is
          what staff concluded. */}
      <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-border pt-3">
        <p className="text-sm text-foreground tabular-nums">
          <span className="text-muted-foreground">{t("review.documentsReceived")} </span>
          {t("review.ofTotal", { count: review.documents.received, total: review.documents.total })}
        </p>
        <p className="text-sm text-foreground tabular-nums">
          <span className="text-muted-foreground">{t("review.documentsReviewed")} </span>
          {t("review.ofTotal", { count: review.documents.reviewed, total: review.documents.total })}
        </p>
        {review.documents.rejected > 0 && (
          <p className="text-sm font-medium text-destructive tabular-nums">
            {t("review.documentsRejected", { count: review.documents.rejected })}
          </p>
        )}
      </div>
    </Panel>
  );
}

function SummaryFact({ label, value }: { label: string; value?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="text-sm font-medium break-words text-foreground">{value ?? "—"}</dd>
    </div>
  );
}

/**
 * What is still open.
 *
 * A LIST OF UNRESOLVED CONDITIONS, NOT A RISK PANEL. Each line is a count of
 * something a person has not yet answered or cleared. There is no severity
 * ordering, no total, and nothing here says anything about the applicant — a
 * customer whose file is merely incomplete must never be made to look like a
 * problem.
 */
function AttentionCard({ review }: { review: ApplicationReviewView }) {
  const t = useTranslations();
  const { attention } = review;

  const lines: { key: string; text: string }[] = [];
  if (attention.pendingRequiredItems > 0) {
    lines.push({
      key: "pending",
      text: t("review.attention.pendingItems", { count: attention.pendingRequiredItems }),
    });
  }
  if (attention.issueItems > 0) {
    lines.push({ key: "issues", text: t("review.attention.issues", { count: attention.issueItems }) });
  }
  if (attention.documentsAwaitingReview > 0) {
    lines.push({
      key: "docs",
      text: t("review.attention.documentsAwaiting", { count: attention.documentsAwaitingReview }),
    });
  }
  if (attention.rejectedDocuments > 0) {
    lines.push({
      key: "rejected",
      text: t("review.attention.documentsRejected", { count: attention.rejectedDocuments }),
    });
  }
  if (attention.recommendationPending) {
    lines.push({ key: "recommendation", text: t("review.attention.recommendationPending") });
  }

  return (
    <Panel title={t("review.attentionTitle")} description={t("review.attentionSubtitle")}>
      {lines.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-success">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          {t("review.attention.none")}
        </p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {lines.map((line) => (
            <li key={line.key} className="flex items-start gap-2 text-sm text-foreground">
              <AlertTriangle
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              {line.text}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ---- Checklist ---------------------------------------------------------- */

function ChecklistCard({
  review,
  locked,
  busy,
  apply,
  applicationId,
}: {
  review: ApplicationReviewView;
  locked: boolean;
  busy: boolean;
  apply: (run: () => Promise<ReviewActionResult>) => void;
  applicationId: string;
}) {
  const t = useTranslations();
  const [issueFor, setIssueFor] = useState<ReviewItemView | null>(null);

  const setState = (item: ReviewItemView, state: ReviewItemState) => {
    // An issue must be explained. Rather than failing the click, the dialog
    // collects the reason and submits both together.
    if (state === "issue") {
      setIssueFor(item);
      return;
    }
    apply(() =>
      setReviewItemStateAction({ applicationId, itemCode: item.code, state, note: undefined })
    );
  };

  return (
    <Panel title={t("review.checklistTitle")} description={t("review.checklistSubtitle")}>
      {locked && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock className="size-3.5" aria-hidden="true" />
          {review.status === "completed" ? t("review.lockedCompleted") : t("review.lockedNoAccess")}
        </p>
      )}

      <div className="flex flex-col gap-4">
        {REVIEW_SECTIONS.map((section) => {
          const items = review.items.filter((item) => item.section === section);
          if (items.length === 0) return null;
          return (
            <div key={section} className="flex flex-col gap-2">
              <h4 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                {t(`review.sections.${section}` as "review.sections.identification")}
              </h4>
              <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                {items.map((item) => (
                  <ChecklistRow
                    key={item.code}
                    item={item}
                    locked={locked}
                    busy={busy}
                    onChange={(state) => setState(item, state)}
                  />
                ))}
              </ul>
            </div>
          );
        })}
      </div>

      <IssueDialog
        item={issueFor}
        busy={busy}
        onClose={() => setIssueFor(null)}
        onSubmit={(note) => {
          const item = issueFor;
          if (!item) return;
          setIssueFor(null);
          apply(() =>
            setReviewItemStateAction({
              applicationId,
              itemCode: item.code,
              state: "issue",
              note,
            })
          );
        }}
      />
    </Panel>
  );
}

function ChecklistRow({
  item,
  locked,
  busy,
  onChange,
}: {
  item: ReviewItemView;
  locked: boolean;
  busy: boolean;
  onChange: (state: ReviewItemState) => void;
}) {
  const t = useTranslations();
  const Icon = ITEM_STATE_ICON[item.state];

  return (
    <li className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <span className="flex min-w-0 items-start gap-2">
        {/* Icon AND word — state is never carried by colour alone. */}
        <Icon
          className={cn("mt-0.5 size-4 shrink-0", ITEM_STATE_CLASS[item.state])}
          aria-hidden="true"
        />
        <span className="min-w-0">
          <span className="block text-sm text-foreground">
            {t(`review.items.${item.code}` as "review.items.identity_document_received")}
            {item.requiredForCompletion && (
              <span className="ml-1 text-destructive" aria-hidden="true">
                *
              </span>
            )}
          </span>
          {item.note && (
            <span className="mt-0.5 block text-xs break-words text-muted-foreground">
              {item.note}
            </span>
          )}
          {item.updatedByFullName && (
            <span className="mt-0.5 block text-[11px] text-muted-foreground">
              {t("review.itemBy", { name: item.updatedByFullName })}
            </span>
          )}
        </span>
      </span>

      <Select
        value={item.state}
        disabled={locked || busy}
        onValueChange={(value) => value && onChange(value as ReviewItemState)}
      >
        <SelectTrigger className="w-full shrink-0 sm:w-48">
          <SelectValue>
            {(value: string) =>
              t(`review.itemStates.${value as ReviewItemState}` as "review.itemStates.pending")
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {REVIEW_ITEM_STATES.map((state) => (
            <SelectItem key={state} value={state}>
              {t(`review.itemStates.${state}` as "review.itemStates.pending")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </li>
  );
}

/** Collects the mandatory explanation for an `issue`. Remounted per item so a
 * previous item's text can never be submitted against another. */
function IssueDialog({
  item,
  busy,
  onClose,
  onSubmit,
}: {
  item: ReviewItemView | null;
  busy: boolean;
  onClose: () => void;
  onSubmit: (note: string) => void;
}) {
  const t = useTranslations();
  const [note, setNote] = useState("");

  if (!item) return null;

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) {
          setNote("");
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("review.issueDialogTitle")}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">
            {t(`review.items.${item.code}` as "review.items.identity_document_received")}
          </p>
          <Label htmlFor="issue-note">{t("review.issueNoteLabel")}</Label>
          <Textarea
            id="issue-note"
            rows={4}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t("review.issueNotePlaceholder")}
          />
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setNote("");
              onClose();
            }}
            disabled={busy}
          >
            {t("common.cancel")}
          </Button>
          <Button onClick={() => onSubmit(note)} disabled={busy || !note.trim()}>
            {t("review.issueSubmit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---- Observations ------------------------------------------------------- */

function ObservationsCard({
  review,
  locale,
  canWrite,
  busy,
  apply,
  applicationId,
}: {
  review: ApplicationReviewView;
  locale: Locale;
  canWrite: boolean;
  busy: boolean;
  apply: (run: () => Promise<ReviewActionResult>) => void;
  applicationId: string;
}) {
  const t = useTranslations();
  const [category, setCategory] = useState<ReviewObservationCategory>("general");
  const [body, setBody] = useState("");

  const submit = () => {
    const text = body;
    setBody("");
    apply(() => addReviewObservationAction({ applicationId, category, body: text }));
  };

  return (
    <Panel title={t("review.observationsTitle")} description={t("review.observationsSubtitle")}>
      {canWrite && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select
              value={category}
              onValueChange={(value) => value && setCategory(value as ReviewObservationCategory)}
            >
              <SelectTrigger className="w-full sm:w-52">
                <SelectValue>
                  {(value: string) =>
                    t(
                      `review.observationCategories.${value as ReviewObservationCategory}` as "review.observationCategories.general"
                    )
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {REVIEW_OBSERVATION_CATEGORIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {t(
                      `review.observationCategories.${value}` as "review.observationCategories.general"
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={t("review.observationPlaceholder")}
              className="flex-1"
            />
            <Button onClick={submit} disabled={busy || !body.trim()}>
              <MessageSquarePlus className="size-4" />
              {t("review.observationAdd")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("review.observationsAppendOnly")}</p>
        </div>
      )}

      {review.observations.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("review.observationsEmpty")}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {review.observations.map((observation) => (
            <li key={observation.id} className="flex flex-col gap-1 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {t(
                    `review.observationCategories.${observation.category}` as "review.observationCategories.general"
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {observation.authorFullName} · {formatDateTime(observation.createdAt, locale)}
                </span>
              </div>
              <p className="text-sm break-words text-foreground">{observation.body}</p>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ---- Recommendation ----------------------------------------------------- */

function RecommendationCard({
  review,
  locale,
  locked,
  busy,
  apply,
  applicationId,
}: {
  review: ApplicationReviewView;
  locale: Locale;
  locked: boolean;
  busy: boolean;
  apply: (run: () => Promise<ReviewActionResult>) => void;
  applicationId: string;
}) {
  const t = useTranslations();
  const [recommendation, setRecommendation] = useState<ReviewRecommendation>(review.recommendation);
  const [note, setNote] = useState(review.recommendationNote ?? "");

  const needsNote = recommendationRequiresNote(recommendation);
  const missingNote = needsNote && !note.trim();
  // Nothing on screen differs from what is stored, so there is nothing to save.
  const changed =
    recommendation !== review.recommendation || note !== (review.recommendationNote ?? "");

  // ---- WHY THE BUTTON IS DISABLED, SAID OUT LOUD ------------------------
  //
  // A silent disabled button is indistinguishable from a broken one. QA
  // reported "Requiere más información" as unsaveable when it had in fact
  // already saved: the screen matched the stored record, `changed` was false,
  // and picking any OTHER recommendation lit the button up again — which reads
  // exactly like a defect specific to that one option.
  //
  // The guard itself is right and stays: re-saving an identical recommendation
  // would stamp a new timestamp and write a second audit event for a decision
  // nobody changed. What was missing was the reason.
  //
  // "Already saved" is claimed only when a recommendation genuinely IS on
  // record — `recommendationAt` is set solely by a real save — so this can
  // never tell a reviewer their work is saved when it is not.
  const disabledReason = missingNote
    ? t("review.recommendationNeedsNoteHint")
    : !changed && review.recommendationAt
      ? t("review.recommendationAlreadySaved")
      : null;

  return (
    <Panel title={t("review.recommendationTitle")} description={t("review.recommendationSubtitle")}>
      {review.recommendationAt && (
        <p className="text-xs text-muted-foreground">
          {t("review.recommendationRecorded", {
            name: review.recommendationByFullName ?? "—",
            when: formatDateTime(review.recommendationAt, locale),
          })}
        </p>
      )}

      <div className="flex flex-col gap-2">
        <Label htmlFor="recommendation-select">{t("review.recommendationLabel")}</Label>
        <Select
          value={recommendation}
          disabled={locked || busy}
          onValueChange={(value) => value && setRecommendation(value as ReviewRecommendation)}
        >
          <SelectTrigger id="recommendation-select" className="w-full sm:w-72">
            <SelectValue>
              {(value: string) =>
                t(
                  `review.recommendations.${value as ReviewRecommendation}` as "review.recommendations.pending"
                )
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {REVIEW_RECOMMENDATIONS.map((value) => (
              <SelectItem key={value} value={value}>
                {t(`review.recommendations.${value}` as "review.recommendations.pending")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="recommendation-note">
          {needsNote ? t("review.recommendationNoteRequired") : t("review.recommendationNote")}
        </Label>
        <Textarea
          id="recommendation-note"
          rows={3}
          value={note}
          disabled={locked || busy}
          onChange={(event) => setNote(event.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {disabledReason && (
          <p className="mr-auto text-xs text-muted-foreground">{disabledReason}</p>
        )}
        <Button
          disabled={locked || busy || !changed || missingNote}
          onClick={() =>
            apply(() =>
              setReviewRecommendationAction({ applicationId, recommendation, note })
            )
          }
        >
          {t("review.recommendationSave")}
        </Button>
      </div>
    </Panel>
  );
}

/* ---- Completion --------------------------------------------------------- */

function CompletionCard({
  review,
  busy,
  apply,
  applicationId,
}: {
  review: ApplicationReviewView;
  busy: boolean;
  apply: (run: () => Promise<ReviewActionResult>) => void;
  applicationId: string;
}) {
  const t = useTranslations();
  const [reopening, setReopening] = useState(false);
  const [reason, setReason] = useState("");

  if (review.status === "completed") {
    return (
      <Panel title={t("review.completionTitle")} description={t("review.completedBy", {
        name: review.completedByFullName ?? "—",
      })}>
        <div className="flex justify-end">
          <Button variant="outline" onClick={() => setReopening(true)} disabled={busy}>
            <RotateCcw className="size-4" />
            {t("review.reopen")}
          </Button>
        </div>

        <Dialog open={reopening} onOpenChange={(next) => !next && setReopening(false)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{t("review.reopenDialogTitle")}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-2">
              <p className="text-sm text-muted-foreground">{t("review.reopenExplanation")}</p>
              <Label htmlFor="reopen-reason">{t("review.reopenReasonLabel")}</Label>
              <Textarea
                id="reopen-reason"
                rows={3}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReopening(false)} disabled={busy}>
                {t("common.cancel")}
              </Button>
              <Button
                disabled={busy || !reason.trim()}
                onClick={() => {
                  const value = reason;
                  setReason("");
                  setReopening(false);
                  apply(() => reopenReviewAction({ applicationId, reason: value }));
                }}
              >
                {t("review.reopenConfirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Panel>
    );
  }

  return (
    <Panel title={t("review.completionTitle")} description={t("review.completionSubtitle")}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {review.canComplete ? t("review.completionReady") : t("review.completionNotReady")}
        </p>
        {/* Disabled is a courtesy; completeReview re-evaluates every condition
            against the live record and refuses regardless of this button. */}
        <Button
          disabled={busy || !review.canComplete}
          onClick={() => apply(() => completeReviewAction(applicationId))}
        >
          <CheckCircle2 className="size-4" />
          {t("review.complete")}
        </Button>
      </div>
    </Panel>
  );
}

/* ---- Decision ----------------------------------------------------------- */

/**
 * The lending decision.
 *
 * REUSES THE EXISTING STATUS MACHINERY ENTIRELY — `setSolicitudApplicationStatus`,
 * gated on `application:set_status`, writing through
 * `record_application_status_change` with its own audit event. There is no
 * second approval path, no review-owned status column, and no way for anything
 * in the review to move an application by itself.
 *
 * THE LEGAL TARGETS COME FROM `APPLICATION_STATUS_TRANSITIONS`, the same table
 * the server enforces. An application that is not `in_review` offers no buttons
 * here because there is nothing legal to offer.
 *
 * THE RECOMMENDATION IS SHOWN, NOT APPLIED. It appears as a line of context
 * above the buttons; nothing is pre-selected, nothing is highlighted as the
 * suggested action, and a decision-maker who disagrees clicks the other button
 * with no friction. A completed review is not required either — the decision
 * belongs to the person holding the capability, not to a workflow gate.
 */
function DecisionCard({
  review,
  applicationId,
  applicationStatus,
  requestedAmount,
  approvedAmount,
}: {
  review: ApplicationReviewView;
  applicationId: string;
  applicationStatus: ApplicationStatus;
  requestedAmount: number;
  approvedAmount?: number;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  /**
   * MILESTONE 26B-23D — APROBAR PIDE UNA CIFRA.
   *
   * "idle" son los botones de siempre. "amount" es el formulario del monto, y
   * "exceeds" la segunda confirmación que solo aparece cuando lo aprobado supera
   * lo solicitado. Nada de esto toca el servidor: mientras el paso no es "sent",
   * la solicitud sigue exactamente como estaba.
   */
  const [step, setStep] = useState<"idle" | "amount" | "exceeds">("idle");
  const [amountText, setAmountText] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);

  // MILESTONE 26B-23B.2 — EL ESTADO SE LEE, NO SE COPIA.
  //
  // Esto era `useState(applicationStatus)`, y una copia sólo sabe lo que sabía
  // cuando se creó. Servía para la única transición que este bloque provoca él
  // mismo, y mentía sobre cualquier otra: al formalizar desde el panel de
  // 26B-23B, la cabecera pasaba a "En evaluación" y este bloque seguía diciendo
  // que la solicitud era un borrador que no admite cambios de estado, hasta que
  // alguien recargaba a mano. Un `useEffect` que sincronizara la copia sería
  // arreglar el síntoma manteniendo las dos verdades.
  //
  // Ahora la prop del servidor es la única. `decide` ya vive dentro de una
  // transición que incluye el `router.refresh()`, así que `isPending` cubre la
  // ventana entre la acción y el nuevo render: los botones quedan desactivados
  // en vez de mostrar brevemente el estado anterior como si fuera actual.
  const targets = APPLICATION_STATUS_TRANSITIONS[applicationStatus];

  const decide = (target: ApplicationStatus) => {
    startTransition(async () => {
      const result = await setSolicitudApplicationStatus({ applicationId, status: target });
      if (result.status === "success") {
        toast.success(t("review.decisionRecorded"));
        // La decisión cambia el estado OFICIAL de la solicitud, y ese estado se
        // pinta en varios sitios de esta página que el servidor ya había
        // renderizado — la insignia de la cabecera, y ahora también los botones
        // de aquí. Sin esto la cabecera seguía diciendo "En evaluación" después
        // de aprobar, hasta que alguien recargaba a mano.
        //
        // Se refresca la ruta en vez de duplicar el estado en el cliente: el
        // servidor vuelve a ser la única fuente de verdad del estado, que es
        // justo lo que debe ser para una decisión de crédito.
        router.refresh();
        return;
      }
      toast.error(t(`review.errors.${result.code}` as "review.errors.SAVE_FAILED"));
    });
  };

  /**
   * El mismo contrato monetario que el servidor, repetido aquí para dar un
   * mensaje concreto en vez de un fallo genérico. El servidor sigue siendo la
   * autoridad: valida otra vez, y la función de base de datos otra más.
   *
   * Nada se redondea ni se corrige en silencio. Un tercer decimal es un error
   * de quien escribe, no algo que este formulario deba decidir por él.
   */
  const parseAmount = (): number | null => {
    const raw = amountText.trim().replace(/,/g, "");
    if (raw === "") {
      setAmountError(t("review.approveAmountRequired"));
      return null;
    }
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
      setAmountError(t("review.approveAmountInvalid"));
      return null;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      setAmountError(t("review.approveAmountInvalid"));
      return null;
    }
    if (value > 99_999_999.99) {
      setAmountError(t("review.approveAmountTooLarge"));
      return null;
    }
    setAmountError(null);
    return value;
  };

  const approve = (amount: number) => {
    startTransition(async () => {
      const result = await approveSolicitudWithAmount({ applicationId, approvedAmount: amount });
      if (result.status === "success") {
        setStep("idle");
        setAmountText("");
        toast.success(
          t("review.approveSuccess", { amount: formatCurrency(amount) })
        );
        router.refresh();
        return;
      }
      toast.error(
        result.code === "INVALID_TRANSITION"
          ? t("review.approveErrorTransition")
          : result.code === "INVALID_AMOUNT"
            ? t("review.approveAmountInvalid")
            : t("review.approveError")
      );
    });
  };

  // Se recalcula en cada render a partir de lo escrito, para que el aviso y la
  // etiqueta del botón no puedan quedarse describiendo una cifra anterior.
  const typedAmount = /^\d+(\.\d{1,2})?$/.test(amountText.trim().replace(/,/g, ""))
    ? Number(amountText.trim().replace(/,/g, ""))
    : undefined;
  const exceedsRequested = typedAmount !== undefined && typedAmount > requestedAmount;

  const cancel = () => {
    setStep("idle");
    setAmountText("");
    setAmountError(null);
  };

  return (
    <Panel title={t("review.decisionTitle")} description={t("review.decisionSubtitle")}>
      {/* MILESTONE 26B-23D — las dos cifras, siempre juntas y siempre
          etiquetadas. Ninguna sustituye a la otra: lo solicitado es del cliente
          y lo aprobado es de ODL, y un expediente que mostrara una sola dejaría
          al lector sin saber cuál está viendo. El monto aprobado solo aparece
          cuando existe; no hay marcador de posición para una decisión que
          todavía no se ha tomado. */}
      <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
        <div>
          <dt className="text-muted-foreground">{t("review.approveRequestedLabel")}</dt>
          <dd className="font-medium text-foreground">{formatCurrency(requestedAmount)}</dd>
        </div>
        {approvedAmount !== undefined && (
          <div>
            <dt className="text-muted-foreground">{t("review.approvedAmountLabel")}</dt>
            <dd className="font-medium text-foreground">{formatCurrency(approvedAmount)}</dd>
          </div>
        )}
      </dl>

      <p className="text-sm text-muted-foreground">
        {t("review.decisionContext", {
          recommendation: t(
            `review.recommendations.${review.recommendation}` as "review.recommendations.pending"
          ),
        })}
      </p>

      {targets.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("review.decisionNoTargets", {
            status: t(
              `statuses.applicationStatus.${applicationStatus}` as "statuses.applicationStatus.new"
            ),
          })}
        </p>
      ) : step === "idle" ? (
        <div className="flex flex-wrap gap-2">
          {targets.map((target) => (
            <Button
              key={target}
              variant={target === "approved" ? "default" : "outline"}
              disabled={isPending}
              // MILESTONE 26B-23D — aprobar ya no decide nada por sí solo: abre
              // el formulario del monto. Los demás destinos (no aprobar,
              // cancelar) conservan exactamente el camino de siempre, porque no
              // llevan cifra asociada y nada de esto les concierne.
              onClick={() => (target === "approved" ? setStep("amount") : decide(target))}
            >
              {t(`review.decisionSetTo.${target}` as "review.decisionSetTo.approved")}
            </Button>
          ))}
        </div>
      ) : step === "amount" ? (
        <div className="flex max-w-md flex-col gap-3 rounded-lg border border-border bg-muted/30 p-4">
          <div>
            <h4 className="text-sm font-semibold text-foreground">{t("review.approveTitle")}</h4>
            <p className="mt-1 text-sm text-muted-foreground">{t("review.approveExplanation")}</p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`approved-amount-${applicationId}`}>
              {t("review.approveAmountLabel")}
            </Label>
            {/* Empieza VACÍO y nunca se precarga con lo solicitado: rellenarlo
                sería sugerir una respuesta a una decisión que no es nuestra. */}
            <Input
              id={`approved-amount-${applicationId}`}
              inputMode="decimal"
              autoComplete="off"
              placeholder={t("review.approveAmountPlaceholder")}
              value={amountText}
              disabled={isPending}
              aria-invalid={Boolean(amountError)}
              onChange={(e) => {
                setAmountText(e.target.value);
                if (amountError) setAmountError(null);
              }}
            />
            {amountError && <p className="text-xs text-destructive">{amountError}</p>}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              disabled={isPending}
              onClick={() => {
                const value = parseAmount();
                if (value === null) return;
                // Superar lo solicitado nunca se aprueba en este clic: pasa a la
                // confirmación explícita. Por debajo o igual, este clic ES la
                // confirmación, y la etiqueta lo dice.
                if (value > requestedAmount) setStep("exceeds");
                else approve(value);
              }}
            >
              {exceedsRequested ? t("review.approveContinue") : t("review.approveConfirm")}
            </Button>
            <Button variant="ghost" disabled={isPending} onClick={cancel}>
              {t("review.approveCancel")}
            </Button>
          </div>
        </div>
      ) : (
        <div
          role="alert"
          className="flex max-w-md flex-col gap-3 rounded-lg border border-warning/40 bg-warning/[0.07] p-4"
        >
          {/* MILESTONE 26B-23D — no es un bloqueo. ODL permite aprobar más de lo
              pedido; lo que no permite es hacerlo sin darse cuenta. */}
          <div className="flex gap-2.5">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
            <div>
              <p className="text-sm font-semibold text-foreground">
                {t("review.approveExceedsWarningTitle")}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("review.approveExceedsWarningBody", {
                  requested: formatCurrency(requestedAmount),
                  approved: typedAmount !== undefined ? formatCurrency(typedAmount) : "—",
                })}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              disabled={isPending}
              onClick={() => {
                // Se vuelve a validar lo escrito en vez de confiar en lo que se
                // calculó al pasar de paso: el campo sigue siendo la fuente.
                const value = parseAmount();
                if (value === null) {
                  setStep("amount");
                  return;
                }
                approve(value);
              }}
            >
              {t("review.approveExceedsConfirm")}
            </Button>
            <Button variant="ghost" disabled={isPending} onClick={() => setStep("amount")}>
              {t("review.approveCancel")}
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}
