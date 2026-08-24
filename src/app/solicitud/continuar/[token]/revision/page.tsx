import { redirect } from "next/navigation";
import { isIntakeUnderReview } from "@/lib/services/portal-review-guard";
import { PortalUnderReview } from "@/components/portal/portal-under-review";

/**
 * ============================================================================
 * MILESTONE 26B-18 — THE SURFACE A PARKED LEAD LANDS ON
 * ============================================================================
 *
 * A route rather than something Step 2 draws in place, for the same reason the
 * confirmation is a route: the URL then says what the screen says. A reload, a
 * bookmark, a Back button or a link reopened tomorrow all arrive somewhere that
 * still makes sense, and the applicant is never looking at /paso-2 while being
 * told they cannot continue to Step 2.
 *
 * ----------------------------------------------------------------------------
 * IT VERIFIES INSTEAD OF TRUSTING THE URL
 * ----------------------------------------------------------------------------
 * The token still has to resolve, and the intake behind it still has to
 * actually be under review. Without that check this address would render the
 * same message for any valid token, which would tell a customer whose
 * application is progressing perfectly well that it is not.
 *
 * When the lead is NOT under review, this sends the applicant to their
 * continuation link and lets the normal routing decide where they belong —
 * including the case that matters most, a human having resolved the review,
 * where the customer should simply find their form working again.
 *
 * ----------------------------------------------------------------------------
 * IT WRITES NOTHING
 * ----------------------------------------------------------------------------
 * No matching is re-run, no application is created, no intake is modified, no
 * email is sent. Refreshing this page is a read, so refreshing it a hundred
 * times leaves exactly the same single intake row behind.
 */
export default async function PortalUnderReviewPage({
  params,
}: PageProps<"/solicitud/continuar/[token]/revision">) {
  const { token } = await params;

  if (!(await isIntakeUnderReview(token))) {
    redirect(`/solicitud/continuar/${token}`);
  }

  return <PortalUnderReview />;
}
