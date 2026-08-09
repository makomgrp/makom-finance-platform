import "server-only";
import { createHash } from "node:crypto";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type { DocumentStatus, DocumentType, DossierDocument } from "@/types";

/**
 * Server-only service for dossier_documents + the private dossier-documents
 * Storage bucket (see the Milestone 8 architecture review). Uses the Admin
 * Client for both the table and Storage — RLS is enabled on the table with
 * zero policies, and the bucket has zero Storage policies either, so this
 * is the only way to read or write either until a real permissions model
 * exists.
 *
 * Milestone 8A scope: this backs the dossier Documents tab only. The
 * standalone /documentos module and the dashboard's pending-documents KPI
 * keep reading demo data until Milestone 8B.
 */

// Exported (unchanged in value or meaning) so
// src/lib/services/document-evidence.ts (Milestone 12B) can reuse the same
// bucket, size limit, TTL, and MIME/extension mapping instead of
// duplicating them — both services write into the same physical Storage
// bucket, just under different path conventions for new vs. legacy
// uploads. Nothing about this file's own behavior changes.
export const BUCKET = "dossier-documents";
export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
export const VIEW_URL_TTL_SECONDS = 90;

// Extension is always derived from the validated mime_type — never from
// the user-supplied original filename (see uploadDocumentFile below).
export const MIME_TYPE_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const ALLOWED_MIME_TYPES = Object.keys(MIME_TYPE_EXTENSIONS);

// Matches dossier_documents_review_check: reviewed_at/reviewed_by_profile_id
// are populated for exactly these three statuses, cleared for every other one.
const CONCLUDED_STATUSES: DocumentStatus[] = ["verificado", "rechazado", "requiere_actualizacion"];

interface DossierDocumentRow {
  id: string;
  client_legacy_id: string;
  application_legacy_id: string;
  type: string;
  status: string;
  storage_path: string | null;
  file_name: string | null;
  mime_type: string | null;
  file_size_bytes: number | null;
  uploaded_at: string | null;
  uploaded_by_profile_id: string | null;
  reviewed_at: string | null;
  reviewed_by_profile_id: string | null;
  uploaded_by: { full_name: string } | null;
  reviewed_by: { full_name: string } | null;
}

// Two foreign keys to profiles (uploaded_by_profile_id and
// reviewed_by_profile_id) — the !constraint_name hints disambiguate which
// relationship each embed follows, same pattern as dossier_alerts.
const DOCUMENT_SELECT =
  "id, client_legacy_id, application_legacy_id, type, status, storage_path, file_name, mime_type, file_size_bytes, uploaded_at, uploaded_by_profile_id, reviewed_at, reviewed_by_profile_id, " +
  "uploaded_by:profiles!dossier_documents_uploaded_by_profile_id_fkey(full_name), " +
  "reviewed_by:profiles!dossier_documents_reviewed_by_profile_id_fkey(full_name)";

function toDossierDocument(row: DossierDocumentRow): DossierDocument {
  return {
    id: row.id,
    clientId: row.client_legacy_id,
    applicationId: row.application_legacy_id,
    type: row.type as DocumentType,
    status: row.status as DocumentStatus,
    fileName: row.file_name ?? undefined,
    mimeType: row.mime_type ?? undefined,
    fileSizeBytes: row.file_size_bytes ?? undefined,
    uploadedAt: row.uploaded_at ?? undefined,
    uploadedByProfileId: row.uploaded_by_profile_id ?? undefined,
    uploadedByFullName: row.uploaded_by?.full_name ?? undefined,
    reviewedAt: row.reviewed_at ?? undefined,
    reviewedByProfileId: row.reviewed_by_profile_id ?? undefined,
    reviewedByFullName: row.reviewed_by?.full_name ?? undefined,
    hasFile: row.storage_path !== null,
  };
}

// Exported for reuse by document-evidence.ts (Milestone 12B) — same
// path-safe timestamp format, unchanged.
export function buildTimestampComponent(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

export type GetDossierDocumentsResult =
  | { status: "ok"; documents: DossierDocument[] }
  | { status: "error" };

/**
 * Loads every document across every application for a client, oldest
 * first (matches DOCUMENT_TYPE_ORDER's own stable display ordering, which
 * the UI applies on top of this anyway). No fallback to demo data on
 * failure — callers get an explicit "error" status.
 */
export async function getDocumentsByClientId(clientLegacyId: string): Promise<GetDossierDocumentsResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("dossier_documents")
      .select(DOCUMENT_SELECT)
      .eq("client_legacy_id", clientLegacyId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[documents service] Failed to load dossier documents:", error.message);
      return { status: "error" };
    }

    const rows = (data ?? []) as unknown as DossierDocumentRow[];
    return { status: "ok", documents: rows.map(toDossierDocument) };
  } catch (error) {
    console.error(
      "[documents service] Unexpected failure loading dossier documents:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

/**
 * Loads every document across every client/application, oldest first —
 * backs the global /documentos module and its status summary (Milestone
 * 8B). Same no-fallback-on-error contract as getDocumentsByClientId.
 */
export async function getAllDocuments(): Promise<GetDossierDocumentsResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("dossier_documents")
      .select(DOCUMENT_SELECT)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[documents service] Failed to load all dossier documents:", error.message);
      return { status: "error" };
    }

    const rows = (data ?? []) as unknown as DossierDocumentRow[];
    return { status: "ok", documents: rows.map(toDossierDocument) };
  } catch (error) {
    console.error(
      "[documents service] Unexpected failure loading all dossier documents:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

export type GetPendingDocumentCountResult =
  | { status: "ok"; count: number }
  | { status: "error" };

/**
 * Server-side count only (no row payload) — backs the Dashboard's
 * "Documentos pendientes" KPI. Never returns a fabricated 0 on failure;
 * callers must treat "error" as unknown, not zero.
 */
export async function getPendingDocumentCount(): Promise<GetPendingDocumentCountResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { count, error } = await supabase
      .from("dossier_documents")
      .select("id", { count: "exact", head: true })
      .eq("status", "pendiente");

    if (error) {
      console.error("[documents service] Failed to count pending documents:", error.message);
      return { status: "error" };
    }

    return { status: "ok", count: count ?? 0 };
  } catch (error) {
    console.error(
      "[documents service] Unexpected failure counting pending documents:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

export interface UploadDocumentFileInput {
  documentId: string;
  file: File;
  /** Null for external-intake channels with no CRM profile — always a
   * real profile id for the manual-upload flow this milestone builds. */
  actorProfileId: string | null;
  uploadedSource: "crm_manual" | "website_form" | "whatsapp" | "migration";
}

export type UploadDocumentFileResult =
  | { status: "ok"; document: DossierDocument }
  | {
      status: "error";
      code: "INVALID_MIME" | "INVALID_FILE_SIZE" | "DOCUMENT_NOT_FOUND" | "UPLOAD_FAILED" | "METADATA_FAILED";
    };

/**
 * Handles both the first upload into an empty (pendiente) slot and a
 * replace of an existing file — same operation either way, since this
 * always targets an existing document row by id (the caller identifies
 * which slot). There is deliberately no database constraint tying type to
 * application 1:1 — see the "Future evolution" note in the
 * dossier_documents migration — this function doesn't assume or rely on
 * one; it only ever acts on the specific row id it's given.
 *
 * Sequencing is deliberate: Storage upload happens BEFORE the metadata
 * write, using a freshly generated, never-reused path. This means a
 * failed Storage upload never touches the metadata row at all (no orphan
 * metadata is possible by construction), and a failed metadata write
 * after a successful Storage upload leaves only an inert, unreferenced
 * object — cleaned up best-effort below, logged if that cleanup itself
 * fails, but never blocking the caller from getting a clear error either
 * way. See the Milestone 8 architecture review for the full reasoning.
 *
 * The PREVIOUS file (on a replace) is deliberately left in Storage,
 * un-deleted — passive V1 version retention, not a full version-history
 * feature. dossier_documents only ever points at the current file; the
 * old object remains discoverable only via its own structured path, with
 * no Postgres row referencing it once replaced.
 */
export async function uploadDocumentFile(input: UploadDocumentFileInput): Promise<UploadDocumentFileResult> {
  const mimeType = input.file.type;
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return { status: "error", code: "INVALID_MIME" };
  }
  if (input.file.size <= 0 || input.file.size > MAX_FILE_SIZE_BYTES) {
    return { status: "error", code: "INVALID_FILE_SIZE" };
  }

  const supabase = getSupabaseServerClient();

  const { data: existing, error: fetchError } = await supabase
    .from("dossier_documents")
    .select("id, client_legacy_id, application_legacy_id, type")
    .eq("id", input.documentId)
    .maybeSingle();

  if (fetchError) {
    console.error("[documents service] Failed to look up document before upload:", fetchError.message);
    return { status: "error", code: "UPLOAD_FAILED" };
  }
  if (!existing) {
    return { status: "error", code: "DOCUMENT_NOT_FOUND" };
  }

  const bytes = Buffer.from(await input.file.arrayBuffer());
  const fileSha256 = createHash("sha256").update(bytes).digest("hex");
  const extension = MIME_TYPE_EXTENSIONS[mimeType];
  const uploadUuid = crypto.randomUUID();
  const timestampComponent = buildTimestampComponent(new Date());
  const storagePath = `${existing.client_legacy_id}/${existing.application_legacy_id}/${existing.type}/${timestampComponent}-${uploadUuid}.${extension}`;

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, bytes, {
    contentType: mimeType,
    upsert: false,
  });

  if (uploadError) {
    console.error("[documents service] Failed to upload document file to storage:", uploadError.message);
    return { status: "error", code: "UPLOAD_FAILED" };
  }

  const { data: updated, error: updateError } = await supabase
    .from("dossier_documents")
    .update({
      status: "recibido",
      storage_path: storagePath,
      file_name: input.file.name,
      mime_type: mimeType,
      file_size_bytes: input.file.size,
      file_sha256: fileSha256,
      uploaded_source: input.uploadedSource,
      uploaded_at: new Date().toISOString(),
      uploaded_by_profile_id: input.actorProfileId,
      reviewed_at: null,
      reviewed_by_profile_id: null,
    })
    .eq("id", input.documentId)
    .select(DOCUMENT_SELECT)
    .single<DossierDocumentRow>();

  if (updateError) {
    console.error(
      "[documents service] Failed to update document metadata after upload — attempting to clean up the orphaned storage object:",
      updateError.message
    );
    const { error: cleanupError } = await supabase.storage.from(BUCKET).remove([storagePath]);
    if (cleanupError) {
      console.error(
        `[documents service] Orphaned storage object could not be cleaned up (${storagePath}):`,
        cleanupError.message
      );
    }
    return { status: "error", code: "METADATA_FAILED" };
  }

  return { status: "ok", document: toDossierDocument(updated) };
}

export type SetDocumentStatusResult =
  | { status: "ok"; document: DossierDocument }
  | { status: "error"; code: "DOCUMENT_NOT_FOUND" | "UPDATE_FAILED" };

/**
 * Sets status to an explicit target (never pendiente — see
 * DOCUMENT_STATUS_TRANSITIONABLE in src/lib/config/document.ts, enforced
 * at the Server Action layer) and applies the review invariant:
 * reviewed_at/reviewed_by_profile_id are set when the target is a
 * concluded outcome (verificado/rechazado/requiere_actualizacion) and
 * cleared for every other transitionable status (recibido/en_revision) —
 * always overwritten to the caller's own identity/now(), regardless of
 * the previous values. This is a deliberate semantics correction versus
 * the old demo behavior; see the Milestone 8 architecture review.
 */
export async function setDocumentStatus(
  documentId: string,
  targetStatus: DocumentStatus,
  actorProfileId: string
): Promise<SetDocumentStatusResult> {
  const supabase = getSupabaseServerClient();
  const isConcluded = CONCLUDED_STATUSES.includes(targetStatus);

  const { data: updated, error } = await supabase
    .from("dossier_documents")
    .update(
      isConcluded
        ? { status: targetStatus, reviewed_at: new Date().toISOString(), reviewed_by_profile_id: actorProfileId }
        : { status: targetStatus, reviewed_at: null, reviewed_by_profile_id: null }
    )
    .eq("id", documentId)
    .select(DOCUMENT_SELECT)
    .maybeSingle<DossierDocumentRow>();

  if (error) {
    console.error("[documents service] Failed to update document status:", error.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }
  if (!updated) {
    return { status: "error", code: "DOCUMENT_NOT_FOUND" };
  }

  return { status: "ok", document: toDossierDocument(updated) };
}

export type GetDocumentViewUrlResult =
  | { status: "ok"; url: string }
  | { status: "error"; code: "DOCUMENT_NOT_FOUND" | "NO_FILE" | "SIGN_FAILED" };

/** Short-lived (90s) signed URL, freshly minted on every call — never
 * cached or reused, and Storage access never happens any other way. */
export async function getDocumentViewUrl(documentId: string): Promise<GetDocumentViewUrlResult> {
  const supabase = getSupabaseServerClient();

  const { data: row, error: fetchError } = await supabase
    .from("dossier_documents")
    .select("storage_path")
    .eq("id", documentId)
    .maybeSingle();

  if (fetchError) {
    console.error("[documents service] Failed to look up document for view URL:", fetchError.message);
    return { status: "error", code: "SIGN_FAILED" };
  }
  if (!row) {
    return { status: "error", code: "DOCUMENT_NOT_FOUND" };
  }
  if (!row.storage_path) {
    return { status: "error", code: "NO_FILE" };
  }

  const { data: signed, error: signError } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(row.storage_path, VIEW_URL_TTL_SECONDS);

  if (signError || !signed) {
    console.error("[documents service] Failed to create signed URL:", signError?.message);
    return { status: "error", code: "SIGN_FAILED" };
  }

  return { status: "ok", url: signed.signedUrl };
}
