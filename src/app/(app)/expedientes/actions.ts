"use server";

import { createNote } from "@/lib/services/notes";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { getClientById } from "@/lib/demo-data";
import { NOTE_PRIORITY_VALUES, NOTE_TYPE_VALUES } from "@/lib/config/note";
import type { InternalNote, NotePriority, NoteType } from "@/types";

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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isNoteType(value: unknown): value is NoteType {
  return typeof value === "string" && (NOTE_TYPE_VALUES as string[]).includes(value);
}

function isNotePriority(value: unknown): value is NotePriority {
  return typeof value === "string" && (NOTE_PRIORITY_VALUES as string[]).includes(value);
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
