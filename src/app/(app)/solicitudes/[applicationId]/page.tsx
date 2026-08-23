import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { EMPTY_BRANCH_SCOPE } from "@/lib/services/branch-scope-query";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { getApplicationListItemById } from "@/lib/services/applications";
import { getApplicationStep2 } from "@/lib/services/application-step2";
import { getApplicationDeclarations } from "@/lib/services/application-declarations";
import { getRequirementSlotsByApplicationId } from "@/lib/services/requirement-slots";
import { getEvidenceByApplicationId } from "@/lib/services/document-evidence";
import { getClientById } from "@/lib/services/clients";
import { getApplicationReview } from "@/lib/services/application-review";
import { isFormalApplication } from "@/types";
import { ApplicationDossierView } from "./application-dossier-view";
import type { Locale } from "@/i18n/config";

/**
 * ============================================================================
 * ONE LOAN, ITS OWN PAGE (26B-5)
 * ============================================================================
 *
 * Manual QA had to reach a loan through its customer, and once there the screen
 * showed the CLIENT's stale profile fields — employer "—", position "—", salary
 * "—" — for an application whose Step 2 clearly recorded Makom Capital Group,
 * Gerente de operaciones and B/. 2,500. Two different problems with one root:
 * there was no surface that belonged to an application.
 *
 * There is now, and everything on it is read from THIS application's own
 * Step 2 tables. A client with three loans has three of these pages, and none
 * of them can show another's employer, because none of them ever loads another
 * application's rows.
 *
 * ----------------------------------------------------------------------------
 * SCOPE, AND WHY A UUID IS NOT A KEY
 * ----------------------------------------------------------------------------
 * Every read is branch-scoped. An application outside the viewer's scope
 * resolves to NOT_FOUND, which becomes a plain 404 — identical to an id that
 * never existed — so this route cannot be used to confirm that a case exists in
 * a branch the viewer may not see.
 *
 * A DRAFT ALSO 404s. It is not an application ODL has received, it has no
 * official number, and it is absent from Solicitudes; giving it an operational
 * dossier would put it back into the workflow through a side door.
 */
export default async function ApplicationDossierPage({
  params,
}: {
  params: Promise<{ applicationId: string }>;
}) {
  const { applicationId } = await params;
  const locale = (await getLocale()) as Locale;

  const profile = await getCurrentProfile();
  const scope = profile?.branchScope ?? EMPTY_BRANCH_SCOPE;

  const applicationResult = await getApplicationListItemById(scope, applicationId);
  if (applicationResult.status !== "ok") notFound();

  const application = applicationResult.application;

  // Not received by ODL => not an operational case => no dossier.
  if (!isFormalApplication(application.status)) notFound();

  const [
    step2Result,
    declarationsResult,
    slotsResult,
    evidenceResult,
    clientResult,
    reviewResult,
  ] = await Promise.all([
    getApplicationStep2(scope, application.id),
    getApplicationDeclarations(application.id),
    getRequirementSlotsByApplicationId(scope, application.id),
    getEvidenceByApplicationId(scope, application.id),
    getClientById(scope, application.clientId),
    // MILESTONE 26B-10. Loaded here rather than by the client, so the review is
    // present on first paint and is read through the SAME scope that already
    // decided this page may render at all.
    getApplicationReview(scope, application.id),
  ]);

  return (
    <ApplicationDossierView
      locale={locale}
      application={application}
      client={clientResult.status === "ok" ? clientResult.client : undefined}
      step2={step2Result.status === "ok" ? step2Result.step2 : undefined}
      declarations={declarationsResult.status === "ok" ? declarationsResult.declarations : undefined}
      requirementSlots={slotsResult.status === "ok" ? slotsResult.requirementSlots : []}
      evidence={evidenceResult.status === "ok" ? evidenceResult.evidence : []}
      review={reviewResult.status === "ok" ? reviewResult.review : undefined}
      loadError={step2Result.status !== "ok" || slotsResult.status !== "ok"}
    />
  );
}
