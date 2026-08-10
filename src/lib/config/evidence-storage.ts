/**
 * Shared Storage/MIME constants and helpers for the Document Evidence
 * Engine (relocated here in Milestone 12E4 — see the Milestone 12E
 * architecture review, Question 3). Previously lived in the now-deleted
 * src/lib/services/documents.ts, re-exported there purely so
 * document-evidence.ts could reuse them without duplication. Now that the
 * legacy service is gone, this is their permanent, neutral home: no
 * legacy DossierDocument logic, no Supabase client, nothing server-only —
 * these are plain constants and a pure function, safe to import from
 * either server or client code.
 *
 * BUCKET/MAX_FILE_SIZE_BYTES/MIME_TYPE_EXTENSIONS/ALLOWED_MIME_TYPES/
 * buildTimestampComponent are business rules about the one physical
 * Storage bucket every Evidence file lives in, not an artifact of the
 * legacy model — they were never actually legacy-specific, only
 * previously homed in a file that was.
 */

export const BUCKET = "dossier-documents";
export const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
export const VIEW_URL_TTL_SECONDS = 90;

// Extension is always derived from the validated mime_type — never from
// the user-supplied original filename.
export const MIME_TYPE_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
export const ALLOWED_MIME_TYPES = Object.keys(MIME_TYPE_EXTENSIONS);

/** Path-safe timestamp component for Storage object paths — strips
 * separators ICU/filesystems dislike, always ends in a literal "Z". */
export function buildTimestampComponent(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}
