import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { applyBranchScope, isEmptyScope, withScopedParent } from "@/lib/services/branch-scope-query";
import type {
  BranchScope,
  InternalNote,
  NotePriority,
  NoteType,
} from "@/types";

/**
 * Server-only service for dossier_notes (see the Milestone 6 architecture
 * review). Uses the Admin Client, same posture as chat/profiles V1: RLS is
 * enabled on dossier_notes with zero policies, so this is the only way to
 * read or write it until a real per-client-note permissions model exists.
 *
 * client_id is a real, FK-constrained clients.id uuid as of Milestone
 * 14E — see the Milestone 14E implementation report. The Server Action
 * layer (src/app/(app)/expedientes/actions.ts) still validates it against
 * the real Client Engine before calling createNote, matching the same
 * "never trust client-supplied identity blindly" discipline this app has
 * always applied, just against the real clients table now instead of the
 * demo client list.
 */

interface DossierNoteRow {
  id: string;
  client_id: string;
  author_profile_id: string;
  body: string;
  type: string;
  priority: string;
  created_at: string;
  profiles: { full_name: string } | null;
}

function toInternalNote(row: DossierNoteRow): InternalNote {
  return {
    id: row.id,
    clientId: row.client_id,
    text: row.body,
    authorId: row.author_profile_id,
    authorFullName: row.profiles?.full_name ?? "—",
    createdAt: row.created_at,
    type: row.type as NoteType,
    priority: row.priority as NotePriority,
  };
}

const NOTE_SELECT =
  "id, client_id, author_profile_id, body, type, priority, created_at, profiles(full_name)";

export type GetDossierNotesResult = { status: "ok"; notes: InternalNote[] } | { status: "error" };

/**
 * Loads every note for a client, most recent first. No fallback to demo
 * data on failure — callers get an explicit "error" status so the UI can
 * show that the real connection is down, matching the pattern already
 * established in src/lib/services/profiles.ts.
 */
/** MILESTONE 25B-1 — notes derive their branch from their client via an
 * `!inner` join, so a note whose client is out of scope disappears rather than
 * returning with a null client. */
const NOTE_CLIENT_SCOPE_EMBED =
  "scope_client:clients!dossier_notes_client_id_fkey!inner(branch_id)";

export async function getNotesByClientId(scope: BranchScope, clientId: string): Promise<GetDossierNotesResult> {
  if (isEmptyScope(scope)) return { status: "ok", notes: [] };

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await applyBranchScope(
      supabase
        .from("dossier_notes")
        .select(withScopedParent(NOTE_SELECT, scope, NOTE_CLIENT_SCOPE_EMBED))
        .eq("client_id", clientId),
      scope,
      "scope_client.branch_id"
    ).order("created_at", { ascending: false });

    if (error) {
      console.error("[notes service] Failed to load dossier notes:", error.message);
      return { status: "error" };
    }

    const rows = (data ?? []) as unknown as DossierNoteRow[];
    return { status: "ok", notes: rows.map(toInternalNote) };
  } catch (error) {
    console.error(
      "[notes service] Unexpected failure loading dossier notes:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

export interface CreateDossierNoteInput {
  clientId: string;
  authorProfileId: string;
  text: string;
  type: NoteType;
  priority: NotePriority;
}

/**
 * Inserts one note. Throws on failure — callers (Server Actions) are
 * expected to catch and map to a client-facing error result, matching
 * sendMessage's convention in src/lib/services/chat.ts.
 */
export async function createNote(input: CreateDossierNoteInput): Promise<InternalNote> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("dossier_notes")
    .insert({
      client_id: input.clientId,
      author_profile_id: input.authorProfileId,
      body: input.text,
      type: input.type,
      priority: input.priority,
    })
    .select(NOTE_SELECT)
    .single<DossierNoteRow>();

  if (error) {
    console.error("[notes service] Failed to insert dossier note:", error.message);
    throw new Error("Failed to create the note.");
  }

  return toInternalNote(data);
}
