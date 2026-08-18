import "server-only";
import { createHash } from "node:crypto";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { applyBranchScope, isEmptyScope } from "@/lib/services/branch-scope-query";
import { setRequirementSlotStatus } from "@/lib/services/requirement-slots";
import {
  ALLOWED_MIME_TYPES,
  BUCKET,
  MAX_FILE_SIZE_BYTES,
  MIME_TYPE_EXTENSIONS,
  VIEW_URL_TTL_SECONDS,
  buildTimestampComponent,
} from "@/lib/config/evidence-storage";
import type {
  BranchScope,
  DocumentEvidence,
  EvidenceUploadedSource,
} from "@/types";

/**
 * Server-only service for the Document Evidence Engine (Milestone 12B,
 * finalized in Milestone 12E4 — see the Milestone 12 and 12E architecture
 * reviews). Evidence belongs to a Requirement Slot, and only to a
 * Requirement Slot — never to a client/application legacy-id pair or a
 * hardcoded `type`. `dossier_documents` is the sole, final table backing
 * this model; the legacy client_legacy_id/application_legacy_id/type/
 * status columns and the temporary 12B→12E write-compatibility shim that
 * used to populate them have been removed entirely (Milestone 12E4) —
 * this service never touches, reads, or writes them anywhere.
 *
 * Deliberately minimal, matching the architecture review's approved
 * surface: two reads, create, review, signed URL. No generic update
 * function — every field on an Evidence row is either set once at
 * creation and never touched again, or (reviewed_at/reviewed_by_
 * profile_id) set exactly once by reviewDocumentEvidence and never again.
 */

interface DocumentEvidenceRow {
  id: string;
  requirement_slot_id: string;
  replaces_evidence_id: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  file_sha256: string | null;
  uploaded_at: string | null;
  uploaded_by_profile_id: string | null;
  uploaded_source: string | null;
  reviewed_at: string | null;
  reviewed_by_profile_id: string | null;
  uploaded_by: { full_name: string } | null;
  reviewed_by: { full_name: string } | null;
}

/** MILESTONE 25B-1 — evidence derives its branch two hops up:
 * dossier_documents -> requirement_slots -> applications.branch_id. Both hops
 * are `!inner`, so evidence whose chain leaves scope disappears rather than
 * returning with a null relation. */
const EVIDENCE_APPLICATION_SCOPE_EMBED =
  "scope_slot:requirement_slots!dossier_documents_requirement_slot_id_fkey!inner(" +
  "scope_application:applications!requirement_slots_application_id_fkey!inner(branch_id))";

const EVIDENCE_SELECT =
  "id, requirement_slot_id, replaces_evidence_id, storage_bucket, storage_path, file_name, mime_type, file_size_bytes, file_sha256, uploaded_at, uploaded_by_profile_id, uploaded_source, reviewed_at, reviewed_by_profile_id, " +
  "uploaded_by:profiles!dossier_documents_uploaded_by_profile_id_fkey(full_name), " +
  "reviewed_by:profiles!dossier_documents_reviewed_by_profile_id_fkey(full_name)";

/** Every field describing the file is guaranteed non-null for every row in
 * the table — dossier_documents_file_metadata_check requires all eight
 * file columns to be populated together, and both this service's own
 * inserts and the Milestone 12A backfilled legacy rows always have a real
 * file attached; no code path creates a file-less row anymore. */
function toDocumentEvidence(row: DocumentEvidenceRow, supersededByEvidenceId?: string): DocumentEvidence {
  return {
    id: row.id,
    requirementSlotId: row.requirement_slot_id,
    replacesEvidenceId: row.replaces_evidence_id ?? undefined,
    supersededByEvidenceId,
    storageBucket: row.storage_bucket as string,
    storagePath: row.storage_path as string,
    fileName: row.file_name as string,
    mimeType: row.mime_type as string,
    fileSizeBytes: row.file_size_bytes as number,
    fileSha256: row.file_sha256 as string,
    uploadedAt: row.uploaded_at as string,
    uploadedByProfileId: row.uploaded_by_profile_id ?? undefined,
    uploadedByFullName: row.uploaded_by?.full_name ?? undefined,
    uploadedSource: row.uploaded_source as EvidenceUploadedSource,
    reviewedAt: row.reviewed_at ?? undefined,
    reviewedByProfileId: row.reviewed_by_profile_id ?? undefined,
    reviewedByFullName: row.reviewed_by?.full_name ?? undefined,
  };
}

/** Computes supersededByEvidenceId across one result set — a row is
 * superseded when some OTHER row in the same set has replaces_evidence_id
 * pointing at it. Never a stored column; always derived at read time from
 * whatever set of rows is actually being returned. */
function withSupersessionInfo(rows: DocumentEvidenceRow[]): DocumentEvidence[] {
  const supersededBy = new Map<string, string>();
  for (const row of rows) {
    if (row.replaces_evidence_id) {
      supersededBy.set(row.replaces_evidence_id, row.id);
    }
  }
  return rows.map((row) => toDocumentEvidence(row, supersededBy.get(row.id)));
}

export type GetEvidenceResult = { status: "ok"; evidence: DocumentEvidence[] } | { status: "error" };

/** Loads every Evidence row for one Requirement Slot, newest first.
 * Exposes supersession info (supersededByEvidenceId) computed from this
 * same result set. Does not rely on, or query, any legacy type/client/
 * application field. */
export async function getEvidenceByRequirementSlotId(
  scope: BranchScope,
  requirementSlotId: string
): Promise<GetEvidenceResult> {
  if (isEmptyScope(scope)) return { status: "ok", evidence: [] };

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await applyBranchScope(
      supabase
        .from("dossier_documents")
        .select(
          scope.mode === "national"
            ? EVIDENCE_SELECT
            : `${EVIDENCE_SELECT}, ${EVIDENCE_APPLICATION_SCOPE_EMBED}`
        )
        .eq("requirement_slot_id", requirementSlotId),
      scope,
      "scope_slot.scope_application.branch_id"
    ).order("created_at", { ascending: false });

    if (error) {
      console.error("[document-evidence service] Failed to load evidence by slot:", error.message);
      return { status: "error" };
    }

    const rows = (data ?? []) as unknown as DocumentEvidenceRow[];
    return { status: "ok", evidence: withSupersessionInfo(rows) };
  } catch (error) {
    console.error(
      "[document-evidence service] Unexpected failure loading evidence by slot:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

/**
 * Loads every Evidence row across every Requirement Slot belonging to one
 * Application. Resolves purely through requirement_slot_id ->
 * requirement_slots.application_id — deliberately never queries dossier_
 * documents.application_legacy_id, the legacy path this service does not
 * use. Two-step (slot ids, then evidence rows) rather than a single
 * embedded-filter query, for clarity and reliability.
 */
export async function getEvidenceByApplicationId(
  scope: BranchScope,
  applicationId: string
): Promise<GetEvidenceResult> {
  if (isEmptyScope(scope)) return { status: "ok", evidence: [] };

  try {
    const supabase = getSupabaseServerClient();

    // SCOPED PARENT IDS. The slot lookup is itself scoped through the
    // application, so an out-of-scope application yields no slot ids and
    // therefore no evidence — the branch check happens once, at the parent,
    // rather than being re-expressed two hops down.
    const { data: slots, error: slotsError } = await applyBranchScope(
      supabase
        .from("requirement_slots")
        .select(
          scope.mode === "national"
            ? "id"
            : "id, scope_application:applications!requirement_slots_application_id_fkey!inner(branch_id)"
        )
        .eq("application_id", applicationId),
      scope,
      "scope_application.branch_id"
    );

    if (slotsError) {
      console.error(
        "[document-evidence service] Failed to load requirement slots for application:",
        slotsError.message
      );
      return { status: "error" };
    }

    // The select string is chosen at runtime (national omits the join), so
    // PostgREST cannot statically infer the row shape. Only `id` is read.
    const slotRows = (slots ?? []) as unknown as { id: string }[];
    const slotIds = slotRows.map((slot) => slot.id);
    if (slotIds.length === 0) {
      return { status: "ok", evidence: [] };
    }

    const { data, error } = await supabase
      .from("dossier_documents")
      .select(EVIDENCE_SELECT)
      .in("requirement_slot_id", slotIds)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[document-evidence service] Failed to load evidence by application:", error.message);
      return { status: "error" };
    }

    const rows = (data ?? []) as unknown as DocumentEvidenceRow[];
    return { status: "ok", evidence: withSupersessionInfo(rows) };
  } catch (error) {
    console.error(
      "[document-evidence service] Unexpected failure loading evidence by application:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

export interface CreateDocumentEvidenceInput {
  requirementSlotId: string;
  file: File;
  /** Null for external-intake channels with no CRM profile. */
  actorProfileId: string | null;
  uploadedSource: EvidenceUploadedSource;
  /** Explicit supersession of one specific prior Evidence row — must
   * belong to the same requirementSlotId, or the call is rejected. */
  replacesEvidenceId?: string;
}

export type CreateDocumentEvidenceResult =
  | { status: "ok"; evidence: DocumentEvidence }
  | { status: "partial"; evidence: DocumentEvidence; code: "SLOT_TRANSITION_FAILED" }
  | {
      status: "error";
      code:
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
 * Creates a NEW Evidence row for a document-kind Requirement Slot — never
 * updates an existing row (see the architecture review's "Every Upload =
 * New Row"). Every validation that can be checked without touching
 * Storage happens first,
 * Storage upload happens before the DB insert using a freshly generated,
 * never-reused path, and a failed insert after a successful upload
 * triggers the same best-effort orphan cleanup (logged, never blocking).
 * No historical Evidence row is ever touched or deleted by any failure
 * path here.
 *
 * Rejects upfront (before touching Storage) if the Slot isn't a
 * document-kind Slot, or if the Slot is already 'satisfied' or 'waived' —
 * the conservative choice: this schema has no approved transition from
 * either terminal state back into the active lifecycle, so accepting new
 * evidence against one would either silently fail to reflect it in the
 * Slot's status or require extending the transition graph beyond what was
 * actually approved (only under_review -> submitted was).
 *
 * After a successful insert, attempts to transition the Slot toward
 * 'submitted' (REQUIREMENT_SLOT_STATUS_TRANSITIONS) by reusing
 * setRequirementSlotStatus unchanged — the same "call the existing
 * mechanism, don't redesign it" discipline Milestone 11 used for
 * Application creation + Slot snapshot. If the Slot is already
 * 'submitted', this is skipped entirely (a no-op, not an error) —
 * uploading additional independent evidence against an already-submitted
 * Slot is expected and legitimate (e.g. Government ID back photo arriving
 * after the front already did). If the transition genuinely fails after
 * the Evidence row was already committed, this returns a distinct
 * "partial" result carrying the created Evidence — the row is never
 * rolled back or deleted. The safe recovery is retrying the SLOT
 * TRANSITION alone (a fresh setRequirementSlotStatus call for this slot),
 * never a full retry of createDocumentEvidence — that would create a
 * second, duplicate Evidence row for the same file.
 */
export async function createDocumentEvidence(
  input: CreateDocumentEvidenceInput
): Promise<CreateDocumentEvidenceResult> {
  if (input.actorProfileId !== null && input.uploadedSource !== "crm_manual") {
    return { status: "error", code: "INVALID_ACTOR" };
  }

  const mimeType = input.file.type;
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return { status: "error", code: "INVALID_MIME" };
  }
  if (input.file.size <= 0 || input.file.size > MAX_FILE_SIZE_BYTES) {
    return { status: "error", code: "INVALID_FILE_SIZE" };
  }

  const supabase = getSupabaseServerClient();

  const { data: slot, error: slotError } = await supabase
    .from("requirement_slots")
    .select("id, application_id, code, requirement_kind, status")
    .eq("id", input.requirementSlotId)
    .maybeSingle();

  if (slotError) {
    console.error("[document-evidence service] Failed to look up requirement slot:", slotError.message);
    return { status: "error", code: "SLOT_NOT_FOUND" };
  }
  if (!slot) {
    return { status: "error", code: "SLOT_NOT_FOUND" };
  }
  if (slot.requirement_kind !== "document") {
    return { status: "error", code: "NOT_DOCUMENT_KIND" };
  }
  if (slot.status === "satisfied" || slot.status === "waived") {
    return { status: "error", code: "SLOT_TERMINAL" };
  }

  if (input.replacesEvidenceId) {
    const { data: replaced, error: replacedError } = await supabase
      .from("dossier_documents")
      .select("id, requirement_slot_id")
      .eq("id", input.replacesEvidenceId)
      .maybeSingle();

    if (replacedError) {
      console.error("[document-evidence service] Failed to look up evidence being replaced:", replacedError.message);
      return { status: "error", code: "REPLACES_NOT_FOUND" };
    }
    if (!replaced) {
      return { status: "error", code: "REPLACES_NOT_FOUND" };
    }
    if (replaced.requirement_slot_id !== slot.id) {
      return { status: "error", code: "CROSS_SLOT_REPLACEMENT" };
    }
  }

  const bytes = Buffer.from(await input.file.arrayBuffer());
  const fileSha256 = createHash("sha256").update(bytes).digest("hex");
  const extension = MIME_TYPE_EXTENSIONS[mimeType];
  const uploadUuid = crypto.randomUUID();
  const timestampComponent = buildTimestampComponent(new Date());
  const storagePath = `applications/${slot.application_id}/requirements/${slot.id}/${timestampComponent}-${uploadUuid}.${extension}`;

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, bytes, {
    contentType: mimeType,
    upsert: false,
  });

  if (uploadError) {
    console.error("[document-evidence service] Failed to upload evidence file to storage:", uploadError.message);
    return { status: "error", code: "UPLOAD_FAILED" };
  }

  const { data: inserted, error: insertError } = await supabase
    .from("dossier_documents")
    .insert({
      requirement_slot_id: slot.id,
      replaces_evidence_id: input.replacesEvidenceId ?? null,
      storage_bucket: BUCKET,
      storage_path: storagePath,
      file_name: input.file.name,
      mime_type: mimeType,
      file_size_bytes: input.file.size,
      file_sha256: fileSha256,
      uploaded_source: input.uploadedSource,
      uploaded_at: new Date().toISOString(),
      uploaded_by_profile_id: input.actorProfileId,
    })
    .select(EVIDENCE_SELECT)
    .single<DocumentEvidenceRow>();

  if (insertError || !inserted) {
    console.error(
      "[document-evidence service] Failed to insert evidence row — attempting to clean up the orphaned storage object:",
      insertError?.message ?? "no row returned"
    );
    const { error: cleanupError } = await supabase.storage.from(BUCKET).remove([storagePath]);
    if (cleanupError) {
      console.error(
        `[document-evidence service] Orphaned storage object could not be cleaned up (${storagePath}):`,
        cleanupError.message
      );
    }
    return { status: "error", code: "INSERT_FAILED" };
  }

  const evidence = toDocumentEvidence(inserted);

  if (slot.status !== "submitted") {
    const transitionResult = await setRequirementSlotStatus(
      slot.id,
      "submitted",
      input.uploadedSource,
      input.actorProfileId
    );
    if (transitionResult.status !== "ok") {
      console.error(
        "[document-evidence service] Evidence created but slot transition to 'submitted' failed — safe to retry " +
          "setRequirementSlotStatus alone for this slot; never retry createDocumentEvidence itself, which would " +
          "create a duplicate Evidence row:",
        transitionResult.code
      );
      return { status: "partial", evidence, code: "SLOT_TRANSITION_FAILED" };
    }
  }

  return { status: "ok", evidence };
}

export type ReviewDocumentEvidenceResult =
  | { status: "ok"; evidence: DocumentEvidence }
  | { status: "error"; code: "NOT_FOUND" | "ALREADY_REVIEWED" | "UPDATE_FAILED" };

/**
 * Records a factual, immutable audit fact — who looked at this specific
 * file, and when — never a judgment, never a status. Always a real CRM
 * profile: unlike createDocumentEvidence there is no separate source
 * parameter, since review by definition requires an actual person, not an
 * external channel. Reviewing the file does NOT transition the owning
 * Requirement Slot — satisfied/rejected remains a deliberate, separate
 * action against the Slot itself (architecture review: "Slot decision
 * remains a separate action").
 *
 * Reviewing an already-reviewed row is rejected outright (ALREADY_
 * REVIEWED), never silently idempotent and never an overwrite — an audit
 * fact that could be silently overwritten wouldn't be trustworthy as one.
 * Race-safe: the guarded UPDATE (`.is("reviewed_at", null)`) means a
 * concurrent double-review attempt can never both succeed.
 *
 * Previously blocked entirely by dossier_documents_review_check, which
 * tied reviewed_at/reviewed_by_profile_id to the legacy `status` column
 * being one of three CONCLUDED values — a constraint every Evidence row
 * (always created at status = 'recibido') could never satisfy. Resolved
 * by 20260809180000_scope_dossier_documents_review_check_to_legacy_rows.sql,
 * which scopes that invariant to legacy rows (requirement_slot_id is
 * null) only; rows with a requirement_slot_id are no longer bound to it,
 * so this function's own guard below (reject if already reviewed) is now
 * the sole and sufficient enforcement, exactly as originally intended.
 */
export async function reviewDocumentEvidence(
  evidenceId: string,
  actorProfileId: string
): Promise<ReviewDocumentEvidenceResult> {
  const supabase = getSupabaseServerClient();

  const { data: current, error: fetchError } = await supabase
    .from("dossier_documents")
    .select("id, reviewed_at")
    .eq("id", evidenceId)
    .maybeSingle();

  if (fetchError) {
    console.error("[document-evidence service] Failed to look up evidence before review:", fetchError.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }
  if (!current) {
    return { status: "error", code: "NOT_FOUND" };
  }
  if (current.reviewed_at !== null) {
    return { status: "error", code: "ALREADY_REVIEWED" };
  }

  const { data: updated, error: updateError } = await supabase
    .from("dossier_documents")
    .update({ reviewed_at: new Date().toISOString(), reviewed_by_profile_id: actorProfileId })
    .eq("id", evidenceId)
    .is("reviewed_at", null)
    .select(EVIDENCE_SELECT)
    .maybeSingle<DocumentEvidenceRow>();

  if (updateError) {
    console.error("[document-evidence service] Failed to update evidence review:", updateError.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }
  if (!updated) {
    return { status: "error", code: "ALREADY_REVIEWED" };
  }

  return { status: "ok", evidence: toDocumentEvidence(updated) };
}

/** The narrow projection createSignedEvidenceUrl reads. Only the two storage
 * fields are used; the embedded relations exist to force the INNER JOINs that
 * prove the ownership chain resolves, and to give Milestone 25B a
 * ready-made `application.branch_id` to filter on. */
interface SignedEvidenceChainRow {
  storage_bucket: string | null;
  storage_path: string | null;
  requirement_slot_id: string | null;
}

export type CreateSignedEvidenceUrlResult =
  | { status: "ok"; url: string }
  /** DELIBERATELY ONE ERROR CODE. See the doc comment: a caller must not be
   * able to distinguish "no such evidence" from "evidence exists but you may
   * not have it" from "evidence exists but is not attached to a dossier". */
  | { status: "error"; code: "NOT_FOUND" };

/**
 * ============================================================================
 * THE ONLY PLACE A SIGNED DOCUMENT URL IS MINTED (Milestone 25B-S0)
 * ============================================================================
 *
 * Short-lived (VIEW_URL_TTL_SECONDS — 90s), freshly minted on every call,
 * never cached and never reused across callers or authorization contexts.
 *
 * ----------------------------------------------------------------------------
 * OWNERSHIP CHAIN — RESOLVED SERVER-SIDE, FROM THE EVIDENCE ID ONLY
 * ----------------------------------------------------------------------------
 * A URL is minted only when the evidence resolves through its COMPLETE chain:
 *
 *   dossier_documents.requirement_slot_id
 *     -> requirement_slots.application_id
 *       -> applications.client_id
 *         -> clients.id
 *
 * The `!inner` embeds make this an INNER JOIN at every hop, so evidence whose
 * chain is broken at ANY link — no slot, a slot with no application, an
 * application with no client — does not come back at all and no URL is
 * produced. Previously this function looked the row up by id alone and checked
 * only that `requirement_slot_id` was non-null, which proved the column had a
 * value but never that the value pointed anywhere real.
 *
 * Nothing is taken from the caller except the evidence id. Client id,
 * application id and branch are never accepted as input, so a caller cannot
 * assert a context it does not have — the chain is derived from stored data or
 * the request fails.
 *
 * ----------------------------------------------------------------------------
 * WHAT THIS DOES NOT YET DO, STATED PLAINLY
 * ----------------------------------------------------------------------------
 * It does not check whether THIS caller may access THIS dossier, because as of
 * this milestone the CRM has no per-dossier ownership model: getClientById()
 * applies no restriction, the /expedientes route has no per-client gate, and
 * all five roles hold `evidence:read`. There is currently no boundary here to
 * cross — a caller who can mint a URL for a document can equally open that
 * dossier and click view.
 *
 * MILESTONE 25B-1 CLOSED THAT GAP. `scope` is now a required first parameter
 * and is applied to `requirement_slot.application.branch_id` on the chain
 * below, so an out-of-scope document produces no row and therefore no URL. The
 * single NOT_FOUND code makes an out-of-scope document indistinguishable from
 * one that does not exist.
 *
 * The `documentos` workspace legitimately spans dossiers, which is why the
 * boundary cannot be a caller-supplied client id — it has to be branch scope.
 */
export async function createSignedEvidenceUrl(
  scope: BranchScope,
  evidenceId: string
): Promise<CreateSignedEvidenceUrlResult> {
  // MILESTONE 25B-1 — no scope, no URL. An empty scope reaches nothing, so
  // return before touching the database or Storage.
  if (isEmptyScope(scope)) return { status: "error", code: "NOT_FOUND" };

  const supabase = getSupabaseServerClient();

  const chainQuery = supabase
    .from("dossier_documents")
    .select(
      "storage_bucket, storage_path, requirement_slot_id, " +
        // MILESTONE 25B ADDS: a branch-scope filter on application.branch_id
        // here. The chain is already resolved; only the predicate is missing.
        "requirement_slot:requirement_slots!dossier_documents_requirement_slot_id_fkey!inner(" +
        "id, application:applications!requirement_slots_application_id_fkey!inner(" +
        "id, branch_id, client:clients!applications_client_id_fkey!inner(id)))"
    )
    .eq("id", evidenceId)
    .not("requirement_slot_id", "is", null);

  // MILESTONE 25B-1 — the branch filter lands on the application the S0 chain
  // already resolves. National sees assigned AND unassigned evidence;
  // branch-scoped sees only its own branches and never NULL.
  const { data: row, error: fetchError } = await applyBranchScope(
    chainQuery,
    scope,
    "requirement_slot.application.branch_id"
  ).maybeSingle<SignedEvidenceChainRow>();

  // EVERY failure returns the same NOT_FOUND. A database error, a broken
  // chain, a missing row and a failed signature are indistinguishable to the
  // caller — an authorization result must never double as an existence oracle.
  // Details go to the server log, never to the response.
  if (fetchError) {
    console.error("[document-evidence service] Failed to resolve evidence chain:", fetchError.message);
    return { status: "error", code: "NOT_FOUND" };
  }
  if (!row || !row.storage_path || !row.storage_bucket) {
    return { status: "error", code: "NOT_FOUND" };
  }

  const { data: signed, error: signError } = await supabase.storage
    .from(row.storage_bucket)
    .createSignedUrl(row.storage_path, VIEW_URL_TTL_SECONDS);

  if (signError || !signed) {
    console.error("[document-evidence service] Failed to create signed evidence URL:", signError?.message);
    return { status: "error", code: "NOT_FOUND" };
  }

  return { status: "ok", url: signed.signedUrl };
}
