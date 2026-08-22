"use server";

import { createNote } from "@/lib/services/notes";
import { createAlert, setAlertStatus } from "@/lib/services/alerts";
import {
  reviewDocumentEvidence,
  createSignedEvidenceUrl,
  getEvidenceByApplicationId,
} from "@/lib/services/document-evidence";
import { ingestDocument } from "@/lib/services/document-intake";
import { setRequirementSlotStatus, getRequirementSlotsByApplicationId } from "@/lib/services/requirement-slots";
import { requireCapability } from "@/lib/auth/authorize";
import { getApplicationById } from "@/lib/services/applications";
import { getClientById } from "@/lib/services/clients";
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
 *
 * MILESTONE 16 — this file spans three different permission boundaries and
 * they must not be collapsed into one:
 *   - Authoring (note:create, alert:create) — every operational role.
 *   - Supervision (alert:set_status) — administrador/gerente only;
 *     resolving someone else's alert is a management act.
 *   - Analysis judgment (evidence:review, requirement_slot:set_status) —
 *     administrador/gerente/analista. Deliberately NOT the advisor's, per
 *     the Milestone 16 role definitions.
 *   - Intake (evidence:upload) — administrador/gerente/asesor. The advisor
 *     collects the document; the analyst rules on it.
 * The two reads (getRequirementEvidenceViewUrl, getDossierRequirements) are
 * open to every role including `consulta`.
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
      code: "INVALID_INPUT" | "UNAUTHENTICATED" | "FORBIDDEN" | "CLIENT_NOT_FOUND" | "CREATE_FAILED";
    };

export async function createDossierNote(
  input: CreateDossierNoteInput
): Promise<CreateDossierNoteResult> {
  // Authorize before ANY input validation or database read. This action
  // previously ran a getClientById() existence check ahead of resolving the
  // caller, which let an unauthorized caller tell CLIENT_NOT_FOUND from
  // INVALID_INPUT and probe for client records they may not touch.
  const auth = await requireCapability("note:create");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(input.clientId) || !UUID_PATTERN.test(input.clientId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  const text = isNonEmptyString(input.text) ? input.text.trim() : "";
  if (!text || text.length > MAX_NOTE_LENGTH) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!isNoteType(input.type) || !isNotePriority(input.priority)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  // Real existence check against the Client Engine (Milestone 14E) —
  // replaces the former soft check against demo data now that
  // dossier_notes.client_id is a real, FK-constrained reference.
  const clientResult = await getClientById(auth.profile.branchScope, input.clientId);
  if (clientResult.status !== "ok") {
    return { status: "error", code: "CLIENT_NOT_FOUND" };
  }

  try {
    const note = await createNote({
      clientId: input.clientId,
      authorProfileId: auth.profile.id,
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
      code: "INVALID_INPUT" | "UNAUTHENTICATED" | "FORBIDDEN" | "CLIENT_NOT_FOUND" | "CREATE_FAILED";
    };

export async function createDossierAlert(
  input: CreateDossierAlertInput
): Promise<CreateDossierAlertResult> {
  // Authorize first — same existence-probe reasoning as createDossierNote.
  const auth = await requireCapability("alert:create");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(input.clientId) || !UUID_PATTERN.test(input.clientId)) {
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

  // Real existence check against the Client Engine (Milestone 14E) —
  // replaces the former soft check against demo data now that
  // dossier_alerts.client_id is a real, FK-constrained reference.
  const clientResult = await getClientById(auth.profile.branchScope, input.clientId);
  if (clientResult.status !== "ok") {
    return { status: "error", code: "CLIENT_NOT_FOUND" };
  }

  try {
    const alert = await createAlert({
      clientId: input.clientId,
      createdByProfileId: auth.profile.id,
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
  /** Required when resolving (targetActive === false); must be absent when
   * reactivating. MILESTONE 26B-8. */
  resolutionNote?: string;
}

export type SetDossierAlertStatusResult =
  | { status: "success"; alert: DossierAlert }
  | { status: "error"; code: "INVALID_INPUT" | "UNAUTHENTICATED" | "FORBIDDEN" | "UPDATE_FAILED" };

/**
 * Never accepts resolvedByProfileId from the client — only alertId and the
 * intended target state (true = reactivate, false = resolve). The actor
 * is always the caller's own getCurrentProfile(), applied server-side by
 * src/lib/services/alerts.ts's setAlertStatus.
 *
 * Milestone 16 — capability `alert:set_status`, deliberately distinct from
 * `alert:create` and held only by administrador and gerente. Raising a
 * concern is ordinary operational work; clearing one — including one
 * somebody else raised — is a supervisory act, and an alert that any
 * advisor could silently resolve would not be much of a control.
 */
export async function setDossierAlertStatus(
  input: SetDossierAlertStatusInput
): Promise<SetDossierAlertStatusResult> {
  const auth = await requireCapability("alert:set_status");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(input.alertId) || !UUID_PATTERN.test(input.alertId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (typeof input.targetActive !== "boolean") {
    return { status: "error", code: "INVALID_INPUT" };
  }
  // MILESTONE 26B-8 — clearing a risk flag requires a reason, and reopening
  // one cannot carry a resolution. Re-checked in the RPC, which is where the
  // write happens and therefore the rule that cannot be routed around.
  const resolutionNote = isNonEmptyString(input.resolutionNote)
    ? input.resolutionNote.trim()
    : undefined;
  if (!input.targetActive && !resolutionNote) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (input.targetActive && resolutionNote) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  try {
    const alert = await setAlertStatus(
      input.alertId,
      input.targetActive,
      auth.profile.id,
      resolutionNote
    );
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
        | "FORBIDDEN"
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
 * Accepts FormData (applicationId + requirementSlotId + file + optional
 * replacesEvidenceId), since a File can't cross a Server Action boundary
 * as JSON. Every call creates a NEW Evidence row (createDocumentEvidence
 * never updates an existing one); there is no "replace" distinct from
 * upload here — replacesEvidenceId, when present, is explicit
 * supersession of one specific prior row, never a mutation of it. The
 * "partial" result (Evidence created, Slot transition failed) is passed
 * through as its own distinct status — never collapsed into "success" —
 * so the caller can surface it and retry the transition alone rather
 * than re-uploading.
 *
 * The actor is always the caller's own getCurrentProfile() — never
 * accepted from the client — and uploadedSource is hardcoded to
 * 'crm_manual': this action is reachable only from an authenticated CRM
 * session.
 *
 * Milestone 15D: routes through the canonical
 * src/lib/services/document-intake.ts#ingestDocument orchestrator
 * instead of calling createDocumentEvidence directly — the same
 * channel-neutral entry point a future WhatsApp/email adapter will use
 * — rather than maintaining two parallel upload implementations.
 * applicationId is now required so ingestDocument's classification step
 * can enforce that requirementSlotId genuinely belongs to THIS
 * Application (closing a gap this action never actually checked before:
 * it previously trusted any well-formed UUID). Because this UI always
 * supplies requirementSlotId, classification always resolves via the
 * "explicit_selection" method — behavior for every legitimate upload is
 * unchanged; only a slot that doesn't belong to this Application, or
 * isn't a document-kind slot, now surfaces one call earlier than before
 * (as needs_review, mapped to SLOT_NOT_FOUND below — the same code this
 * action already returned for "slot not found" prior to this milestone).
 */
export async function uploadRequirementEvidence(formData: FormData): Promise<UploadRequirementEvidenceResult> {
  // Authorize before touching the FormData at all — nothing about the
  // submitted file or its target slot should be parsed, let alone written
  // to storage, on behalf of a caller who may not upload.
  const auth = await requireCapability("evidence:upload");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  const applicationId = formData.get("applicationId");
  const requirementSlotId = formData.get("requirementSlotId");
  const file = formData.get("file");
  const replacesEvidenceIdRaw = formData.get("replacesEvidenceId");

  if (typeof applicationId !== "string" || !UUID_PATTERN.test(applicationId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
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

  // ==========================================================================
  // MILESTONE 25B-2 — BRANCH GATE BEFORE ANY STORAGE OR DATABASE WRITE
  // ==========================================================================
  //
  // Uploading is a mutation on a dossier, so it must be at least as hard to
  // reach as viewing one. The application is re-read through the caller's own
  // effective branch scope; an application in another branch resolves to
  // nothing and the caller gets SLOT_NOT_FOUND — the exact code this action
  // already returns for a slot that does not belong to this application, so
  // out-of-scope and unknown remain indistinguishable.
  //
  // Placed BEFORE ingestDocument() deliberately: no bytes reach Storage, no
  // row reaches dossier_documents, and no requirement slot transitions, for a
  // caller who may not operate on this file.
  const applicationResult = await getApplicationById(auth.profile.branchScope, applicationId);
  if (applicationResult.status !== "ok") {
    return { status: "error", code: "SLOT_NOT_FOUND" };
  }

  const result = await ingestDocument({
    applicationId,
    requirementSlotId,
    file,
    actorProfileId: auth.profile.id,
    source: "crm_manual",
    replacesEvidenceId: typeof replacesEvidenceIdRaw === "string" ? replacesEvidenceIdRaw : undefined,
  });

  if (result.status === "error") {
    // CLASSIFICATION_FAILED is a genuine infra read failure (loading the
    // Application's Requirement Slots) — maps to the same generic
    // infra-failure code this action already exposed for other
    // unrecoverable backend failures.
    return { status: "error", code: result.code === "CLASSIFICATION_FAILED" ? "INSERT_FAILED" : result.code };
  }
  if (result.status === "partial") {
    return { status: "partial", evidence: result.evidence, code: result.code };
  }
  if (result.status === "needs_review") {
    // Unreachable via this UI in practice — requirementSlotId is always
    // supplied, so classification always takes the explicit_selection
    // path (found or not found), never single_open_slot/ambiguous. Kept
    // exhaustive and mapped to the same codes this action already
    // returned for these exact conditions before Milestone 15D.
    const code =
      result.reason === "unsupported_file_type"
        ? "INVALID_MIME"
        : result.reason === "invalid_file"
          ? "INVALID_FILE_SIZE"
          : result.reason === "no_matching_requirement"
            ? "SLOT_NOT_FOUND"
            : "INVALID_INPUT";
    return { status: "error", code };
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
      code:
        | "INVALID_INPUT"
        | "UNAUTHENTICATED"
        | "FORBIDDEN"
        | "NOT_FOUND"
        | "ALREADY_REVIEWED"
        | "UPDATE_FAILED";
    };

/**
 * Records a factual review of one Evidence item — never accepts
 * reviewedByProfileId from the client, always the caller's own
 * getCurrentProfile(). Does not touch the owning Requirement Slot's
 * status; see setDossierRequirementSlotStatus below for that, a
 * deliberately separate action (src/lib/services/document-evidence.ts#
 * reviewDocumentEvidence's own doc comment: "Slot decision remains a
 * separate action" — never infer one from the other).
 *
 * Milestone 16 — capability `evidence:review`, an ANALYSIS act: held by
 * administrador, gerente and analista, and deliberately NOT by asesor. An
 * advisor supplies the document (`evidence:upload`); attesting that it is
 * acceptable is somebody else's signature. Note that this capability and
 * `requirement_slot:set_status` are granted to the same roles today but
 * remain separate capabilities, mirroring the two actions' deliberate
 * independence.
 */
export async function reviewRequirementEvidence(evidenceId: string): Promise<ReviewRequirementEvidenceResult> {
  const auth = await requireCapability("evidence:review");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(evidenceId) || !UUID_PATTERN.test(evidenceId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  // MILESTONE 25B-2 — scope is threaded into the service, which resolves the
  // evidence through its requirement slot -> application chain and applies the
  // branch predicate there. Out of scope returns NOT_FOUND, identical to a
  // nonexistent evidence id.
  const result = await reviewDocumentEvidence(auth.profile.branchScope, evidenceId, auth.profile.id);
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
  | {
      status: "error";
      /** MILESTONE 25B-S0: `SIGN_FAILED` was removed and a malformed id now
       * returns NOT_FOUND rather than INVALID_INPUT. Distinct codes let a
       * caller tell "this document exists but something went wrong" from "no
       * such document" — an existence oracle over other people's dossiers.
       * UNAUTHENTICATED/FORBIDDEN remain distinct because they describe the
       * CALLER, not the target, and reveal nothing about which documents
       * exist. */
      code: "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND";
    };

/** Mints a short-lived (90s) signed URL for one Evidence item — never a
 * permanent or public one.
 *
 * Milestone 16 — a READ (`evidence:read`), granted to every role including
 * `consulta`: viewing a document that is already visible in the dossier is
 * exactly what a read-only role is for, and the URL it returns expires in
 * 90 seconds. */
export async function getRequirementEvidenceViewUrl(
  evidenceId: string
): Promise<GetRequirementEvidenceViewUrlResult> {
  const auth = await requireCapability("evidence:read");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  // A malformed id is indistinguishable from an unknown one. Returning
  // INVALID_INPUT here would confirm that well-formed ids are the ones worth
  // probing with.
  if (!isNonEmptyString(evidenceId) || !UUID_PATTERN.test(evidenceId)) {
    return { status: "error", code: "NOT_FOUND" };
  }

  // The service resolves the full evidence -> slot -> application -> client
  // chain server-side and mints only if every link holds. It accepts nothing
  // from the caller but the evidence id, so no client-supplied client,
  // application or branch id can widen what is reachable.
  const result = await createSignedEvidenceUrl(auth.profile.branchScope, evidenceId);
  if (result.status !== "ok") {
    return { status: "error", code: "NOT_FOUND" };
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
      code:
        | "INVALID_INPUT"
        | "UNAUTHENTICATED"
        | "FORBIDDEN"
        | "INVALID_ACTOR"
        | "NOT_FOUND"
        | "INVALID_TRANSITION"
        | "UPDATE_FAILED";
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
 *
 * Milestone 16 — capability `requirement_slot:set_status`, an ANALYSIS
 * judgment: held by administrador, gerente and analista, NOT by asesor.
 * Its legal targets include `satisfied`, `rejected` and `waived` (see
 * REQUIREMENT_SLOT_STATUS_TRANSITIONABLE), i.e. declaring a requirement
 * met or excused — the determination an advisor collects evidence FOR,
 * not one they make.
 */
export async function setDossierRequirementSlotStatus(
  input: SetDossierRequirementSlotStatusInput
): Promise<SetDossierRequirementSlotStatusResult> {
  const auth = await requireCapability("requirement_slot:set_status");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(input.slotId) || !UUID_PATTERN.test(input.slotId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!(REQUIREMENT_SLOT_STATUS_TRANSITIONABLE as string[]).includes(input.status)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const result = await setRequirementSlotStatus(
    input.slotId,
    input.status,
    "crm_manual",
    auth.profile.id
  );
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
  | { status: "error"; code: "INVALID_INPUT" | "UNAUTHENTICATED" | "FORBIDDEN" | "QUERY_FAILED" };

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
  const auth = await requireCapability("requirement:read");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(applicationId) || !UUID_PATTERN.test(applicationId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const [slotsResult, evidenceResult] = await Promise.all([
    getRequirementSlotsByApplicationId(auth.profile.branchScope, applicationId),
    getEvidenceByApplicationId(auth.profile.branchScope, applicationId),
  ]);

  if (slotsResult.status !== "ok" || evidenceResult.status !== "ok") {
    console.error("[expedientes actions] getDossierRequirements: one or both underlying reads failed.");
    return { status: "error", code: "QUERY_FAILED" };
  }

  return { status: "success", requirementSlots: slotsResult.requirementSlots, evidence: evidenceResult.evidence };
}
