import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getInitials } from "@/lib/format";
import type { User, UserRole, SupportedLanguage } from "@/types";

export type GetProfilesResult = { status: "ok"; users: User[] } | { status: "error" };

interface ProfileRow {
  legacy_id: string | null;
  full_name: string;
  email: string;
  role: string;
  preferred_language: string;
  active: boolean;
}

/**
 * Fetches profiles from Supabase for the Settings > Users screen.
 *
 * `legacy_id` becomes the app-facing `User.id` — every other screen still
 * resolves users by the old "u-00N" ids, so preserving that keeps this
 * migration scoped to Settings > Users only. Rows without a `legacy_id`
 * (none exist yet — reserved for once real signups start) are skipped
 * rather than surfaced with a broken id. `initials` is computed from
 * `full_name` instead of stored.
 *
 * No fallback to demo data on failure — callers get an explicit "error"
 * status so the UI can show that the real connection is down, on purpose.
 */
export async function getProfiles(): Promise<GetProfilesResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("legacy_id, full_name, email, role, preferred_language, active")
      .order("legacy_id", { ascending: true });

    if (error) {
      console.error("[getProfiles] Supabase query failed:", error.message);
      return { status: "error" };
    }

    const rows = (data ?? []) as ProfileRow[];
    const users: User[] = rows
      .filter((row): row is ProfileRow & { legacy_id: string } => row.legacy_id !== null)
      .map((row) => ({
        id: row.legacy_id,
        fullName: row.full_name,
        email: row.email,
        role: row.role as UserRole,
        initials: getInitials(row.full_name),
        active: row.active,
        preferredLanguage: row.preferred_language as SupportedLanguage,
      }));

    return { status: "ok", users };
  } catch (error) {
    console.error(
      "[getProfiles] Unexpected failure:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}
