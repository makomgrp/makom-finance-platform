import { after } from "next/server";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SYSTEM_NATIONAL_SCOPE } from "@/lib/services/branch-scope-query";
import { resolveContinuationToken } from "@/lib/services/continuation-tokens";
import { recordStepReached } from "@/lib/services/portal-funnel-events";
import { getApplicationById } from "@/lib/services/applications";
import { getProductById } from "@/lib/services/products";
import { getApplicationStep2 } from "@/lib/services/application-step2";
import { materializeConditionalSlots } from "@/lib/services/requirement-slot-materialization";
import { getPortalDocuments } from "@/lib/services/portal-documents";
import { redirectIfSubmitted } from "@/lib/services/portal-submitted-guard";
import { redirectIfUnderReview } from "@/lib/services/portal-review-guard";
import { StepThreeView } from "./step-three-view";

/**
 * ============================================================================
 * STEP 3 — DOCUMENTS (26B-3)
 * ============================================================================
 *
 * The applicant sees only the requirements 26A-3 says apply to their product,
 * their guarantor and their collateral. Nothing here decides what a document
 * list should contain — the catalog does, and this page renders it.
 *
 * CONDITIONAL REQUIREMENTS ARE BROUGHT UP TO DATE ON EVERY RENDER. A customer
 * who added a guarantor in Step 2 and continued straight here sees that
 * guarantor's documents, with no separate regeneration step anyone could
 * forget to run. See requirement-slot-materialization.ts for which conditions
 * are answerable from real data and which two deliberately are not.
 */
export default async function PortalStepThreePage({
  params,
}: PageProps<"/solicitud/continuar/[token]/paso-3">) {
  const { token } = await params;

  // Already sent? Then this is a receipt, not a form. See the guard's header.
  await redirectIfSubmitted(token);

  // 26B-18 — a lead the engine parked for a human has no application to
  // walk into. Checked on every step, not only after Step 1, because a
  // bookmark or a Back button never passes through Step 1 at all.
  await redirectIfUnderReview(token);

  const resolved = await resolveContinuationToken(token);
  if (resolved.status !== "ok" || !resolved.resolved.applicationId) {
    return <StepThreeProblem />;
  }
  const applicationId = resolved.resolved.applicationId;

  const application = await getApplicationById(SYSTEM_NATIONAL_SCOPE, applicationId);
  if (application.status !== "ok") return <StepThreeProblem />;

  const [productResult, step2Result] = await Promise.all([
    getProductById(application.application.productId),
    getApplicationStep2(SYSTEM_NATIONAL_SCOPE, applicationId),
  ]);
  if (productResult.status !== "ok" || step2Result.status !== "ok") return <StepThreeProblem />;

  await materializeConditionalSlots(applicationId, application.application.productId);

  // Property collateral has no seeded document requirements (26A-3 declined to
  // invent them), so the page says so rather than showing an empty section.
  const hasPropertyCollateral = step2Result.step2.collateral.some(
    (item) => item.collateralType === "property"
  );

  const documentsResult = await getPortalDocuments(applicationId, hasPropertyCollateral);
  if (documentsResult.status !== "ok") return <StepThreeProblem />;

  // MILESTONE 26B-26B — SE REGISTRA AQUÍ, NO EN EL GUARDADO.
  //
  // `reached` es lo que separa "cinco personas vieron este paso" de "dos lo
  // terminaron", y esa resta es la métrica de abandono. Si solo se registrara al
  // guardar, quien llega y se va —el caso que más importa— no dejaría rastro.
  //
  // DESPUÉS DE TODOS LOS GUARDIAS, a propósito: las pantallas de error y la de
  // "aún no hay solicitud" no son este paso, y contarlas inflaría el numerador
  // con gente que no pudo trabajar aquí.
  //
  // Un refresco no suma: la unicidad la impone un índice en la base, no una
  // comprobación previa que dos peticiones simultáneas se saltarían.
  after(async () => {
    await recordStepReached(resolved.resolved.intakeId, "documents");
  });

  return (
    <StepThreeView
      continuationToken={token}
      applicationNumber={application.application.applicationNumber}
      productName={productResult.product.name}
      documents={documentsResult.documents}
    />
  );
}

async function StepThreeProblem() {
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
