import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SYSTEM_NATIONAL_SCOPE } from "@/lib/services/branch-scope-query";
import { resolveContinuationToken } from "@/lib/services/continuation-tokens";
import { getApplicationIntakeById } from "@/lib/services/application-intakes";
import { getApplicationById } from "@/lib/services/applications";
import { getProductById } from "@/lib/services/products";
import { getApplicationStep2 } from "@/lib/services/application-step2";
import { getApplicationDeclarations } from "@/lib/services/application-declarations";
import { getPortalDocuments } from "@/lib/services/portal-documents";
import { evaluatePortalProgress } from "@/lib/services/portal-progress";
import { PortalConfirmation } from "@/components/portal/portal-confirmation";
import { StepFourView, type ReviewSnapshot } from "./step-four-view";
import { redirectIfUnderReview } from "@/lib/services/portal-review-guard";

/**
 * ============================================================================
 * STEP 4 — REVIEW, DECLARATIONS AND SUBMISSION (26B-4)
 * ============================================================================
 *
 * The last thing the applicant sees before ODL has their application, and the
 * first thing they see afterwards.
 *
 * ONE ROUTE, TWO STATES. While the application is a draft this renders the
 * review and the declarations. Once `submitted_at` is set it renders the
 * confirmation instead — so the continuation link keeps working and stops being
 * an editing surface at the same moment, without a second credential or a
 * second URL.
 *
 * THE REVIEW SNAPSHOT IS ASSEMBLED FIELD BY FIELD. Nothing is spread from a
 * domain model, which is what keeps internal fields — branch, advisor, status,
 * review verdicts, staff notes — structurally out of it rather than merely
 * unrendered. The bank account arrives already masked from 26A-2's summary
 * shape, whose type has no full number to leak.
 */
export default async function PortalStepFourPage({
  params,
}: PageProps<"/solicitud/continuar/[token]/paso-4">) {
  const { token } = await params;

  // 26B-18 — see the guard. A parked lead must not reach a step that
  // assumes an application exists.
  await redirectIfUnderReview(token);

  const resolved = await resolveContinuationToken(token);
  if (resolved.status !== "ok" || !resolved.resolved.applicationId) {
    return <StepFourProblem />;
  }
  const applicationId = resolved.resolved.applicationId;

  const [intakeResult, application] = await Promise.all([
    getApplicationIntakeById(resolved.resolved.intakeId),
    getApplicationById(SYSTEM_NATIONAL_SCOPE, applicationId),
  ]);
  if (intakeResult.status !== "ok" || application.status !== "ok") return <StepFourProblem />;

  const intake = intakeResult.intake;

  // ALREADY SENT — show the receipt, not the form.
  //
  // A submitted application always has a number: 26B-5's
  // applications_draft_number_pair_check makes "submitted without a number"
  // unrepresentable. The guard is here anyway because the type is optional and
  // a receipt with a blank reference would be worse than the problem screen.
  if (intake.submittedAt) {
    const submittedNumber = application.application.applicationNumber;
    if (!submittedNumber) return <StepFourProblem />;
    return <PortalConfirmation applicationNumber={submittedNumber} submittedAt={intake.submittedAt} />;
  }

  const [productResult, step2Result, declarationsResult, progressResult] = await Promise.all([
    getProductById(application.application.productId),
    getApplicationStep2(SYSTEM_NATIONAL_SCOPE, applicationId),
    getApplicationDeclarations(applicationId),
    evaluatePortalProgress(intake),
  ]);

  if (
    productResult.status !== "ok" ||
    !productResult.product.applicationCode ||
    step2Result.status !== "ok" ||
    declarationsResult.status !== "ok" ||
    progressResult.status !== "ok"
  ) {
    return <StepFourProblem />;
  }

  const productCode = productResult.product.applicationCode;
  const step2 = step2Result.step2;
  const hasPropertyCollateral = step2.collateral.some((c) => c.collateralType === "property");
  const documentsResult = await getPortalDocuments(applicationId, hasPropertyCollateral);
  if (documentsResult.status !== "ok") return <StepFourProblem />;

  const employment = step2.employment;
  const bank = step2.bankAccounts[0];
  const collateral = step2.collateral[0];
  const business = step2.businessProfile;
  const guarantor = step2.guarantors[0];
  const obligationOwner = productCode === "E" ? "business" : "applicant";

  const snapshot: ReviewSnapshot = {
    productCode,
    productName: productResult.product.name,
    applicationNumber: application.application.applicationNumber,

    applicant: {
      fullName: intake.applicantFullName,
      email: intake.applicantEmail,
      phone: intake.applicantPhone,
      identificationType: intake.applicantIdentificationType,
      identificationNumber: intake.applicantIdentificationNumber,
    },
    loan: {
      requestedAmount: application.application.requestedAmount,
      requestedTermMonths: application.application.requestedTermMonths,
    },

    employment: employment
      ? {
          employmentStatus: employment.employmentStatus,
          employerName: employment.employerName,
          jobTitle: employment.jobTitle,
          selfEmployedActivity: employment.selfEmployedActivity,
          startDate: employment.startDate,
          contractType: employment.contractType,
          monthlyIncome: employment.monthlyIncome,
          payrollDeductionAvailable: employment.payrollDeductionAvailable,
        }
      : undefined,
    monthlyExpenses: step2.financialProfile?.monthlyExpenses,

    // MASKED ONLY. `ApplicationBankAccountSummary` has no `accountNumber`
    // field at all, so the full value cannot reach this object even by
    // accident — see 26A-2.
    bankAccount: bank
      ? {
          bankName: bank.bankName,
          accountType: bank.accountType,
          accountNumberLast4: bank.accountNumberLast4,
          receivesSalary: bank.receivesSalary,
        }
      : undefined,

    collateral: collateral
      ? {
          collateralType: collateral.collateralType,
          vehicleMake: collateral.vehicleMake,
          vehicleModel: collateral.vehicleModel,
          vehicleYear: collateral.vehicleYear,
          vehiclePlate: collateral.vehiclePlate,
          ownedByApplicant: collateral.ownedByApplicant,
          lienStatus: collateral.lienStatus,
          lienBalance: collateral.lienBalance,
          propertyType: collateral.propertyType,
          propertyLocation: collateral.propertyLocation,
        }
      : undefined,

    business: business
      ? {
          legalName: business.legalName,
          tradeName: business.tradeName,
          economicActivity: business.economicActivity,
          operationsStartDate: business.operationsStartDate,
          registrationNumber: business.registrationNumber,
          averageMonthlyRevenue: business.averageMonthlyRevenue,
          averageMonthlyExpenses: business.averageMonthlyExpenses,
          loanPurpose: business.loanPurpose,
          purposeDescription: business.purposeDescription,
          applicantRelationship: business.applicantRelationship,
        }
      : undefined,

    obligations: step2.obligations
      .filter((o) => o.obligationOwner === obligationOwner)
      .map((o) => ({
        lenderName: o.lenderName,
        outstandingBalance: o.outstandingBalance,
        monthlyPayment: o.monthlyPayment,
      })),

    guarantor: guarantor
      ? { fullName: guarantor.fullName, email: guarantor.email, phone: guarantor.phone }
      : undefined,

    // Counts only — no file names, no signed URLs, nothing minted to render a
    // summary. Viewing a document remains an explicit action on Step 3.
    documentGroups: documentsResult.documents.groups.map((g) => ({
      kind: g.kind,
      completedCount: g.completedCount,
      totalCount: g.totalCount,
      tasks: g.tasks.map((t) => ({
        name: t.name,
        required: t.required,
        isComplete: t.isComplete,
        fileCount: t.files.filter((f) => !f.isSuperseded).length,
      })),
    })),
  };

  const declarations = declarationsResult.declarations;

  return (
    <StepFourView
      continuationToken={token}
      snapshot={snapshot}
      initialDeclarations={{
        isPep: declarations.pep?.isPep,
        pepDetails: declarations.pep?.pepDetails ?? "",
        sourceOfFundsCategory: declarations.sourceOfFunds?.sourceOfFundsCategory ?? "",
        sourceOfFundsDescription: declarations.sourceOfFunds?.sourceOfFundsDescription ?? "",
        creditConsentGranted: declarations.creditConsent?.consentGranted === true,
      }}
      pendingStep={progressResult.progress.firstPendingStep}
      documentsComplete={documentsResult.documents.allRequiredComplete}
    />
  );
}

async function StepFourProblem() {
  const t = await getTranslations("portal.resume");
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card px-6 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-warning/10 text-warning">
        <AlertCircle className="size-6" aria-hidden="true" />
      </span>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{t("notFoundTitle")}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{t("notFoundBody")}</p>
      </div>
      <Button className="mt-2 h-11 px-6" nativeButton={false} render={<Link href="/solicitud" />}>
        {t("startOver")}
      </Button>
    </div>
  );
}
