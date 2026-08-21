import "server-only";
import { redirect } from "next/navigation";
import { getPortalSubmissionState } from "@/lib/services/portal-submission";

/**
 * ============================================================================
 * A SUBMITTED APPLICATION IS NOT AN EDITABLE ONE (26B-4)
 * ============================================================================
 *
 * Once ODL has the application, its continuation link must stop being a way to
 * change what ODL received. The server actions already refuse — every portal
 * write goes through `authorizePortalWrite`, which rejects a submitted intake —
 * so this guard is not what makes editing impossible.
 *
 * What it prevents is the WORSE FAILURE: a customer being shown a working form,
 * filling it in, and only then discovering their changes are rejected. Sending
 * them to the confirmation instead means the UI tells the same story the
 * database does.
 *
 * REDIRECT RATHER THAN RENDER. The confirmation exists in exactly one place —
 * Step 4 — so this sends the customer there instead of teaching four routes how
 * to draw a receipt. The URL then matches what is on screen, which also means a
 * reload or a bookmark lands somewhere that still makes sense.
 *
 * Callers must invoke this OUTSIDE a try/catch: `redirect` signals by throwing,
 * and a catch-all would swallow it and render the form anyway.
 */
export async function redirectIfSubmitted(token: string): Promise<void> {
  const state = await getPortalSubmissionState(token);
  if (state?.submittedAt) {
    redirect(`/solicitud/continuar/${token}/paso-4`);
  }
}
