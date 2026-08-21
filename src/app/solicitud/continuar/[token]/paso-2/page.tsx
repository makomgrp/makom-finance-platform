import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AlertCircle, Construction } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SYSTEM_NATIONAL_SCOPE } from "@/lib/services/branch-scope-query";
import { resolveContinuationToken } from "@/lib/services/continuation-tokens";
import { getApplicationById } from "@/lib/services/applications";
import { getProductById } from "@/lib/services/products";
import { getApplicationStep2 } from "@/lib/services/application-step2";
import { redirectIfSubmitted } from "@/lib/services/portal-submitted-guard";
import { StepTwoForm, type StepTwoInitialValues } from "./step-two-form";

/**
 * ============================================================================
 * STEP 2 — PRODUCT-SPECIFIC INFORMATION (26B-2)
 * ============================================================================
 *
 * Everything this page renders is decided by the product on the APPLICATION,
 * read from the server. The browser never says which product it is, so it
 * cannot ask for a form its own product does not have.
 *
 * The token in the URL is the session, exactly as on Step 1 — one continuation
 * mechanism for the whole portal, not a second one for a second step.
 */
export default async function PortalStepTwoPage({
  params,
}: PageProps<"/solicitud/continuar/[token]/paso-2">) {
  const { token } = await params;

  // Already sent? Then this is a receipt, not a form. See the guard's header.
  await redirectIfSubmitted(token);

  const resolved = await resolveContinuationToken(token);
  if (resolved.status !== "ok") {
    return <StepTwoProblem kind="link" />;
  }

  const applicationId = resolved.resolved.applicationId;
  if (!applicationId) {
    return <AwaitingApplicationBoundary />;
  }

  const application = await getApplicationById(SYSTEM_NATIONAL_SCOPE, applicationId);
  if (application.status !== "ok") return <StepTwoProblem kind="link" />;

  const [productResult, step2Result] = await Promise.all([
    getProductById(application.application.productId),
    // Returns the MASKED bank-account shape. The full number has its own
    // single-record function and is not called here — see 26A-2.
    getApplicationStep2(SYSTEM_NATIONAL_SCOPE, applicationId),
  ]);

  if (productResult.status !== "ok" || !productResult.product.applicationCode) {
    return <StepTwoProblem kind="link" />;
  }
  if (step2Result.status !== "ok") return <StepTwoProblem kind="link" />;

  const step2 = step2Result.step2;
  const employment = step2.employment;
  const bank = step2.bankAccounts[0];
  const collateral = step2.collateral[0];
  const business = step2.businessProfile;
  const guarantor = step2.guarantors[0];
  const productCode = productResult.product.applicationCode;

  // Business financing and personal debts live in the same table under
  // different owners; each product edits only its own.
  const obligationOwner = productCode === "E" ? "business" : "applicant";
  const obligations = step2.obligations.filter((o) => o.obligationOwner === obligationOwner);

  const initialValues: StepTwoInitialValues = {
    employmentStatus: employment?.employmentStatus ?? "employee",
    employerName: employment?.employerName ?? "",
    jobTitle: employment?.jobTitle ?? "",
    contractType: employment?.contractType ?? "",
    selfEmployedActivity: employment?.selfEmployedActivity ?? "",
    startDate: employment?.startDate ?? "",
    monthlyIncome: employment?.monthlyIncome != null ? String(employment.monthlyIncome) : "",
    payrollDeductionAvailable: employment?.payrollDeductionAvailable ?? "",

    monthlyExpenses:
      step2.financialProfile?.monthlyExpenses != null
        ? String(step2.financialProfile.monthlyExpenses)
        : "",

    // The answer is derived from what is stored rather than remembered
    // separately — a customer with saved obligations comes back to "yes".
    hasObligations: obligations.length > 0 ? "yes" : "",
    obligations: obligations.map((o) => ({
      id: o.id,
      lenderName: o.lenderName,
      outstandingBalance: o.outstandingBalance != null ? String(o.outstandingBalance) : "",
      monthlyPayment: o.monthlyPayment != null ? String(o.monthlyPayment) : "",
    })),

    hasGuarantor: guarantor ? "yes" : "",
    guarantorFullName: guarantor?.fullName ?? "",
    guarantorEmail: guarantor?.email ?? "",
    guarantorPhone: guarantor?.phone ?? "",

    bankName: bank?.bankName ?? "",
    accountType: bank?.accountType ?? "",
    // NEVER the full number. Only the database-generated last four crosses to
    // the browser, so the stored value cannot leak through a resume.
    accountNumberLast4: bank?.accountNumberLast4 ?? "",
    // Deliberately empty on every load, including a resume.
    accountNumber: "",
    receivesSalary: bank?.receivesSalary === undefined ? "" : bank.receivesSalary ? "yes" : "no",

    collateralType: collateral?.collateralType ?? (productCode === "V" ? "vehicle" : ""),
    vehicleMake: collateral?.vehicleMake ?? "",
    vehicleModel: collateral?.vehicleModel ?? "",
    vehicleYear: collateral?.vehicleYear != null ? String(collateral.vehicleYear) : "",
    vehiclePlate: collateral?.vehiclePlate ?? "",
    ownedByApplicant:
      collateral?.ownedByApplicant === undefined ? "" : collateral.ownedByApplicant ? "yes" : "no",
    lienStatus: collateral?.lienStatus ?? "",
    lienBalance: collateral?.lienBalance != null ? String(collateral.lienBalance) : "",
    propertyType: collateral?.propertyType ?? "",
    propertyLocation: collateral?.propertyLocation ?? "",

    legalName: business?.legalName ?? "",
    tradeName: business?.tradeName ?? "",
    economicActivity: business?.economicActivity ?? "",
    operationsStartDate: business?.operationsStartDate ?? "",
    registrationNumber: business?.registrationNumber ?? "",
    averageMonthlyRevenue:
      business?.averageMonthlyRevenue != null ? String(business.averageMonthlyRevenue) : "",
    averageMonthlyExpenses:
      business?.averageMonthlyExpenses != null ? String(business.averageMonthlyExpenses) : "",
    loanPurpose: business?.loanPurpose ?? "",
    purposeDescription: business?.purposeDescription ?? "",
    applicantRelationship: business?.applicantRelationship ?? "",
  };

  return (
    <StepTwoForm
      productCode={productCode}
      productName={productResult.product.name}
      applicationNumber={application.application.applicationNumber}
      continuationToken={token}
      initialValues={initialValues}
    />
  );
}

async function StepTwoProblem({ kind }: { kind: "link" }) {
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
      <span className="sr-only">{kind}</span>
    </div>
  );
}

/**
 * ============================================================================
 * ⚠️ DEVELOPMENT BOUNDARY — NOT A CUSTOMER SCREEN
 * ============================================================================
 *
 * Step 2's data hangs off an APPLICATION, so this renders when the token
 * resolves to a lead that has not become one.
 *
 * MILESTONE 26B-2A CLOSED THE REASON THIS USED TO FIRE. Until then a brand-new
 * applicant could never have an Application at all, because `clients` demanded
 * a birth date, nationality, address, job title and salary that the approved
 * Step 1 does not collect. Those five columns are now nullable, so identity
 * plus a product and an amount — exactly what Step 1 asks for — is enough.
 *
 * What remains is the genuinely defensive case: a lead with no product or no
 * amount, which Step 1 requires and therefore should not produce. It is kept
 * because reaching Step 2 without an application must not render a broken page.
 *
 * `notFound()` in production means this explanation can never reach a real
 * customer.
 */
async function AwaitingApplicationBoundary() {
  if (process.env.NODE_ENV === "production") notFound();

  const t = await getTranslations("portal.devBoundary");
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-warning/30 bg-warning/[0.06] px-6 py-12 text-center">
      <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-3 py-1 text-xs font-semibold tracking-wide text-warning uppercase">
        <Construction className="size-3.5" aria-hidden="true" />
        {t("badge")}
      </span>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          {t("noApplicationTitle")}
        </h1>
        <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
          {t("noApplicationBody")}
        </p>
      </div>
      <Button
        variant="outline"
        className="mt-2 h-11 px-6"
        nativeButton={false}
        render={<Link href="/solicitud" />}
      >
        {t("back")}
      </Button>
    </div>
  );
}
