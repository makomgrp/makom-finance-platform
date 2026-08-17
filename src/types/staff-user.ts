import type { SupportedLanguage, UserRole } from "@/types/user";

/**
 * ============================================================================
 * A STAFF MEMBER, AS SETTINGS > USERS SEES THEM (Milestone 21)
 * ============================================================================
 *
 * Replaces the use of the demo `User` shape for the staff directory. Two
 * changes matter, and both were forced by live evidence:
 *
 * 1. `id` IS `profiles.id`. Until Milestone 21 the Users screen used
 *    `profiles.legacy_id` as its id and SKIPPED any row without one. That
 *    was already hiding a real record (the deactivated QA account), and it
 *    would have hidden every user this milestone creates, since new profiles
 *    never receive a legacy_id. `profiles.id` is now the canonical identity
 *    everywhere in the CRM.
 *
 * 2. `authLinked` is explicit. A profile with no linked Supabase Auth account
 *    is a PENDING INVITATION, not a broken row — `auth_user_id` is nullable
 *    by design and five live profiles are legitimately in that state. The
 *    administrator needs to see the difference to know whether to resend an
 *    invitation.
 *
 * DELIBERATELY ABSENT: `authUserId` itself. The auth UUID is an internal
 * identifier with no product meaning, and showing it would leak auth
 * internals into ordinary UI for no benefit. The boolean is all the screen
 * needs.
 */
export interface StaffUser {
  /** `profiles.id` — the canonical CRM identity. Never a legacy id. */
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  /** Computed from fullName, never stored. */
  initials: string;
  /**
   * `false` means the person cannot enter the CRM at all: getCurrentProfile()
   * returns null for an inactive profile, so the (app) layout redirects to
   * /login and every guarded Server Action refuses. It is the whole
   * offboarding mechanism — Milestone 21 has no deletion path.
   */
  active: boolean;
  preferredLanguage: SupportedLanguage;
  /**
   * True when `profiles.auth_user_id` is set. False means the invitation has
   * not been completed (or was never sent) — the person has no way to sign
   * in yet, and is deliberately excluded from the Chat directory.
   */
  authLinked: boolean;
}

/**
 * A selectable Chat contact (Milestone 21) — the replacement for the entries
 * the static `USERS` list used to supply.
 *
 * `id` is `profiles.id`, so it is the SAME identity the database already
 * stores in `conversation_members.profile_id` and `messages.sender_profile_id`.
 * That is what made the Milestone 21 chat migration a pure code change: the
 * persisted data was already profile-UUID-native, and the legacy id existed
 * only as an in-memory translation at the service boundary.
 *
 * Deliberately narrower than StaffUser: the directory has no business
 * knowing who is deactivated or who has a pending invitation, because
 * getChatColleagues() has already excluded both.
 */
export interface ChatColleague {
  /** `profiles.id`. */
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  initials: string;
  /** Drives chat auto-translation — see SupportedLanguage. */
  preferredLanguage: SupportedLanguage;
}
