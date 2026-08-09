import type { DocumentStatus, DocumentType } from "./document-record";

/**
 * The real, Supabase-backed document shape — used by the dossier
 * Documents tab, the standalone /documentos module, the document status
 * summary, and the Dashboard pending-documents KPI (Milestone 8B). This
 * is now the single document shape across the app.
 */
export interface DossierDocument {
  id: string;
  clientId: string;
  applicationId: string;
  type: DocumentType;
  status: DocumentStatus;
  /** Present only once a file has actually been uploaded — see the
   * file-metadata invariant in the dossier_documents migration. */
  fileName?: string;
  mimeType?: string;
  fileSizeBytes?: number;
  uploadedAt?: string;
  uploadedByProfileId?: string;
  /** Resolved server-side (joined from profiles) — never guessed
   * client-side. Undefined when no uploader is known (e.g. migration-
   * sourced or external-intake rows). */
  uploadedByFullName?: string;
  reviewedAt?: string;
  reviewedByProfileId?: string;
  /** Resolved server-side (joined from profiles) — never guessed
   * client-side. */
  reviewedByFullName?: string;
  /** True when a real file exists for this slot — equivalent to
   * fileName !== undefined, provided as a named boolean so UI code
   * doesn't need to infer file presence from an unrelated field. */
  hasFile: boolean;
}
