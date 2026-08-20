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
 * Step 2's UI is milestone 26B-2. This page exists for one reason: a customer
 * who successfully completes Step 1 must not be dropped onto a 404. It is a
 * landing pad, not a design.
 *
 * IT REFUSES TO RENDER IN PRODUCTION. `notFound()` when
 * NODE_ENV === "production" means this text can never reach a real ODL
 * customer, even if someone deploys before 26B-2 lands and even if the URL is
 * shared. A placeholder that could appear in production is not a placeholder,
 * it is unfinished product — so the guard is structural rather than a promise
 * to remember to delete this file.
 *
 * HOW TO TELL THIS FROM FINISHED WORK when testing: the amber "development
 * environment" chip at the top. Nothing in the real portal uses that treatment.
 * The progress rail correctly shows step 2 as reached, because Step 1 genuinely
 * WAS saved — that part is real, and the report explains exactly how to verify
 * the persistence independently of this screen.
 */
export default async function PortalStepTwoPlaceholderPage({
  searchParams,
}: PageProps<"/solicitud/paso-2">) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }

  const params = await searchParams;
  const t = await getTranslations("portal.devBoundary");

  const outcome = typeof params.estado === "string" ? params.estado : "";
  const outcomeMessage =
    outcome === "application_created"
      ? t("applicationCreated")
      : outcome === "saved_lead"
        ? t("leadSaved")
        : undefined;

  return (
    <div className="flex flex-col gap-7 sm:gap-8">
      <PortalProgress currentStep={2} />

      <div className="flex flex-col items-center gap-4 rounded-2xl border border-warning/30 bg-warning/[0.06] px-6 py-12 text-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-warning/15 px-3 py-1 text-xs font-semibold tracking-wide text-warning uppercase">
          <Construction className="size-3.5" aria-hidden="true" />
          {t("badge")}
        </span>

        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{t("title")}</h1>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-muted-foreground">
            {t("body")}
          </p>
        </div>

        {outcomeMessage && (
          <p className="rounded-lg bg-card px-4 py-2 text-sm font-medium text-foreground">
            {outcomeMessage}
          </p>
        )}

        <Button
          variant="outline"
          className="mt-2 h-11 px-6"
          nativeButton={false}
          render={<Link href="/solicitud" />}
        >
          {t("back")}
        </Button>
      </div>
    </div>
  );
}
