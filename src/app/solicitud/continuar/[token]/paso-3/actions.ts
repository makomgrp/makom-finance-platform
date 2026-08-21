"use server";

import { getSupabaseServerClient } from "@/lib/supabase/server";
import { SYSTEM_NATIONAL_SCOPE } from "@/lib/services/branch-scope-query";
import { authorizePortalWrite } from "@/lib/services/portal-snapshot";
import { createDocumentEvidence, createSignedEvidenceUrl } from "@/lib/services/document-evidence";
import { updateIntakeDraftState } from "@/lib/services/application-intakes";
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from "@/lib/config/evidence-storage";

/**
 * ============================================================================
 * THE PUBLIC UPLOAD BOUNDARY (26B-3)
 * ============================================================================
 *
 * The single place a member of the public can put a file into ODL's private
 * storage. Server Actions rather than a route handler: Next gives them Origin
 * checking for free, they take `File` out of `FormData` directly, and no
 * Supabase key of any kind exists in the client bundle.
 *
 * ----------------------------------------------------------------------------
 * WHAT THE BROWSER MAY NAME, AND WHAT IS PROVEN ABOUT IT
 * ----------------------------------------------------------------------------
 * The browser sends a continuation token, a requirement slot id, optionally an
 * evidence id to replace, and the bytes. Nothing else — no application id, no
 * client id, no intake id, no branch, and critically NO STORAGE PATH.
 *
 * Every id it does send is proven against the token before anything is written:
 *
 *   1. the token resolves, server-side, to exactly one application;
 *   2. the slot must belong to THAT application;
 *   3. the slot must be applicant-visible, application-stage and document-kind
 *      — an internal or later-stage requirement is not uploadable from here
 *      even though it exists on the same application;
 *   4. a guarantor- or collateral-bound slot must point at a subject that also
 *      belongs to that application;
 *   5. `createDocumentEvidence` then re-checks the replacement belongs to the
 *      same slot, validates MIME and size, hashes the bytes, and generates the
 *      storage path itself.
 *
 * EVERY FAILURE RETURNS THE SAME CODE. A caller cannot distinguish "no such
 * slot" from "that slot belongs to someone else" from "that slot is internal",
 * so probing tells them nothing about applications that are not theirs.
 */

export type PortalUploadResult =
  | { status: "ok"; uploaded: number }
  | {
      status: "error";
      code:
        | "NOT_AUTHORIZED"
        | "SLOT_NOT_AVAILABLE"
        | "NO_FILE"
        | "INVALID_TYPE"
        | "TOO_LARGE"
        | "UPLOAD_FAILED";
      /** Per-file outcome when some succeeded and others did not. */
      failedFiles?: string[];
      uploaded?: number;
    };

interface AuthorizedSlot {
  applicationId: string;
  slotId: string;
}

/**
 * Prove the caller may write to this slot, or refuse without saying why.
 *
 * The subject check (step 4 above) matters more than it looks: 26A-3's slot
 * table carries `application_guarantor_id` / `application_collateral_id` as
 * plain foreign keys, so nothing at the schema level forbids a slot on
 * application A from pointing at a guarantor on application B. Verifying the
 * subject's own `application_id` closes that by hand rather than assuming the
 * shape of data nobody has written yet.
 */
async function authorizeSlot(
  token: string,
  slotId: string
): Promise<{ status: "ok"; value: AuthorizedSlot } | { status: "error" }> {
  const authorized = await authorizePortalWrite(token);
  if (authorized.status !== "ok" || !authorized.applicationId) return { status: "error" };

  const supabase = getSupabaseServerClient();
  const { data: slot, error } = await supabase
    .from("requirement_slots")
    .select(
      "id, application_id, applicant_visible, stage, requirement_kind, " +
        "application_guarantor_id, application_collateral_id"
    )
    .eq("id", slotId)
    // The ownership predicate, applied in the query rather than after it: a
    // slot on another application does not come back at all.
    .eq("application_id", authorized.applicationId)
    .maybeSingle();

  if (error || !slot) return { status: "error" };

  const row = slot as unknown as {
    id: string;
    application_id: string;
    applicant_visible: boolean;
    stage: string;
    requirement_kind: string;
    application_guarantor_id: string | null;
    application_collateral_id: string | null;
  };

  if (!row.applicant_visible || row.stage !== "application" || row.requirement_kind !== "document") {
    return { status: "error" };
  }

  if (row.application_guarantor_id) {
    const { data: guarantor } = await supabase
      .from("application_guarantors")
      .select("id")
      .eq("id", row.application_guarantor_id)
      .eq("application_id", authorized.applicationId)
      .maybeSingle();
    if (!guarantor) return { status: "error" };
  }

  if (row.application_collateral_id) {
    const { data: collateral } = await supabase
      .from("application_collateral")
      .select("id")
      .eq("id", row.application_collateral_id)
      .eq("application_id", authorized.applicationId)
      .maybeSingle();
    if (!collateral) return { status: "error" };
  }

  return {
    status: "ok",
    value: { applicationId: authorized.applicationId, slotId: row.id },
  };
}

/**
 * Upload one or more files against a requirement.
 *
 * PER-FILE OUTCOMES ARE REPORTED, NOT AVERAGED. A customer selecting three pay
 * slips where one is a 40 MB scan must be told which one failed; silently
 * saving two and claiming success would leave them believing they had finished.
 */
export async function uploadPortalDocuments(formData: FormData): Promise<PortalUploadResult> {
  const token = String(formData.get("continuationToken") ?? "");
  const slotId = String(formData.get("requirementSlotId") ?? "");
  const replacesRaw = formData.get("replacesEvidenceId");
  const replacesEvidenceId = typeof replacesRaw === "string" && replacesRaw ? replacesRaw : undefined;

  const authorized = await authorizeSlot(token, slotId);
  if (authorized.status !== "ok") {
    return { status: "error", code: "SLOT_NOT_AVAILABLE" };
  }

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { status: "error", code: "NO_FILE" };

  // Cheap checks first, before any bytes reach Storage. `createDocumentEvidence`
  // repeats both — this is the friendly message, that is the guarantee.
  for (const file of files) {
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      return { status: "error", code: "INVALID_TYPE" };
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      return { status: "error", code: "TOO_LARGE" };
    }
  }

  let uploaded = 0;
  const failedFiles: string[] = [];

  for (const file of files) {
    const result = await createDocumentEvidence({
      requirementSlotId: authorized.value.slotId,
      file,
      // A public applicant is not a CRM actor. The channel is what records who
      // this came from.
      actorProfileId: null,
      uploadedSource: "website_form",
      // Only meaningful for the first file of a replacement; a multi-file
      // selection replaces at most the one item the customer pointed at.
      replacesEvidenceId: uploaded === 0 ? replacesEvidenceId : undefined,
    });

    // "partial" means the evidence row IS committed and only the slot's status
    // transition failed — the customer's file is safely stored, so this counts
    // as uploaded rather than being reported as a loss.
    if (result.status === "ok" || result.status === "partial") uploaded += 1;
    else failedFiles.push(file.name);
  }

  if (uploaded === 0) {
    return { status: "error", code: "UPLOAD_FAILED", failedFiles, uploaded: 0 };
  }

  // Documents persist the moment they are uploaded, so this only records that
  // the customer is working — it is not what saves their progress.
  const authorizedWrite = await authorizePortalWrite(token);
  if (authorizedWrite.status === "ok") {
    await updateIntakeDraftState(authorizedWrite.intakeId, "documents");
  }

  if (failedFiles.length > 0) {
    return { status: "error", code: "UPLOAD_FAILED", failedFiles, uploaded };
  }
  return { status: "ok", uploaded };
}

export type PortalDocumentUrlResult =
  | { status: "ok"; url: string }
  | { status: "error"; code: "NOT_FOUND" };

/**
 * Mint a short-lived link so the customer can look at what they sent.
 *
 * REUSES THE ONE MINT POINT. `createSignedEvidenceUrl` is unchanged — same
 * 90-second TTL, same ownership chain resolved from the evidence id alone,
 * same single NOT_FOUND code. Nothing here makes storage public and no URL
 * outlives the click that produced it.
 *
 * The extra check below is the portal's own: that mint point authorises by
 * BRANCH SCOPE, which is a staff concept and would happily serve any document
 * to a national-scope caller. So before minting, the evidence is proven to hang
 * off THIS token's application. Branch scope decides what ODL's staff may see;
 * the token decides what this applicant may see, and both must agree.
 */
export async function getPortalDocumentUrl(
  token: string,
  evidenceId: string
): Promise<PortalDocumentUrlResult> {
  const authorized = await authorizePortalWrite(token);
  if (authorized.status !== "ok" || !authorized.applicationId) {
    return { status: "error", code: "NOT_FOUND" };
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("dossier_documents")
    .select(
      "id, requirement_slot:requirement_slots!dossier_documents_requirement_slot_id_fkey!inner(application_id)"
    )
    .eq("id", evidenceId)
    .maybeSingle();

  if (error || !data) return { status: "error", code: "NOT_FOUND" };

  const row = data as unknown as { requirement_slot: { application_id: string } | null };
  if (row.requirement_slot?.application_id !== authorized.applicationId) {
    return { status: "error", code: "NOT_FOUND" };
  }

  const signed = await createSignedEvidenceUrl(SYSTEM_NATIONAL_SCOPE, evidenceId);
  if (signed.status !== "ok") return { status: "error", code: "NOT_FOUND" };
  return { status: "ok", url: signed.url };
}
