"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, FileCheck2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCapability } from "@/lib/auth/use-capability";
import { formalizeSolicitudApplication } from "@/app/(app)/solicitudes/actions";
import { StatusBadge } from "@/components/shared/status-badge";
import { ApplicationReviewPanel } from "@/components/review/application-review-panel";
import { BranchOriginLabel } from "@/components/shared/branch-origin-label";
import { APPLICATION_STATUS_BADGE_CLASS } from "@/lib/config/application";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isFormalApplication } from "@/types";
import type { ApplicationReviewView } from "@/lib/services/application-review";
import type { Locale } from "@/i18n/config";
import type {
  ApplicationDeclarationSet,
  ApplicationListItem,
  ApplicationStep2,
  Client,
  DocumentEvidence,
  LocalizedText,
  RequirementSlot,
} from "@/types";

/**
 * ============================================================================
 * THE APPLICATION DOSSIER (26B-5)
 * ============================================================================
 *
 * Everything an advisor needs to look at ONE loan, sourced from that loan's own
 * records.
 *
 * ----------------------------------------------------------------------------
 * CLIENT DATA AND APPLICATION DATA ARE NOT THE SAME DATA
 * ----------------------------------------------------------------------------
 * The defect this screen was built to fix: the CRM showed employer, position
 * and salary from `clients`, where they are a stale profile snapshot and were
 * simply empty — while the application's own `application_employment` row held
 * Makom Capital Group, Gerente de operaciones, B/. 2,500.
 *
 * So the rule here is strict, and worth stating because it is easy to violate
 * by accident: anything that can differ BETWEEN two applications of the same
 * customer is read from the APPLICATION. Employer, position, income, expenses,
 * obligations, guarantor, payroll deduction, banking, collateral, business
 * profile — all application-scoped. `clients` supplies identity only: who this
 * person is, how to reach them. There is deliberately no fallback from one to
 * the other: an empty application field means the application does not have
 * that value, and quietly borrowing the client's would be a lie about which
 * loan the number belongs to.
 *
 * ----------------------------------------------------------------------------
 * WHAT IS NOT ON SCREEN
 * ----------------------------------------------------------------------------
 * No UUIDs, no slot ids, no storage paths, no bucket names. An advisor needs
 * the case, not the schema.
 */

export interface ApplicationDossierViewProps {
  locale: Locale;
  application: ApplicationListItem;
  client?: Client;
  step2?: ApplicationStep2;
  declarations?: ApplicationDeclarationSet;
  requirementSlots: RequirementSlot[];
  evidence: DocumentEvidence[];
  /** MILESTONE 26B-10 — absent only when the review failed to load; the rest
   * of the dossier still renders, because a reviewer's workspace being
   * unavailable is no reason to hide the loan. */
  review?: ApplicationReviewView;
  loadError: boolean;
}

export function ApplicationDossierView({
  locale,
  application,
  client,
  step2,
  declarations,
  requirementSlots,
  evidence,
  review,
  loadError,
}: ApplicationDossierViewProps) {
  const t = useTranslations();
  const productCode = application.productCode;

  // ---- Documents: reception and review, counted separately ----------------
  // Same two questions the Solicitudes column now asks, answered here from the
  // slots and evidence this application actually owns.
  const superseded = new Set(
    evidence.map((e) => e.supersededByEvidenceId).filter((id): id is string => Boolean(id))
  );
  const documentSlots = requirementSlots.filter((slot) => slot.requirementKind === "document");
  const liveFilesBySlot = new Map<string, DocumentEvidence[]>();
  for (const item of evidence) {
    if (superseded.has(item.id) || item.supersededByEvidenceId) continue;
    const bucket = liveFilesBySlot.get(item.requirementSlotId) ?? [];
    bucket.push(item);
    liveFilesBySlot.set(item.requirementSlotId, bucket);
  }
  const documentRows = documentSlots.map((slot) => {
    const files = liveFilesBySlot.get(slot.id) ?? [];
    const minFiles = slot.minFiles ?? null;
    return {
      slot,
      fileCount: files.length,
      isReceived: minFiles === null ? false : files.length >= minFiles,
      isReviewed: slot.status === "satisfied" || slot.status === "waived",
    };
  });
  const receivedCount = documentRows.filter((row) => row.isReceived).length;
  const reviewedCount = documentRows.filter((row) => row.isReviewed).length;

  const employment = step2?.employment;
  const business = step2?.businessProfile;
  const bank = step2?.bankAccounts[0];
  const collateral = step2?.collateral[0];
  const guarantors = step2?.guarantors ?? [];
  // Business financing and personal debts share a table under different owners.
  const obligationOwner = productCode === "business_loan" ? "business" : "applicant";
  const obligations = (step2?.obligations ?? []).filter(
    (o) => o.obligationOwner === obligationOwner
  );

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/solicitudes"
        className="inline-flex w-fit items-center gap-1.5 rounded-sm text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t("applicationDossier.backToList")}
      </Link>

      {application.status === "draft" && (
        <FormalizePanel
          applicationId={application.id}
          pendingRequirements={requirementSlots.some(
            (slot) => slot.status !== "satisfied" && slot.status !== "waived"
          )}
        />
      )}

      {/* ================= HEADER (§19) ================= */}
      <header className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {/* MILESTONE 26B-23B — a draft has no number, and the CHECK on
                the table guarantees it never will until it is formalised.
                Rendering the empty value left the page headed by nothing. */}
            <h1
              className={cn(
                "text-xl font-semibold break-all text-foreground sm:text-2xl",
                application.applicationNumber ? "font-mono" : "italic text-muted-foreground"
              )}
            >
              {application.applicationNumber ?? t("applicationDossier.draftLabel")}
            </h1>
            {/* Client-level identity, linked — but the APPLICATION's own status
                is what the badge above shows. The two are different lifecycles
                and must not be conflated. */}
            <Link
              href={`/expedientes/${application.clientId}`}
              className="mt-1 inline-block rounded-sm text-[0.9375rem] text-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {application.clientFullName}
            </Link>
          </div>
          <StatusBadge
            label={t(`statuses.applicationStatus.${application.status}`)}
            className={APPLICATION_STATUS_BADGE_CLASS[application.status]}
          />
        </div>

        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <HeaderFact label={t("applicationDossier.product")} value={application.productName[locale]} />
          <HeaderFact
            label={t("applicationDossier.requestedAmount")}
            value={formatCurrency(application.requestedAmount)}
          />
          {/* MILESTONE 26B-23D — appears only once ODL has decided one, right
              beside the customer's figure and under its own label. Neither
              replaces the other: an application whose approved amount stood
              where the requested one used to be would leave a reader unable to
              tell which of the two they are looking at. */}
          {application.approvedAmount !== undefined && (
            <HeaderFact
              label={t("review.approvedAmountLabel")}
              value={formatCurrency(application.approvedAmount)}
            />
          )}
          <HeaderFact
            label={t("applicationDossier.term")}
            value={
              application.requestedTermMonths !== undefined
                ? t("applicationDossier.months", { count: application.requestedTermMonths })
                : t("applicationDossier.termNoPreference")
            }
          />
          <HeaderFact
            label={t("applicationDossier.advisor")}
            value={application.assignedAdvisorFullName ?? t("common.unassigned")}
          />
          <HeaderFact
            label={t("applicationDossier.branch")}
            value={<BranchOriginLabel origin={application.branchOrigin} />}
          />
          <HeaderFact
            label={t("applicationDossier.createdAt")}
            value={formatDate(application.createdAt, locale)}
          />
          {application.statusChangedAt && (
            <HeaderFact
              label={t("applicationDossier.submittedAt")}
              value={formatDate(application.statusChangedAt, locale)}
            />
          )}
        </dl>
      </header>

      {loadError && (
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/[0.06] p-4">
          <p className="text-sm font-medium text-destructive">{t("applicationDossier.loadError")}</p>
        </div>
      )}

      {/* ================= MANUAL REVIEW (26B-10) =================
          First, deliberately. A reviewer opening this file needs to see what
          has been checked and what is still open before reading the data, and
          a decision-maker needs the recommendation without hunting for it. The
          application's own data sits below, unchanged and still the source for
          every fact in it. */}
      {/* MILESTONE 26B-23B.2 — and only once ODL has received the application.
          A draft is still being prepared by the employee who created it, so
          there is nothing for compliance to certify and no file for a verdict
          to attach to. The panel is absent rather than disabled: a greyed-out
          checklist of twenty unanswered questions reads as work outstanding,
          when the truth is that the work has not started and should not.

          This is presentation only. The service refuses the same thing (see
          isApplicationReviewable), which is what actually makes it a rule. */}
      {review && isFormalApplication(application.status) && (
        <ApplicationReviewPanel
          applicationId={application.id}
          applicationStatus={application.status}
          review={review}
          requestedAmount={application.requestedAmount}
          approvedAmount={application.approvedAmount}
        />
      )}

      {/* ================= APPLICANT IDENTITY ================= */}
      <Section title={t("applicationDossier.sectionApplicant")}>
        <Fact label={t("applicationDossier.fullName")} value={client?.fullName} />
        <Fact
          label={t("applicationDossier.identification")}
          value={client ? `${t(`identificationTypes.${client.identificationType}`)} ${client.identificationNumber}` : undefined}
        />
        <Fact label={t("applicationDossier.email")} value={client?.email} />
        <Fact label={t("applicationDossier.phone")} value={client?.phone} />
      </Section>

      {/* ================= STEP 2, PRODUCT-AWARE (§20) ================= */}
      <Section title={t("applicationDossier.sectionFinancial")}>
        {productCode === "business_loan" ? (
          <>
            <Fact label={t("applicationDossier.legalName")} value={business?.legalName} />
            <Fact label={t("applicationDossier.tradeName")} value={business?.tradeName} />
            <Fact
              label={t("applicationDossier.registrationNumber")}
              value={business?.registrationNumber}
            />
            <Fact
              label={t("applicationDossier.economicActivity")}
              value={business?.economicActivity}
            />
            <Fact
              label={t("applicationDossier.operationsStart")}
              value={business?.operationsStartDate ? formatDate(business.operationsStartDate, locale) : undefined}
            />
            <Fact
              label={t("applicationDossier.monthlyRevenue")}
              value={money(business?.averageMonthlyRevenue)}
            />
            <Fact
              label={t("applicationDossier.businessExpenses")}
              value={money(business?.averageMonthlyExpenses)}
            />
            <Fact
              label={t("applicationDossier.loanPurpose")}
              value={business?.loanPurpose ? t(`loanPurposes.${business.loanPurpose}`) : undefined}
            />
            <Fact
              label={t("applicationDossier.relationship")}
              value={
                business?.applicantRelationship
                  ? t(`businessRelationships.${business.applicantRelationship}`)
                  : undefined
              }
            />
          </>
        ) : (
          <>
            <Fact
              label={t("applicationDossier.employmentStatus")}
              value={
                employment ? t(`employmentStatuses.${employment.employmentStatus}`) : undefined
              }
            />
            {/* THE APPLICATION's employer, never clients.employer_name. */}
            <Fact
              label={t("applicationDossier.employer")}
              value={employment?.employerName ?? employment?.selfEmployedActivity}
            />
            <Fact label={t("applicationDossier.position")} value={employment?.jobTitle} />
            <Fact
              label={t("applicationDossier.employmentStart")}
              value={employment?.startDate ? formatDate(employment.startDate, locale) : undefined}
            />
            <Fact
              label={t("applicationDossier.contractType")}
              value={employment?.contractType ? t(`contractTypes.${employment.contractType}`) : undefined}
            />
            <Fact
              label={t("applicationDossier.monthlySalary")}
              value={money(employment?.monthlyIncome)}
            />
            <Fact
              label={t("applicationDossier.monthlyExpenses")}
              value={money(step2?.financialProfile?.monthlyExpenses)}
            />
            {/* MILESTONE 26B-25 — separado del salario a propósito. Sí/No es la
                respuesta, y el monto solo acompaña cuando la respuesta es sí;
                mezclar ambas cifras en una fila haría imposible saber cuál es
                el ingreso principal. Ausente = nunca se preguntó, y `Fact` ya
                pinta eso como «—» sin fingir un «No». */}
            <Fact
              label={t("applicationDossier.additionalIncome")}
              value={
                step2?.financialProfile?.hasAdditionalIncome === undefined
                  ? undefined
                  : t(step2.financialProfile.hasAdditionalIncome ? "common.yes" : "common.no")
              }
            />
            {step2?.financialProfile?.hasAdditionalIncome === true && (
              <>
                <Fact
                  label={t("applicationDossier.additionalIncomeAmount")}
                  value={money(step2.financialProfile.additionalMonthlyIncome)}
                />
                <Fact
                  label={t("applicationDossier.additionalIncomeSource")}
                  value={step2.financialProfile.additionalIncomeSource}
                />
              </>
            )}
            {/* La red social es del CLIENTE, no de la solicitud (26B-25). Se
                muestra aquí porque es donde el asesor está mirando el caso. */}
            <Fact
              label={t("applicationDossier.socialNetwork")}
              value={
                client?.primarySocialNetwork
                  ? client.primarySocialNetwork === "other"
                    ? client.primarySocialNetworkOther
                    : t(`socialNetworks.${client.primarySocialNetwork}` as "socialNetworks.instagram")
                  : undefined
              }
            />
            {productCode === "payroll_deduction" && (
              <Fact
                label={t("applicationDossier.payrollDeduction")}
                value={
                  employment?.payrollDeductionAvailable
                    ? t(`payrollDeduction.${employment.payrollDeductionAvailable}`)
                    : undefined
                }
              />
            )}
          </>
        )}

        {/* Product D — masked only. The full number has its own authorized
            path and is never loaded into this summary (26A-2). */}
        {productCode === "bank_direct_debit" && bank && (
          <>
            <Fact label={t("applicationDossier.bank")} value={bank.bankName} />
            <Fact
              label={t("applicationDossier.accountType")}
              value={t(`bankAccountTypes.${bank.accountType}`)}
            />
            <Fact
              label={t("applicationDossier.account")}
              value={`****${bank.accountNumberLast4}`}
            />
          </>
        )}

        {collateral?.collateralType === "vehicle" && (
          <>
            <Fact
              label={t("applicationDossier.vehicle")}
              value={
                [collateral.vehicleMake, collateral.vehicleModel, collateral.vehicleYear]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
            />
            <Fact label={t("applicationDossier.plate")} value={collateral.vehiclePlate} />
            <Fact
              label={t("applicationDossier.lien")}
              value={collateral.lienStatus ? t(`lienStatuses.${collateral.lienStatus}`) : undefined}
            />
          </>
        )}

        {collateral?.collateralType === "property" && (
          <>
            <Fact
              label={t("applicationDossier.propertyType")}
              value={collateral.propertyType}
            />
            <Fact
              label={t("applicationDossier.propertyLocation")}
              value={collateral.propertyLocation}
            />
            <Fact
              label={t("applicationDossier.lien")}
              value={collateral.lienStatus ? t(`lienStatuses.${collateral.lienStatus}`) : undefined}
            />
          </>
        )}
      </Section>

      {/* ================= OBLIGATIONS (§21) ================= */}
      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-foreground">
            {t("applicationDossier.sectionObligations")}
          </h2>
          <span className="text-sm text-muted-foreground tabular-nums">
            {t("applicationDossier.obligationCount", { count: obligations.length })}
          </span>
        </div>
        {/* A count alone is not inspectable — an advisor deciding on capacity
            needs the lender, the balance and the monthly payment, so the rows
            are here rather than a "2 registradas" summary. */}
        {obligations.length === 0 ? (
          <EmptyNote text={t("applicationDossier.noObligations")} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border bg-card">
            <table className="w-full min-w-[32rem] text-sm">
              <thead className="border-b border-border">
                <tr>
                  <Th>{t("applicationDossier.lender")}</Th>
                  <Th align="right">{t("applicationDossier.outstandingBalance")}</Th>
                  <Th align="right">{t("applicationDossier.monthlyPayment")}</Th>
                </tr>
              </thead>
              <tbody>
                {obligations.map((obligation, index) => (
                  <tr key={`${obligation.lenderName}-${index}`} className="border-b border-border/60 last:border-0">
                    <td className="px-4 py-2.5 text-foreground">{obligation.lenderName}</td>
                    <td className="px-4 py-2.5 text-right text-foreground tabular-nums">
                      {money(obligation.outstandingBalance) ?? "—"}
                    </td>
                    <td className="px-4 py-2.5 text-right text-foreground tabular-nums">
                      {money(obligation.monthlyPayment) ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ================= FIADOR (§22) ================= */}
      <Section title={t("applicationDossier.sectionGuarantor")}>
        {guarantors.length === 0 ? (
          <div className="px-4 py-3">
            <EmptyNote text={t("applicationDossier.noGuarantor")} />
          </div>
        ) : (
          guarantors.map((guarantor, index) => (
            <div key={`${guarantor.fullName}-${index}`} className="contents">
              <Fact label={t("applicationDossier.guarantorName")} value={guarantor.fullName} />
              <Fact label={t("applicationDossier.email")} value={guarantor.email} />
              <Fact label={t("applicationDossier.phone")} value={guarantor.phone} />
            </div>
          ))
        )}
      </Section>

      {/* ================= DOCUMENTS (§23, §25) ================= */}
      <section className="flex flex-col gap-3">
        <h2 className="text-base font-semibold text-foreground">
          {t("applicationDossier.sectionDocuments")}
        </h2>
        {/* Two counts, never merged. "Recibidos" is what the customer has sent;
            "revisados" is what staff have concluded. Reporting one number for
            both is what produced "0 de 7" beside seven delivered documents. */}
        <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-xl border border-border bg-card px-4 py-3">
          <p className="text-sm text-foreground tabular-nums">
            <span className="text-muted-foreground">{t("applicationDossier.receivedLabel")} </span>
            {t("applicationDossier.ofTotal", { count: receivedCount, total: documentRows.length })}
          </p>
          <p className="text-sm text-foreground tabular-nums">
            <span className="text-muted-foreground">{t("applicationDossier.reviewedLabel")} </span>
            {t("applicationDossier.ofTotal", { count: reviewedCount, total: documentRows.length })}
          </p>
        </div>

        <ul className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
          {documentRows.map((row) => (
            <li key={row.slot.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <span className="flex min-w-0 items-center gap-2">
                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="truncate text-sm text-foreground">
                  {localized(row.slot.name, locale)}
                </span>
              </span>
              {/* Never colour alone: each state carries its own words. */}
              <span className="flex shrink-0 items-center gap-2">
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-medium",
                    row.isReceived
                      ? "bg-success/15 text-success"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {row.isReceived
                    ? t("applicationDossier.received", { count: row.fileCount })
                    : t("applicationDossier.notReceived")}
                </span>
                <span
                  className={cn(
                    "rounded-full px-2.5 py-1 text-xs font-medium",
                    row.isReviewed ? "bg-navy/10 text-navy" : "bg-muted text-muted-foreground"
                  )}
                >
                  {row.isReviewed
                    ? t("applicationDossier.reviewed")
                    : t("applicationDossier.pendingReview")}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* ================= DECLARATIONS (§45) ================= */}
      <Section title={t("applicationDossier.sectionDeclarations")}>
        <Fact
          label={t("applicationDossier.pep")}
          value={
            declarations?.pep?.isPep === undefined
              ? undefined
              : declarations.pep.isPep
                ? t("applicationDossier.pepYes")
                : t("applicationDossier.pepNo")
          }
        />
        {declarations?.pep?.isPep && (
          <Fact label={t("applicationDossier.pepDetails")} value={declarations.pep.pepDetails} />
        )}
        <Fact
          label={t("applicationDossier.sourceOfFunds")}
          value={
            declarations?.sourceOfFunds?.sourceOfFundsCategory
              ? t(`sourceOfFunds.${declarations.sourceOfFunds.sourceOfFundsCategory}`)
              : undefined
          }
        />
        <Fact
          label={t("applicationDossier.creditConsent")}
          value={
            declarations?.creditConsent?.consentGranted === undefined
              ? undefined
              : declarations.creditConsent.consentGranted
                ? t("applicationDossier.consentGranted")
                : t("applicationDossier.consentRefused")
          }
        />
      </Section>
    </div>
  );
}

/* ---------------------------------------------------------------------------
 * Presentation helpers
 * ------------------------------------------------------------------------- */

function localized(text: LocalizedText, locale: Locale): string {
  return text[locale as keyof LocalizedText] ?? text.es;
}

/** Money never goes through a float path — formatCurrency owns the formatting. */
function money(amount?: number): string | undefined {
  return amount === undefined ? undefined : formatCurrency(amount);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <dl className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card">
        {children}
      </dl>
    </section>
  );
}

/**
 * One label/value pair.
 *
 * An absent value renders an em dash rather than vanishing: "we do not have
 * this" is information an advisor needs, and a silently dropped row reads as
 * though the question was never asked.
 */
function Fact({ label, value }: { label: string; value?: string | number }) {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium break-words text-foreground sm:text-right">
        {value === undefined || value === "" ? "—" : value}
      </dd>
    </div>
  );
}

function HeaderFact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="text-sm font-medium text-foreground">{value}</dd>
    </div>
  );
}

function Th({ children, align = "left" }: { children: React.ReactNode; align?: "left" | "right" }) {
  return (
    <th
      scope="col"
      className={cn(
        "px-4 py-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase",
        align === "right" ? "text-right" : "text-left"
      )}
    >
      {children}
    </th>
  );
}

function EmptyNote({ text }: { text: string }) {
  return <p className="text-sm text-muted-foreground">{text}</p>;
}

/**
 * ============================================================================
 * MILESTONE 26B-23B — THE ONE MOMENT A NUMBER IS SPENT
 * ============================================================================
 *
 * Formalising is irreversible in the only sense that matters: the official
 * consecutive it takes can never be returned or reused, and a gap in ODL's
 * numbering is visible forever. So the action asks first — INLINE, not through
 * `window.confirm`, which cannot be translated, cannot be styled, and reads to
 * a user like the browser is warning them about the page rather than the CRM
 * asking about their work.
 *
 * The copy says what will happen in the order it happens — a number, then
 * review — and says plainly that none of it means approval, because "submit"
 * and "approve" are the two words most easily confused in a lending CRM.
 *
 * PENDING DOCUMENTS ARE MENTIONED, NEVER ENFORCED. Staff formalise historical
 * files whose paperwork is genuinely incomplete; the note tells them what they
 * are carrying forward without standing in their way. See the service.
 */
function FormalizePanel({
  applicationId,
  pendingRequirements,
}: {
  applicationId: string;
  pendingRequirements: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const canFormalize = useCapability("application:create");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!canFormalize) return null;

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    const result = await formalizeSolicitudApplication(applicationId);
    setBusy(false);

    if (result.status !== "success") {
      toast.error(
        t(
          result.code === "NOT_DRAFT"
            ? "applicationDossier.formalizeErrorNotDraft"
            : result.code === "FORBIDDEN" || result.code === "UNAUTHENTICATED"
              ? "applicationDossier.formalizeErrorForbidden"
              : "applicationDossier.formalizeError"
        )
      );
      return;
    }

    setConfirming(false);
    toast.success(
      t("applicationDossier.formalizeSuccess", { number: result.applicationNumber })
    );
    router.refresh();
  };

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-warning/30 bg-warning/[0.05] p-5">
      <div>
        <h2 className="text-base font-semibold text-foreground">
          {t("applicationDossier.formalizeTitle")}
        </h2>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
          {t("applicationDossier.formalizeExplanation")}
        </p>
        {pendingRequirements && (
          <p className="mt-2 text-sm text-muted-foreground">
            {t("applicationDossier.formalizePendingDocuments")}
          </p>
        )}
      </div>

      {confirming ? (
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={handleConfirm}>
            {t("applicationDossier.formalizeConfirm")}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
            {t("applicationDossier.formalizeCancel")}
          </Button>
        </div>
      ) : (
        <div>
          <Button onClick={() => setConfirming(true)}>
            <FileCheck2 className="size-4" />
            {t("applicationDossier.formalizeTitle")}
          </Button>
        </div>
      )}
    </section>
  );
}
