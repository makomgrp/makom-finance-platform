/** Which channel/actor-type produced this Evidence row — same vocabulary
 * as ApplicationSource / RequirementSlotSource. */
export type EvidenceUploadedSource = "crm_manual" | "website_form" | "whatsapp" | "ai";

/**
 * The Document Evidence Engine's read/write shape (Milestone 12B, finalized
 * in Milestone 12E4 — see the Milestone 12 and 12E architecture reviews).
 * `dossier_documents` is the sole, final table backing this type; the
 * legacy client/application/type/status columns and every consumer of them
 * were retired in Milestone 12E4.
 *
 * Every field describing the file is NEVER optional/null here — an Evidence
 * row is only ever created at the moment a file is actually uploaded (see
 * "every upload is a new row" in the architecture review); there is no such
 * thing as an empty, file-less Evidence row.
 */
export interface DocumentEvidence {
  id: string;
  requirementSlotId: string;
  /** Explicit supersession of one specific prior Evidence row — never
   * general grouping. Undefined for independent, co-existing evidence
   * (e.g. Government ID front and back both have this undefined). */
  replacesEvidenceId?: string;
  /** Populated only when a later Evidence row's replacesEvidenceId points
   * back at this one — computed by the service from the same result set,
   * not a stored column. Undefined means this is the current version. */
  supersededByEvidenceId?: string;
  storageBucket: string;
  storagePath: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  fileSha256: string;
  uploadedAt: string;
  /** Populated only when uploadedSource === "crm_manual". */
  uploadedByProfileId?: string;
  uploadedByFullName?: string;
  uploadedSource: EvidenceUploadedSource;
  /** Populated once, by reviewDocumentEvidence, and never cleared or
   * overwritten afterward — an immutable audit fact, not a status. */
  reviewedAt?: string;
  reviewedByProfileId?: string;
  reviewedByFullName?: string;
}
