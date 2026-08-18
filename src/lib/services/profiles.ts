import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getInitials } from "@/lib/format";
import type { AssignableAdvisor, ChatColleague, StaffUser, SupportedLanguage, UserRole } from "@/types";

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

/**
 * ASSIGNEE ELIGIBILITY — a domain rule, NOT an authorization rule.
 *
 * Two different questions were previously conflated here, and only one of them
 * is about permissions:
 *
 *   WHO MAY ASSIGN a file  -> `application:assign_advisor` (administrador,
 *                             gerente). That is authorization, it lives in
 *                             ROLE_CAPABILITIES, and it is unchanged.
 *   WHO MAY BE ASSIGNED    -> this constant. `assigned_advisor_profile_id`
 *                             names the person who actually WORKS the file, so
 *                             the population is a business fact about the job,
 *                             not a permission anyone holds.
 *
 * The first implementation derived assignees from `application:create`, which
 * made every administrador and gerente selectable as an advisor. Filing an
 * application and carrying one are different acts; a manager who may originate
 * a request is not thereby the advisor responsible for it.
 *
 * This rule is deliberately NOT expressed in ROLE_CAPABILITIES and gets no
 * capability of its own — putting it there would re-introduce exactly the
 * confusion above by describing a job title as a permission.
 */
const ADVISOR_ROLE: UserRole = "asesor";

export type GetAssignableAdvisorsResult =
  | { status: "ok"; advisors: AssignableAdvisor[] }
  | { status: "error" };

/**
 * Staff who may be assigned an Application (Milestone 23).
 *
 * ELIGIBILITY, and why each clause is there:
 *
 *   role = 'asesor'          — the advisor is the person who works the file.
 *                              Administradores and gerentes assign files; they
 *                              are not themselves the assignee. Analistas
 *                              evaluate an application rather than carry it,
 *                              and consulta is read-only.
 *   active = true            — a deactivated profile cannot enter the CRM at
 *                              all (getCurrentProfile() rejects it), so a file
 *                              assigned to one would have no real owner.
 *   auth_user_id IS NOT NULL — a pending invitee has no way to sign in yet.
 *                              Assigning work to someone who cannot open it is
 *                              not an ownership record, it is a dead end.
 *
 * SAME OPERATIONAL-TRUTH PRINCIPLE AS THE CHAT DIRECTORY (getChatColleagues,
 * just below): offer only staff who can actually do the thing right now. An
 * earlier revision of this function deliberately INCLUDED pending invitees on
 * the reasoning that ownership can be recorded ahead of a login; that was
 * wrong for the same reason it is wrong in Chat — it produces a record the
 * organisation cannot act on. Pending invitees become assignable
 * AUTOMATICALLY, with no further code change, the moment their auth_user_id is
 * linked.
 *
 * THIS FILTER GOVERNS NEW ASSIGNMENTS ONLY — never what is displayed.
 * Historical assignments are read through the applications -> profiles join in
 * src/lib/services/applications.ts and are completely unaffected: a file
 * assigned to someone who later becomes inactive, or whose auth link is
 * removed, keeps showing that person's name. Attribution is never rewritten by
 * a change in eligibility.
 *
 * CONSEQUENCE, ACCEPTED DELIBERATELY: until real asesor accounts are invited
 * and linked, this returns an EMPTY list and the assignment menu says so. That
 * is the honest state of the directory, not a failure — exactly as the Chat
 * directory currently resolves to one colleague.
 */
export async function getAssignableAdvisors(): Promise<GetAssignableAdvisorsResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name, role")
      .eq("role", ADVISOR_ROLE)
      .eq("active", true)
      .not("auth_user_id", "is", null)
      .order("full_name", { ascending: true });

    if (error) {
      console.error("[profiles service] Failed to load assignable advisors:", error.message);
      return { status: "error" };
    }

    const rows = (data ?? []) as Pick<StaffProfileRow, "id" | "full_name" | "role">[];
    return {
      status: "ok",
      advisors: rows.map((row) => ({
        id: row.id,
        fullName: row.full_name,
        role: row.role as UserRole,
      })),
    };
  } catch (error) {
    console.error(
      "[profiles service] Unexpected failure loading assignable advisors:",
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
