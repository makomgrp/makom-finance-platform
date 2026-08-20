import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Construction } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PortalProgress } from "@/components/portal/portal-progress";

/**
 * ============================================================================
 * ⚠️ DEVELOPMENT BOUNDARY — NOT A CUSTOMER SCREEN
 * ============================================================================
 *
 * Step 3 (documents and declarations) is a later milestone. This exists only so
 * that finishing Step 2 does not land the customer on a 404, and it REFUSES TO
 * RENDER IN PRODUCTION — `notFound()` below means this text can never reach a
 * real applicant even if the portal ships before Step 3 does.
 *
 * The route is deliberately real rather than a placeholder inside Step 2: it
 * keeps the token-scoped URL shape every step shares, so building Step 3 is a
 * matter of replacing this file's body and nothing else.
 *
 * How to tell this from finished work while testing: the amber "development
 * environment" chip. Nothing in the real portal uses that treatment.
 */
export default async function PortalStepThreeBoundaryPage({
  params,
}: PageProps<"/solicitud/continuar/[token]/paso-3">) {
  if (process.env.NODE_ENV === "production") notFound();

  const { token } = await params;
  const t = await getTranslations("portal.devBoundary");

  return (
    <div className="flex flex-col gap-7 sm:gap-8">
      <PortalProgress currentStep={3} />
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-warning/30 bg-warning/[0.06] px-6 py-12 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-3 py-1 text-xs font-semibold tracking-wide text-warning uppercase">
          <Construction className="size-3.5" aria-hidden="true" />
          {t("badge")}
        </span>
        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{t("stepThreeTitle")}</h1>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
            {t("stepThreeBody")}
          </p>
        </div>
        <Button
          variant="outline"
          className="mt-2 h-11 px-6"
          nativeButton={false}
          render={<Link href={`/solicitud/continuar/${token}/paso-2`} />}
        >
          {t("backToStepTwo")}
        </Button>
      </div>
    </div>
  );
}
