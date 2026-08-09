"use server";

import { createNote } from "@/lib/services/notes";
import { createAlert, setAlertStatus } from "@/lib/services/alerts";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { getClientById } from "@/lib/demo-data";
import { NOTE_PRIORITY_VALUES, NOTE_TYPE_VALUES } from "@/lib/config/note";
import { ALERT_LEVEL_VALUES, ALERT_TYPE_VALUES } from "@/lib/config/alert";
import type { AlertLevel, AlertType, DossierAlert, InternalNote, NotePriority, NoteType } from "@/types";

/**
 * Thin Server Action wrapper around src/lib/services/notes.ts, matching
 * the same shape as src/app/(app)/chat/actions.ts: validates input,
 * authenticates the caller, delegates to the service, maps the outcome to
 * a safe, client-facing result.
 *
 * Never accepts a client-supplied author identity — the caller is always
 * derived from getCurrentProfile(), same rule as every other Server
 * Action in this app since Milestone 5.
 */

const MAX_NOTE_LENGTH = 4000;
const MAX_ALERT_REASON_LENGTH = 500;
const MAX_ALERT_OBSERVATION_LENGTH = 4000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNoteType(value: unknown): value is NoteType {
  return typeof value === "string" && (NOTE_TYPE_VALUES as string[]).includes(value);
}

function isNotePriority(value: unknown): value is NotePriority {
  return typeof value === "string" && (NOTE_PRIORITY_VALUES as string[]).includes(value);
}

function isAlertType(value: unknown): value is AlertType {
  return typeof value === "string" && (ALERT_TYPE_VALUES as string[]).includes(value);
}

function isAlertLevel(value: unknown): value is AlertLevel {
  return typeof value === "string" && (ALERT_LEVEL_VALUES as string[]).includes(value);
}

export interface CreateDossierNoteInput {
  clientId: string;
  text: string;
  type: NoteType;
  priority: NotePriority;
}

export type CreateDossierNoteResult =
  | { status: "success"; note: InternalNote }
  | {
      status: "error";
      code: "INVALID_INPUT" | "UNAUTHENTICATED" | "CLIENT_NOT_FOUND" | "CREATE_FAILED";
    };

export async function createDossierNote(
  input: CreateDossierNoteInput
): Promise<CreateDossierNoteResult> {
  if (!isNonEmptyString(input.clientId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  const text = isNonEmptyString(input.text) ? input.text.trim() : "";
  if (!text || text.length > MAX_NOTE_LENGTH) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!isNoteType(input.type) || !isNotePriority(input.priority)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  // No real `clients` table exists yet (see the Milestone 6 architecture
  // review) — this is only a soft check against demo data, not a database
  // constraint. dossier_notes.client_legacy_id itself is unconstrained.
  if (!getClientById(input.clientId)) {
    return { status: "error", code: "CLIENT_NOT_FOUND" };
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    console.error("[expedientes actions] createDossierNote rejected: no authenticated profile.");
    return { status: "error", code: "UNAUTHENTICATED" };
  }

  try {
    const note = await createNote({
      clientLegacyId: input.clientId,
      authorProfileId: profile.id,
      text,
      type: input.type,
      priority: input.priority,
    });
    return { status: "success", note };
  } catch (error) {
    console.error(
      "[expedientes actions] createDossierNote failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error", code: "CREATE_FAILED" };
  }
}

// ============================================================================
// createDossierAlert
// ============================================================================

export interface CreateDossierAlertInput {
  clientId: string;
  type: AlertType;
  level: AlertLevel;
  reason: string;
  observation?: string;
}

export type CreateDossierAlertResult =
  | { status: "success"; alert: DossierAlert }
  | {
      status: "error";
      code: "INVALID_INPUT" | "UNAUTHENTICATED" | "CLIENT_NOT_FOUND" | "CREATE_FAILED";
    };

export async function createDossierAlert(
  input: CreateDossierAlertInput
): Promise<CreateDossierAlertResult> {
  if (!isNonEmptyString(input.clientId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  const reason = isNonEmptyString(input.reason) ? input.reason.trim() : "";
  if (!reason || reason.length > MAX_ALERT_REASON_LENGTH) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  const observation = typeof input.observation === "string" ? input.observation.trim() : "";
  if (observation.length > MAX_ALERT_OBSERVATION_LENGTH) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!isAlertType(input.type) || !isAlertLevel(input.level)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  // No real `clients` table exists yet (see the Milestone 7 architecture
  // review) — this is only a soft check against demo data, not a database
  // constraint. dossier_alerts.client_legacy_id itself is unconstrained.
  if (!getClientById(input.clientId)) {
    return { status: "error", code: "CLIENT_NOT_FOUND" };
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    console.error("[expedientes actions] createDossierAlert rejected: no authenticated profile.");
    return { status: "error", code: "UNAUTHENTICATED" };
  }

  try {
    const alert = await createAlert({
      clientLegacyId: input.clientId,
      createdByProfileId: profile.id,
      type: input.type,
      level: input.level,
      reason,
      observation: observation || undefined,
    });
    return { status: "success", alert };
  } catch (error) {
    console.error(
      "[expedientes actions] createDossierAlert failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error", code: "CREATE_FAILED" };
  }
}

// ============================================================================
// setDossierAlertStatus
// ============================================================================

export interface SetDossierAlertStatusInput {
  alertId: string;
  targetActive: boolean;
}

export type SetDossierAlertStatusResult =
  | { status: "success"; alert: DossierAlert }
  | { status: "error"; code: "INVALID_INPUT" | "UNAUTHENTICATED" | "UPDATE_FAILED" };

/**
 * Never accepts resolvedByProfileId from the client — only alertId and the
 * intended target state (true = reactivate, false = resolve). The actor
 * is always the caller's own getCurrentProfile(), applied server-side by
 * src/lib/services/alerts.ts's setAlertStatus.
 */
export async function setDossierAlertStatus(
  input: SetDossierAlertStatusInput
): Promise<SetDossierAlertStatusResult> {
  if (!isNonEmptyString(input.alertId) || !UUID_PATTERN.test(input.alertId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (typeof input.targetActive !== "boolean") {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    console.error("[expedientes actions] setDossierAlertStatus rejected: no authenticated profile.");
    return { status: "error", code: "UNAUTHENTICATED" };
  }

  try {
    const alert = await setAlertStatus(input.alertId, input.targetActive, profile.id);
    return { status: "success", alert };
  } catch (error) {
    console.error(
      "[expedientes actions] setDossierAlertStatus failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error", code: "UPDATE_FAILED" };
  }
}
