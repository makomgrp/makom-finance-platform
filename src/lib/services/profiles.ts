import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getInitials } from "@/lib/format";
import type { ChatColleague, StaffUser, SupportedLanguage, UserRole } from "@/types";

/**
 * ============================================================================
 * THE STAFF DIRECTORY — `profiles` IS THE CANONICAL SOURCE (Milestone 21)
 * ============================================================================
 *
 * WHAT CHANGED, AND WHY IT HAD TO. Until Milestone 21 this module used
 * `profiles.legacy_id` as the app-facing user id and skipped every row where
 * it was null, with a comment claiming "none exist yet". Live inspection
 * proved otherwise: one profile already had no legacy_id and was therefore
 * invisible in Settings > Users. Worse, `legacy_id` is never generated for
 * new rows, so EVERY user invited by this milestone would have been missing
 * from the very screen used to administer them.
 *
 * `profiles.id` is now the identity, no row is filtered, and `legacy_id` is
 * not read anywhere in this file. As of Milestone 21 the column has no
 * runtime reader left in the codebase at all; it stays in the database only
 * because dropping a column is irreversible and the seed files still
 * reference it.
 *
 * READ-ONLY. Every staff mutation goes through the four SECURITY DEFINER
 * functions in src/lib/services/staff-admin.ts — `service_role` holds no
 * INSERT, UPDATE or DELETE on `profiles`, exactly as Milestone 16 left it.
 */

interface StaffProfileRow {
  id: string;
  full_name: string;
  email: string;
  role: string;
  preferred_language: string;
  active: boolean;
  auth_user_id: string | null;
}

const STAFF_PROFILE_SELECT = "id, full_name, email, role, preferred_language, active, auth_user_id";

function toStaffUser(row: StaffProfileRow): StaffUser {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    role: row.role as UserRole,
    initials: getInitials(row.full_name),
    active: row.active,
    preferredLanguage: row.preferred_language as SupportedLanguage,
    authLinked: row.auth_user_id !== null,
  };
}

export type GetProfilesResult = { status: "ok"; users: StaffUser[] } | { status: "error" };

/**
 * Every staff profile, for Settings > Users.
 *
 * NO ROW IS EXCLUDED — not inactive ones, not unlinked ones. An
 * administrator has to be able to see a deactivated account (that is what an
 * offboarding check looks at) and a pending invitation (that is what tells
 * them to resend it). Ordered by name, since `legacy_id` no longer exists to
 * order by and name is what the screen actually shows.
 *
 * No fallback to demo data on failure — callers get an explicit "error"
 * status so the UI can say the connection is down, on purpose.
 */
export async function getProfiles(): Promise<GetProfilesResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("profiles")
      .select(STAFF_PROFILE_SELECT)
      .order("full_name", { ascending: true });

    if (error) {
      console.error("[profiles service] Failed to load staff profiles:", error.message);
      return { status: "error" };
    }

    const rows = (data ?? []) as StaffProfileRow[];
    return { status: "ok", users: rows.map(toStaffUser) };
  } catch (error) {
    console.error(
      "[profiles service] Unexpected failure loading staff profiles:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

export type GetChatColleaguesResult =
  | { status: "ok"; colleagues: ChatColleague[] }
  | { status: "error" };

/**
 * The Chat colleague directory — the canonical replacement for the static
 * `USERS` list deleted in Milestone 21.
 *
 * ELIGIBILITY, and why each clause is there:
 *
 *   active = true            — a deactivated person cannot enter the CRM at
 *                              all (getCurrentProfile() rejects them), so
 *                              offering them as a contact would invite
 *                              messages nobody can read.
 *   auth_user_id IS NOT NULL — a pending invitee has no way to sign in yet.
 *                              Same reasoning: reachability, not decoration.
 *   id <> currentProfileId   — nobody messages themselves.
 *
 * The immediate consequence is accepted deliberately: only two live profiles
 * currently have a linked auth account, so the directory is small until the
 * remaining staff are invited. Real operational truth beats demo density —
 * this list is now exactly the set of people who can actually receive a
 * message. Historical messages from excluded people remain fully visible and
 * correctly attributed; this filter governs who you can START talking to,
 * never what was already said.
 */
export async function getChatColleagues(currentProfileId: string): Promise<GetChatColleaguesResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, email, role, preferred_language")
      .eq("active", true)
      .not("auth_user_id", "is", null)
      .neq("id", currentProfileId)
      .order("full_name", { ascending: true });

    if (error) {
      console.error("[profiles service] Failed to load chat colleagues:", error.message);
      return { status: "error" };
    }

    const rows = (data ?? []) as Omit<StaffProfileRow, "active" | "auth_user_id">[];
    return {
      status: "ok",
      colleagues: rows.map((row) => ({
        id: row.id,
        fullName: row.full_name,
        email: row.email,
        role: row.role as UserRole,
        initials: getInitials(row.full_name),
        preferredLanguage: row.preferred_language as SupportedLanguage,
      })),
    };
  } catch (error) {
    console.error(
      "[profiles service] Unexpected failure loading chat colleagues:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}
