"use server";

import { setApplicationStatus } from "@/lib/services/applications";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { APPLICATION_STATUS_TRANSITIONABLE } from "@/lib/config/application";
import type { Application, ApplicationStatus } from "@/types";

/**
 * Thin Server Action wrapper around src/lib/services/applications.ts,
 * matching the same shape as every other Server Action in this app
 * (src/app/(app)/expedientes/actions.ts's setDossierRequirementSlotStatus
 * is the closest precedent): validates input, authenticates the caller,
 * delegates to the service, maps the outcome to a safe, client-facing
 * result. Milestone 13C — see the Milestone 13A architecture review and
 * its final validation.
 *
 * Only the mutation this milestone's UI actually needs. No read action —
 * the initial Solicitudes list load is a direct Server Component ->
 * service call (src/app/(app)/solicitudes/page.tsx), per the Milestone
 * 13A validation's "Read Server Action" question; one is added later only
 * if a genuine client-triggered refetch need appears.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export interface SetSolicitudApplicationStatusInput {
  applicationId: string;
  status: ApplicationStatus;
}

export type SetSolicitudApplicationStatusResult =
  | { status: "success"; application: Application }
  | {
      status: "error";
      code:
        | "INVALID_INPUT"
        | "UNAUTHENTICATED"
        | "INVALID_ACTOR"
        | "NOT_FOUND"
        | "INVALID_TRANSITION"
        | "UPDATE_FAILED";
    };

/**
 * Never accepts statusChangedByProfileId from the client — always the
 * caller's own getCurrentProfile(), and source is hardcoded to
 * 'crm_manual', since this action is reachable only from an authenticated
 * CRM session, matching every other manual status-change action in this
 * app.
 *
 * Legality of the specific from-state -> to-state transition is enforced
 * server-side by setApplicationStatus itself (APPLICATION_STATUS_
 * TRANSITIONS) — never duplicated here. The check in this action is only
 * "is this a status a staff member may ever deliberately target at all"
 * (APPLICATION_STATUS_TRANSITIONABLE excludes 'new', which is never a
 * legal target from any state), so a request for an always-illegal target
 * returns a clear INVALID_INPUT before the service is even called; a
 * request that's illegal only from the application's CURRENT state (e.g.
 * a stale client trying to move an already-approved application) reaches
 * the service and comes back as INVALID_TRANSITION instead.
 */
export async function setSolicitudApplicationStatus(
  input: SetSolicitudApplicationStatusInput
): Promise<SetSolicitudApplicationStatusResult> {
  if (!isNonEmptyString(input.applicationId) || !UUID_PATTERN.test(input.applicationId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!(APPLICATION_STATUS_TRANSITIONABLE as string[]).includes(input.status)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    console.error("[solicitudes actions] setSolicitudApplicationStatus rejected: no authenticated profile.");
    return { status: "error", code: "UNAUTHENTICATED" };
  }

  const result = await setApplicationStatus(input.applicationId, input.status, "crm_manual", profile.id);
  if (result.status !== "ok") {
    return { status: "error", code: result.code };
  }

  return { status: "success", application: result.application };
}
