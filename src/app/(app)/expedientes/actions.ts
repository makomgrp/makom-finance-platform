"use server";

import { createNote } from "@/lib/services/notes";
import { createAlert, setAlertStatus } from "@/lib/services/alerts";
import {
  createDocumentEvidence,
  reviewDocumentEvidence,
  createSignedEvidenceUrl,
  getEvidenceByApplicationId,
} from "@/lib/services/document-evidence";
import { setRequirementSlotStatus, getRequirementSlotsByApplicationId } from "@/lib/services/requirement-slots";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { getClientById } from "@/lib/demo-data";
import { NOTE_PRIORITY_VALUES, NOTE_TYPE_VALUES } from "@/lib/config/note";
import { ALERT_LEVEL_VALUES, ALERT_TYPE_VALUES } from "@/lib/config/alert";
import { REQUIREMENT_SLOT_STATUS_TRANSITIONABLE } from "@/lib/config/requirement-slot";
import type {
  AlertLevel,
  AlertType,
  DocumentEvidence,
  DossierAlert,
  InternalNote,
  NotePriority,
  NoteType,
  RequirementSlot,
  RequirementSlotStatus,
} from "@/types";

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

// ============================================================================
// uploadRequirementEvidence
// ============================================================================
//
// The five actions below (Milestone 12C) are the Server Action layer for
// src/lib/services/document-evidence.ts and the Requirement Slot side of
// src/lib/services/requirement-slots.ts — the Requirement Slot + Document
// Evidence model, now the only document data model this file exposes
// (Milestone 12E4 removed the legacy dossier_documents actions above).

export type UploadRequirementEvidenceResult =
  | { status: "success"; evidence: DocumentEvidence }
  | { status: "partial"; evidence: DocumentEvidence; code: "SLOT_TRANSITION_FAILED" }
  | {
      status: "error";
      code:
        | "INVALID_INPUT"
        | "UNAUTHENTICATED"
        | "INVALID_ACTOR"
        | "INVALID_MIME"
        | "INVALID_FILE_SIZE"
        | "SLOT_NOT_FOUND"
        | "NOT_DOCUMENT_KIND"
        | "SLOT_TERMINAL"
        | "REPLACES_NOT_FOUND"
        | "CROSS_SLOT_REPLACEMENT"
        | "UPLOAD_FAILED"
        | "INSERT_FAILED";
    };

/**
 * Accepts FormData (requirementSlotId + file + optional
 * replacesEvidenceId), since a File can't cross a Server Action boundary
 * as JSON. Every call creates a
 * NEW Evidence row (src/lib/services/document-evidence.ts#
 * createDocumentEvidence never updates an existing one); there is no
 * "replace" distinct from upload here — replacesEvidenceId, when present,
 * is explicit supersession of one specific prior row, never a mutation of
 * it. The "partial" result (Evidence created, Slot transition failed) is
 * passed through as its own distinct status — never collapsed into
 * "success" — so the caller can surface it and retry the transition alone
 * rather than re-uploading.
 *
 * The actor is always the caller's own getCurrentProfile() — never
 * accepted from the client — and uploadedSource is hardcoded to
 * 'crm_manual': this action is reachable only from an authenticated CRM
 * session.
 */
export async function uploadRequirementEvidence(formData: FormData): Promise<UploadRequirementEvidenceResult> {
  const requirementSlotId = formData.get("requirementSlotId");
  const file = formData.get("file");
  const replacesEvidenceIdRaw = formData.get("replacesEvidenceId");

  if (typeof requirementSlotId !== "string" || !UUID_PATTERN.test(requirementSlotId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (
    replacesEvidenceIdRaw !== null &&
    (typeof replacesEvidenceIdRaw !== "string" || !UUID_PATTERN.test(replacesEvidenceIdRaw))
  ) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    console.error("[expedientes actions] uploadRequirementEvidence rejected: no authenticated profile.");
    return { status: "error", code: "UNAUTHENTICATED" };
  }

  const result = await createDocumentEvidence({
    requirementSlotId,
    file,
    actorProfileId: profile.id,
    uploadedSource: "crm_manual",
    replacesEvidenceId: typeof replacesEvidenceIdRaw === "string" ? replacesEvidenceIdRaw : undefined,
  });

  if (result.status === "error") {
    return { status: "error", code: result.code };
  }
  if (result.status === "partial") {
    return { status: "partial", evidence: result.evidence, code: result.code };
  }
  return { status: "success", evidence: result.evidence };
}

// ============================================================================
// reviewRequirementEvidence
// ============================================================================

export type ReviewRequirementEvidenceResult =
  | { status: "success"; evidence: DocumentEvidence }
  | {
      status: "error";
      code: "INVALID_INPUT" | "UNAUTHENTICATED" | "NOT_FOUND" | "ALREADY_REVIEWED" | "UPDATE_FAILED";
    };

/**
 * Records a factual review of one Evidence item — never accepts
 * reviewedByProfileId from the client, always the caller's own
 * getCurrentProfile(). Does not touch the owning Requirement Slot's
 * status; see setDossierRequirementSlotStatus below for that, a
 * deliberately separate action (src/lib/services/document-evidence.ts#
 * reviewDocumentEvidence's own doc comment: "Slot decision remains a
 * separate action" — never infer one from the other).
 */
export async function reviewRequirementEvidence(evidenceId: string): Promise<ReviewRequirementEvidenceResult> {
  if (!isNonEmptyString(evidenceId) || !UUID_PATTERN.test(evidenceId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    console.error("[expedientes actions] reviewRequirementEvidence rejected: no authenticated profile.");
    return { status: "error", code: "UNAUTHENTICATED" };
  }

  const result = await reviewDocumentEvidence(evidenceId, profile.id);
  if (result.status !== "ok") {
    return { status: "error", code: result.code };
  }

  return { status: "success", evidence: result.evidence };
}

// ============================================================================
// getRequirementEvidenceViewUrl
// ============================================================================

export type GetRequirementEvidenceViewUrlResult =
  | { status: "success"; url: string }
  | { status: "error"; code: "INVALID_INPUT" | "UNAUTHENTICATED" | "NOT_FOUND" | "SIGN_FAILED" };

/** Mints a short-lived (90s) signed URL for one Evidence item — never a
 * permanent or public one. */
export async function getRequirementEvidenceViewUrl(
  evidenceId: string
): Promise<GetRequirementEvidenceViewUrlResult> {
  if (!isNonEmptyString(evidenceId) || !UUID_PATTERN.test(evidenceId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    console.error("[expedientes actions] getRequirementEvidenceViewUrl rejected: no authenticated profile.");
    return { status: "error", code: "UNAUTHENTICATED" };
  }

  const result = await createSignedEvidenceUrl(evidenceId);
  if (result.status !== "ok") {
    return { status: "error", code: result.code };
  }

  return { status: "success", url: result.url };
}

// ============================================================================
// setDossierRequirementSlotStatus
// ============================================================================

export interface SetDossierRequirementSlotStatusInput {
  slotId: string;
  status: RequirementSlotStatus;
}

export type SetDossierRequirementSlotStatusResult =
  | { status: "success"; requirementSlot: RequirementSlot }
  | {
      status: "error";
      code: "INVALID_INPUT" | "UNAUTHENTICATED" | "INVALID_ACTOR" | "NOT_FOUND" | "INVALID_TRANSITION" | "UPDATE_FAILED";
    };

/**
 * Staff-initiated Requirement completion judgment — satisfied / rejected /
 * waived, or a manual re-submission — completely independent from
 * Evidence review (reviewRequirementEvidence above). Never infer one from
 * the other: reviewing a file never marks its Slot satisfied, and this
 * action never touches any Evidence row. Legality of the specific
 * from-state -> to-state transition is enforced server-side by
 * setRequirementSlotStatus itself (REQUIREMENT_SLOT_STATUS_TRANSITIONS);
 * the check here is only "is this a status a staff member may ever
 * deliberately target" (REQUIREMENT_SLOT_STATUS_TRANSITIONABLE excludes
 * 'pending', which is never a legal target from any state). Never accepts
 * statusChangedByProfileId from the client; always the caller's own
 * getCurrentProfile(), and source is hardcoded to 'crm_manual' — this
 * action is reachable only from an authenticated CRM session.
 */
export async function setDossierRequirementSlotStatus(
  input: SetDossierRequirementSlotStatusInput
): Promise<SetDossierRequirementSlotStatusResult> {
  if (!isNonEmptyString(input.slotId) || !UUID_PATTERN.test(input.slotId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!(REQUIREMENT_SLOT_STATUS_TRANSITIONABLE as string[]).includes(input.status)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    console.error("[expedientes actions] setDossierRequirementSlotStatus rejected: no authenticated profile.");
    return { status: "error", code: "UNAUTHENTICATED" };
  }

  const result = await setRequirementSlotStatus(input.slotId, input.status, "crm_manual", profile.id);
  if (result.status !== "ok") {
    return { status: "error", code: result.code };
  }

  return { status: "success", requirementSlot: result.requirementSlot };
}

// ============================================================================
// getDossierRequirements
// ============================================================================

export type GetDossierRequirementsResult =
  | { status: "success"; requirementSlots: RequirementSlot[]; evidence: DocumentEvidence[] }
  | { status: "error"; code: "INVALID_INPUT" | "UNAUTHENTICATED" | "QUERY_FAILED" };

/**
 * Read-only refetch of both Requirement Slots and Evidence for one real
 * Application. Added beyond the four Server Actions the Milestone 12C
 * architecture review named up front, because "refetch after mutation"
 * (rather than optimistic merging — the approved design) can only be
 * driven from client code through a Server Action; the underlying
 * services are server-only and unreachable from the client directly. The
 * Dossier calls this after every upload / review / status-change to
 * replace its Requirement Slot and Evidence state wholesale — never a
 * piecemeal merge of just the single item a mutation returned, which
 * would miss any Slot-status side effect that mutation also caused.
 */
export async function getDossierRequirements(applicationId: string): Promise<GetDossierRequirementsResult> {
  if (!isNonEmptyString(applicationId) || !UUID_PATTERN.test(applicationId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    console.error("[expedientes actions] getDossierRequirements rejected: no authenticated profile.");
    return { status: "error", code: "UNAUTHENTICATED" };
  }

  const [slotsResult, evidenceResult] = await Promise.all([
    getRequirementSlotsByApplicationId(applicationId),
    getEvidenceByApplicationId(applicationId),
  ]);

  if (slotsResult.status !== "ok" || evidenceResult.status !== "ok") {
    console.error("[expedientes actions] getDossierRequirements: one or both underlying reads failed.");
    return { status: "error", code: "QUERY_FAILED" };
  }

  return { status: "success", requirementSlots: slotsResult.requirementSlots, evidence: evidenceResult.evidence };
}
