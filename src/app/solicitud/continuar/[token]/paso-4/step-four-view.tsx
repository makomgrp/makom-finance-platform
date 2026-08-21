"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AlertCircle, Check, Loader2, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PortalProgress } from "@/components/portal/portal-progress";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { savePortalDeclarations, submitPortalApplicationAction } from "./actions";
import type { LocalizedText, PortalStep, SourceOfFundsCategory } from "@/types";
import type { Locale } from "@/i18n/config";

/**
 * ============================================================================
 * STEP 4 — REVIEW, DECLARE, SUBMIT (26B-4)
 * ============================================================================
 *
 * The applicant reads back everything they told ODL, answers three compliance
 * questions, and sends the application.
 *
 * ----------------------------------------------------------------------------
 * DECLARATIONS ARE SAVED ONCE, ON PURPOSE
 * ----------------------------------------------------------------------------
 * There is no auto-save here, and that is not an oversight. Declarations are
 * APPEND-ONLY (26A-4): every write is a new immutable revision recording the
 * exact wording accepted and when. Saving on each keystroke would bury the one
 * answer that matters under a hundred revisions of a half-typed sentence, and
 * would record "accepted" for text the customer was still writing. So the write
 * happens on a deliberate action — Enviar, or Guardar y continuar después —
 * which is also the only moment an acceptance is meaningfully being made.
 *
 * ----------------------------------------------------------------------------
 * SUBMITTING IS NOT APPROVAL
 * ----------------------------------------------------------------------------
 * The button says "Enviar solicitud" and the copy around it says the
 * application goes to ODL for review. Nothing on this screen states or implies
 * an outcome, an amount that will be granted, or a date. ODL has not decided
 * anything at the moment this is pressed.
 *
 * ----------------------------------------------------------------------------
 * THE DISABLED BUTTON IS A COURTESY, NOT THE GATE
 * ----------------------------------------------------------------------------
 * Client validation exists so nobody is bounced by a server error they could
 * have been warned about. The real gate re-derives completion server-side on
 * every attempt, so a manipulated client reaches exactly the same answer.
 */

/* ---------------------------------------------------------------------------
 * The review payload.
 *
 * A FLAT, EXPLICIT SHAPE rather than the domain objects. Everything the
 * applicant may see is listed here by name, so anything internal — branch,
 * advisor, status, risk flags, staff notes — cannot arrive by being added to a
 * type somewhere else. The bank account carries only `accountNumberLast4`,
 * matching 26A-2's summary type, which has no full number to leak.
 * ------------------------------------------------------------------------- */
export interface ReviewSnapshot {
  productCode: string;
  productName: LocalizedText;
  applicationNumber: string;

  applicant: {
    fullName?: string;
    email?: string;
    phone?: string;
    identificationType?: string;
    identificationNumber?: string;
  };
  loan: {
    requestedAmount?: number;
    requestedTermMonths?: number;
  };

  employment?: {
    employmentStatus: string;
    employerName?: string;
    jobTitle?: string;
    selfEmployedActivity?: string;
    startDate?: string;
    contractType?: string;
    monthlyIncome?: number;
    payrollDeductionAvailable?: string;
  };
  monthlyExpenses?: number;

  bankAccount?: {
    bankName: string;
    accountType: string;
    /** Rendered as ****1234. There is no full number in this object. */
    accountNumberLast4: string;
    receivesSalary?: boolean;
  };

  collateral?: {
    collateralType: string;
    vehicleMake?: string;
    vehicleModel?: string;
    vehicleYear?: number;
    vehiclePlate?: string;
    ownedByApplicant?: boolean;
    lienStatus?: string;
    lienBalance?: number;
    propertyType?: string;
    propertyLocation?: string;
  };

  business?: {
    legalName: string;
    tradeName?: string;
    economicActivity?: string;
    operationsStartDate?: string;
    registrationNumber?: string;
    averageMonthlyRevenue?: number;
    averageMonthlyExpenses?: number;
    loanPurpose?: string;
    purposeDescription?: string;
    applicantRelationship?: string;
  };

  obligations: {
    lenderName: string;
    outstandingBalance?: number;
    monthlyPayment?: number;
  }[];

  guarantor?: {
    fullName: string;
    email?: string;
    phone?: string;
  };

  documentGroups: {
    kind: string;
    completedCount: number;
    totalCount: number;
    tasks: {
      name: LocalizedText;
      required: boolean;
      isComplete: boolean;
      fileCount: number;
    }[];
  }[];
}

export interface InitialDeclarations {
  isPep?: boolean;
  pepDetails: string;
  sourceOfFundsCategory: string;
  sourceOfFundsDescription: string;
  creditConsentGranted: boolean;
}

const SOURCE_CATEGORIES: SourceOfFundsCategory[] = [
  "salary",
  "business_income",
  "savings",
  "sale_of_asset",
  "other",
];

const PEP_DETAILS_MAX = 500;
const SOURCE_DESCRIPTION_MAX = 500;

interface StepFourViewProps {
  continuationToken: string;
  snapshot: ReviewSnapshot;
  initialDeclarations: InitialDeclarations;
  /** From the single server evaluator. Undefined means ready to submit. */
  pendingStep?: PortalStep;
  /**
   * Whether every required DOCUMENT is uploaded — which is not the same as the
   * evaluator's `documents` step being complete. See `blockedByEarlierStep`.
   */
  documentsComplete: boolean;
}

export function StepFourView({
  continuationToken,
  snapshot,
  initialDeclarations,
  pendingStep,
  documentsComplete,
}: StepFourViewProps) {
  const t = useTranslations("portal.step4");
  const tErrors = useTranslations("portal.errors");
  const locale = useLocale() as keyof LocalizedText;
  const router = useRouter();

  const [isPep, setIsPep] = useState<boolean | undefined>(initialDeclarations.isPep);
  const [pepDetails, setPepDetails] = useState(initialDeclarations.pepDetails);
  const [sourceCategory, setSourceCategory] = useState(initialDeclarations.sourceOfFundsCategory);
  const [sourceDescription, setSourceDescription] = useState(
    initialDeclarations.sourceOfFundsDescription
  );
  const [consent, setConsent] = useState(initialDeclarations.creditConsentGranted);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [savedNotice, setSavedNotice] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  /**
   * Client-side mirror of `areRequiredDeclarationsComplete` (26A-4).
   *
   * Deliberately a MIRROR and not a second authority: the server re-derives the
   * same verdict on submit. Its only job is to explain the disabled button
   * before the customer presses it.
   */
  const validate = (): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (isPep === undefined) errors.isPep = tErrors("REQUIRED");
    if (isPep === true && pepDetails.trim().length === 0) errors.pepDetails = tErrors("REQUIRED");
    if (pepDetails.length > PEP_DETAILS_MAX) errors.pepDetails = tErrors("TOO_LONG");
    if (!sourceCategory) errors.sourceCategory = tErrors("REQUIRED");
    if (sourceCategory === "other" && sourceDescription.trim().length === 0) {
      errors.sourceDescription = tErrors("REQUIRED");
    }
    if (sourceDescription.length > SOURCE_DESCRIPTION_MAX) {
      errors.sourceDescription = tErrors("TOO_LONG");
    }
    // Consent must be GRANTED, not merely answered — ODL cannot verify without
    // permission. A refusal is recordable but does not complete the step.
    if (!consent) errors.consent = t("consentRequired");
    return errors;
  };

  const declarationsReady = Object.keys(validate()).length === 0;

  /** Persist whatever has been answered. Shared by Save and Submit. */
  const persistDeclarations = async () => {
    return savePortalDeclarations({
      continuationToken,
      isPep,
      pepDetails: pepDetails.trim() || undefined,
      sourceOfFundsCategory: (sourceCategory || undefined) as SourceOfFundsCategory | undefined,
      sourceOfFundsDescription: sourceDescription.trim() || undefined,
      // Only ever sent when granted. Recording a `false` the customer never
      // chose would fabricate a refusal.
      creditConsentGranted: consent ? true : undefined,
    });
  };

  const handleSaveForLater = async () => {
    if (busy) return;
    setBusy(true);
    setFormError(null);
    setSavedNotice(false);
    try {
      const result = await persistDeclarations();
      if (result.status !== "ok") {
        setFormError(tErrors(result.code));
        return;
      }
      setSavedNotice(true);
      router.refresh();
    } catch {
      setFormError(tErrors("SAVE_FAILED"));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmit = async () => {
    if (busy || submitting) return;

    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setFormError(t("fixBeforeSubmit"));
      return;
    }

    setBusy(true);
    setSubmitting(true);
    setFormError(null);
    setSavedNotice(false);

    try {
      // Declarations first: the server's completion gate reads them from the
      // database, not from this request, so they must be committed before the
      // submission is attempted.
      const saved = await persistDeclarations();
      if (saved.status !== "ok") {
        setFormError(tErrors(saved.code));
        return;
      }

      const result = await submitPortalApplicationAction(continuationToken);

      if (result.status === "ok" || result.status === "already_submitted") {
        // The confirmation lives on this same route, rendered from the stored
        // `submitted_at`. Refreshing swaps this form for it — no client-held
        // "we submitted" flag that a reload could lose.
        router.refresh();
        return;
      }

      if (result.status === "incomplete") {
        setFormError(t(`incomplete_${result.pendingStep}` as "incomplete_financial_data"));
        return;
      }

      setFormError(tErrors(result.code));
    } catch {
      setFormError(tErrors("SAVE_FAILED"));
    } finally {
      setBusy(false);
      setSubmitting(false);
    }
  };

  /**
   * Is the customer missing something that ANOTHER page owns?
   *
   * Not simply `pendingStep !== "review"`. The evaluator folds declarations
   * into its `documents` step (they are part of what Step 3 requires, they are
   * just not files), so an applicant who has uploaded everything and not yet
   * answered these three questions is reported as pending `documents` — by
   * this very screen's own doing. Treating that as "go back to Step 3" would
   * disable Submit until the declarations are saved and only save them on
   * Submit: a deadlock with no way out.
   *
   * So `documents` counts as blocking only when a required FILE is actually
   * missing. Everything earlier always blocks, and is fixed elsewhere.
   */
  const blockedByEarlierStep =
    pendingStep !== undefined &&
    pendingStep !== "review" &&
    (pendingStep !== "documents" || !documentsComplete);

  return (
    <div className="flex flex-col gap-7 sm:gap-8">
      <PortalProgress currentStep={4} />

      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[1.75rem]">
          {t("title")}
        </h1>
        <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">{t("subtitle")}</p>
        <p className="text-xs text-muted-foreground">
          {t("applicationRef", { number: snapshot.applicationNumber })}
        </p>
      </header>

      {blockedByEarlierStep && (
        <div
          role="alert"
          className="flex items-start gap-3 rounded-xl border border-warning/30 bg-warning/[0.06] p-4"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-foreground">{t("incompleteTitle")}</p>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {t(`incomplete_${pendingStep}` as "incomplete_financial_data")}
            </p>
          </div>
        </div>
      )}

      {/* ================= 1. PERSONAL DATA ================= */}
      <ReviewSection
        title={t("sectionApplicant")}
        editHref={`/solicitud/continuar/${continuationToken}`}
        editLabel={t("edit")}
      >
        <Row label={t("fullName")} value={snapshot.applicant.fullName} />
        <Row
          label={t("identification")}
          value={
            snapshot.applicant.identificationNumber
              ? `${t(`idType_${snapshot.applicant.identificationType}` as "idType_cedula")} ${snapshot.applicant.identificationNumber}`
              : undefined
          }
        />
        <Row label={t("email")} value={snapshot.applicant.email} />
        <Row label={t("phone")} value={snapshot.applicant.phone} />
      </ReviewSection>

      {/* ================= 2. THE LOAN REQUESTED ================= */}
      <ReviewSection
        title={t("sectionLoan")}
        editHref={`/solicitud/continuar/${continuationToken}`}
        editLabel={t("edit")}
      >
        <Row label={t("product")} value={snapshot.productName[locale] ?? snapshot.productName.es} />
        <Row
          label={t("amount")}
          value={
            snapshot.loan.requestedAmount !== undefined
              ? formatCurrency(snapshot.loan.requestedAmount)
              : undefined
          }
        />
        {/* Term is optional by design (26B-1B) — absent means the customer had
            no preference, which is not the same as a value of zero. */}
        <Row
          label={t("term")}
          value={
            snapshot.loan.requestedTermMonths !== undefined
              ? t("months", { count: snapshot.loan.requestedTermMonths })
              : t("termNoPreference")
          }
        />
      </ReviewSection>

      {/* ================= 3. FINANCIAL INFORMATION (product-aware) ========= */}
      <ReviewSection
        title={t("sectionFinancial")}
        editHref={`/solicitud/continuar/${continuationToken}/paso-2`}
        editLabel={t("edit")}
      >
        {snapshot.productCode === "E" ? (
          <BusinessRows snapshot={snapshot} />
        ) : (
          <PersonalRows snapshot={snapshot} />
        )}

        {snapshot.productCode === "D" && snapshot.bankAccount && (
          <>
            <Row label={t("bank")} value={snapshot.bankAccount.bankName} />
            <Row
              label={t("accountType")}
              value={t(`accountType_${snapshot.bankAccount.accountType}` as "accountType_savings")}
            />
            {/* MASKED. The full number is never sent to this component. */}
            <Row label={t("account")} value={`****${snapshot.bankAccount.accountNumberLast4}`} />
          </>
        )}

        {/* Collateral is shown whenever it EXISTS, not only for the vehicle
            product: a business loan can be secured too, and silently dropping
            it would leave the applicant confirming a summary that omits what
            they pledged. Which rows appear follows the collateral's own type. */}
        {snapshot.collateral?.collateralType === "vehicle" && (
          <>
            <Row
              label={t("vehicle")}
              value={
                [
                  snapshot.collateral.vehicleMake,
                  snapshot.collateral.vehicleModel,
                  snapshot.collateral.vehicleYear,
                ]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
            />
            <Row label={t("plate")} value={snapshot.collateral.vehiclePlate} />
            <Row
              label={t("lien")}
              value={
                snapshot.collateral.lienStatus
                  ? t(`lien_${snapshot.collateral.lienStatus}` as "lien_yes")
                  : undefined
              }
            />
          </>
        )}

        {snapshot.collateral?.collateralType === "property" && (
          <>
            <Row label={t("collateral")} value={t("collateral_property")} />
            <Row label={t("propertyType")} value={snapshot.collateral.propertyType} />
            <Row label={t("propertyLocation")} value={snapshot.collateral.propertyLocation} />
            <Row
              label={t("lien")}
              value={
                snapshot.collateral.lienStatus
                  ? t(`lien_${snapshot.collateral.lienStatus}` as "lien_yes")
                  : undefined
              }
            />
          </>
        )}

        {snapshot.obligations.length > 0 && (
          <Row
            label={t("obligations")}
            value={t("obligationCount", { count: snapshot.obligations.length })}
          />
        )}

        {snapshot.guarantor && <Row label={t("guarantor")} value={snapshot.guarantor.fullName} />}
      </ReviewSection>

      {/* ================= 4. DOCUMENTS ================= */}
      <ReviewSection
        title={t("sectionDocuments")}
        editHref={`/solicitud/continuar/${continuationToken}/paso-3`}
        editLabel={t("edit")}
      >
        {/* Counts only — no file names on a page the customer may screenshot or
            print, and no signed URLs minted just to render a summary. */}
        {snapshot.documentGroups.map((group) => (
          <Row
            key={group.kind}
            label={t(`group_${group.kind}` as "group_applicant")}
            value={t("documentsReceived", {
              done: group.completedCount,
              total: group.totalCount,
            })}
          />
        ))}
      </ReviewSection>

      {/* ================= 5. DECLARATIONS ================= */}
      <section className="flex flex-col gap-5" aria-labelledby="declarations">
        <div>
          <h2 id="declarations" className="text-base font-semibold text-foreground">
            {t("sectionDeclarations")}
          </h2>
          <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
            {t("declarationsIntro")}
          </p>
        </div>

        {/* ---- PEP ---- */}
        <fieldset className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-4">
          <legend className="sr-only">{t("pepLegend")}</legend>
          <p className="text-sm font-medium text-foreground">{t("pepQuestion")}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">{t("pepHelp")}</p>

          <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:gap-3">
            {/* NOT pre-selected. A default answer to a compliance question is an
                answer the customer never gave. */}
            <RadioChoice
              name="isPep"
              checked={isPep === false}
              onChange={() => setIsPep(false)}
              label={t("pepNo")}
            />
            <RadioChoice
              name="isPep"
              checked={isPep === true}
              onChange={() => setIsPep(true)}
              label={t("pepYes")}
            />
          </div>

          {fieldErrors.isPep && <FieldError message={fieldErrors.isPep} />}

          {/* YES IS NOT A REJECTION. It asks for detail and the application
              continues normally — being a PEP is a due-diligence flag, not a
              disqualification, and this screen must not behave as if it were. */}
          {isPep === true && (
            <div className="mt-2 flex flex-col gap-1.5">
              <label htmlFor="pepDetails" className="text-sm font-medium text-foreground">
                {t("pepDetailsLabel")}
              </label>
              <p className="text-sm text-muted-foreground">{t("pepDetailsHelp")}</p>
              <textarea
                id="pepDetails"
                value={pepDetails}
                maxLength={PEP_DETAILS_MAX}
                rows={3}
                onChange={(e) => setPepDetails(e.target.value)}
                aria-invalid={Boolean(fieldErrors.pepDetails)}
                className="min-h-24 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {fieldErrors.pepDetails && <FieldError message={fieldErrors.pepDetails} />}
            </div>
          )}
        </fieldset>

        {/* ---- SOURCE OF FUNDS ---- */}
        <div className="flex flex-col gap-2.5 rounded-xl border border-border bg-card p-4">
          <label htmlFor="sourceCategory" className="text-sm font-medium text-foreground">
            {t("sourceQuestion")}
          </label>
          <p className="text-sm leading-relaxed text-muted-foreground">{t("sourceHelp")}</p>
          <select
            id="sourceCategory"
            value={sourceCategory}
            onChange={(e) => setSourceCategory(e.target.value)}
            aria-invalid={Boolean(fieldErrors.sourceCategory)}
            className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">{t("sourcePlaceholder")}</option>
            {SOURCE_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {t(`source_${category}` as "source_salary")}
              </option>
            ))}
          </select>
          {fieldErrors.sourceCategory && <FieldError message={fieldErrors.sourceCategory} />}

          {/* `other` exists so nobody is forced into a wrong bucket; the
              description is what makes that answer useful to compliance. */}
          {sourceCategory === "other" && (
            <div className="mt-1 flex flex-col gap-1.5">
              <label htmlFor="sourceDescription" className="text-sm font-medium text-foreground">
                {t("sourceDescriptionLabel")}
              </label>
              <textarea
                id="sourceDescription"
                value={sourceDescription}
                maxLength={SOURCE_DESCRIPTION_MAX}
                rows={3}
                onChange={(e) => setSourceDescription(e.target.value)}
                aria-invalid={Boolean(fieldErrors.sourceDescription)}
                className="min-h-24 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              {fieldErrors.sourceDescription && <FieldError message={fieldErrors.sourceDescription} />}
            </div>
          )}
        </div>

        {/* ---- CREDIT CONSULTATION CONSENT ---- */}
        <div className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
          {/* NEVER PRE-CHECKED. Consent that arrives already ticked is not
              consent, and this is the record ODL would rely on to show it had
              permission to run a credit check. */}
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              aria-invalid={Boolean(fieldErrors.consent)}
              className="mt-0.5 size-5 shrink-0 rounded border-border accent-primary"
            />
            <span className="text-sm leading-relaxed text-foreground">{t("consentText")}</span>
          </label>
          {fieldErrors.consent && <FieldError message={fieldErrors.consent} />}
        </div>
      </section>

      {/* ================= SUBMIT ================= */}
      {formError && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/[0.06] p-4">
          <p className="text-sm font-medium text-destructive">{formError}</p>
        </div>
      )}

      {savedNotice && (
        <div role="status" className="rounded-xl border border-success/30 bg-success/[0.06] p-4">
          <p className="text-sm font-medium text-foreground">{t("savedTitle")}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("savedBody")}</p>
        </div>
      )}

      <div className="flex flex-col gap-4 border-t border-border pt-6">
        {/* Says plainly what pressing the button does — and what it does NOT. */}
        <p className="text-sm leading-relaxed text-muted-foreground">{t("submitMeaning")}</p>

        <div className="flex flex-col gap-3 sm:flex-row-reverse sm:items-center sm:justify-start">
          <Button
            type="button"
            disabled={busy || submitting || !declarationsReady || blockedByEarlierStep}
            onClick={() => void handleSubmit()}
            className="h-12 w-full px-8 text-[0.9375rem] font-semibold sm:w-auto"
          >
            {submitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {submitting ? t("submitting") : t("submit")}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy || submitting}
            onClick={() => void handleSaveForLater()}
            className="h-12 w-full px-6 text-[0.9375rem] sm:w-auto"
          >
            {t("saveForLater")}
          </Button>
          <Button
            type="button"
            variant="ghost"
            nativeButton={false}
            className="h-11 px-3 text-muted-foreground hover:text-foreground sm:mr-auto"
            render={<a href={`/solicitud/continuar/${continuationToken}/paso-3`} />}
          >
            {t("back")}
          </Button>
        </div>

        {/* A greyed-out button with no explanation is how a form strands
            someone. This always says which thing is missing. */}
        {!declarationsReady && !blockedByEarlierStep && (
          <p className="text-sm text-muted-foreground">{t("submitBlocked")}</p>
        )}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Presentation helpers
 * ------------------------------------------------------------------------- */

function ReviewSection({
  title,
  editHref,
  editLabel,
  children,
}: {
  title: string;
  editHref: string;
  editLabel: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {/* Every section is editable right up until submission. A read-back the
            customer cannot act on just makes mistakes feel permanent. */}
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          className="h-11 gap-1.5 px-3 text-muted-foreground hover:text-foreground sm:h-8"
          render={<a href={editHref} />}
        >
          <Pencil className="size-3.5" aria-hidden="true" />
          {editLabel}
        </Button>
      </div>
      <dl className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
        {children}
      </dl>
    </section>
  );
}

/**
 * One label/value pair.
 *
 * An absent value renders an em dash rather than disappearing: a missing
 * optional answer is information, and a silently dropped row reads as though
 * the question was never asked.
 */
function Row({ label, value }: { label: string; value?: string | number }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      {/* `break-words` keeps a long employer name or email inside the card at
          375px instead of widening the page. */}
      <dd className="text-sm font-medium break-words text-foreground sm:text-right">
        {value === undefined || value === "" ? "—" : value}
      </dd>
    </div>
  );
}

function PersonalRows({ snapshot }: { snapshot: ReviewSnapshot }) {
  const t = useTranslations("portal.step4");
  // Dates must follow the language the page is being read in — `formatDate`
  // otherwise falls back to Spanish and prints "ene" to an English reader.
  const locale = useLocale() as Locale;
  const employment = snapshot.employment;

  return (
    <>
      <Row
        label={t("employmentStatus")}
        value={
          employment
            ? t(`employment_${employment.employmentStatus}` as "employment_employee")
            : undefined
        }
      />
      <Row
        label={t("employer")}
        value={employment?.employerName ?? employment?.selfEmployedActivity}
      />
      <Row label={t("jobTitle")} value={employment?.jobTitle} />
      <Row
        label={t("startDate")}
        value={employment?.startDate ? formatDate(employment.startDate, locale) : undefined}
      />
      <Row
        label={t("monthlyIncome")}
        value={
          employment?.monthlyIncome !== undefined
            ? formatCurrency(employment.monthlyIncome)
            : undefined
        }
      />
      <Row
        label={t("monthlyExpenses")}
        value={
          snapshot.monthlyExpenses !== undefined
            ? formatCurrency(snapshot.monthlyExpenses)
            : undefined
        }
      />
      {snapshot.productCode === "N" && (
        <Row
          label={t("payrollDeduction")}
          value={
            employment?.payrollDeductionAvailable
              ? t(`payroll_${employment.payrollDeductionAvailable}` as "payroll_yes")
              : undefined
          }
        />
      )}
    </>
  );
}

function BusinessRows({ snapshot }: { snapshot: ReviewSnapshot }) {
  const t = useTranslations("portal.step4");
  const locale = useLocale() as Locale;
  const business = snapshot.business;

  return (
    <>
      <Row label={t("legalName")} value={business?.legalName} />
      <Row label={t("tradeName")} value={business?.tradeName} />
      <Row label={t("registrationNumber")} value={business?.registrationNumber} />
      <Row label={t("economicActivity")} value={business?.economicActivity} />
      <Row
        label={t("operationsStart")}
        value={business?.operationsStartDate ? formatDate(business.operationsStartDate, locale) : undefined}
      />
      <Row
        label={t("monthlyRevenue")}
        value={
          business?.averageMonthlyRevenue !== undefined
            ? formatCurrency(business.averageMonthlyRevenue)
            : undefined
        }
      />
      <Row
        label={t("businessExpenses")}
        value={
          business?.averageMonthlyExpenses !== undefined
            ? formatCurrency(business.averageMonthlyExpenses)
            : undefined
        }
      />
      <Row
        label={t("loanPurpose")}
        value={business?.loanPurpose ? t(`purpose_${business.loanPurpose}` as "purpose_other") : undefined}
      />
      <Row
        label={t("relationship")}
        value={
          business?.applicantRelationship
            ? t(`relationship_${business.applicantRelationship}` as "relationship_owner")
            : undefined
        }
      />
    </>
  );
}

/**
 * A radio rendered as a full-width tappable card.
 *
 * The whole label is the target, so the hit area is the card rather than a
 * 16px circle — the same treatment the product chooser uses in Step 1.
 */
function RadioChoice({
  name,
  checked,
  onChange,
  label,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 flex-1 cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2 transition-colors",
        checked ? "border-primary bg-primary/[0.06]" : "border-border bg-background hover:bg-muted/50"
      )}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        onChange={onChange}
        className="size-4 shrink-0 accent-primary"
      />
      <span className="text-sm font-medium text-foreground">{label}</span>
      {checked && <Check className="ml-auto size-4 text-primary" aria-hidden="true" />}
    </label>
  );
}

function FieldError({ message }: { message: string }) {
  return (
    <p role="alert" className="text-sm font-medium text-destructive">
      {message}
    </p>
  );
}
