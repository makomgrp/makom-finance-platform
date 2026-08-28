import type { SupportedLanguage, UserRole } from "@/types/user";
import type { BranchScopeMode } from "@/types/branch";

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
/**
 * MILESTONE 26B-21 — what an administrator actually needs to know.
 *
 * `disabled` wins over everything: someone switched off cannot sign in whatever
 * their onboarding state, and offering to resend their invitation would be an
 * invitation to nowhere. `pending_invitation` wins over `active` because a
 * person who never opened their email cannot get in either, and calling that
 * "Activo" is the exact lie this milestone exists to remove.
 */
export type StaffInvitationStatus = "disabled" | "pending_invitation" | "active";

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
  /**
   * Whether this person can actually sign in today.
   *
   * DERIVED, never stored. `profiles.active` still means only "not switched
   * off administratively" and keeps driving permissions exactly as before;
   * this adds the onboarding half, read from Auth. A second column would be a
   * copy of a fact Supabase already owns, free to drift the first time someone
   * completes a flow the CRM did not initiate.
   */
  invitationStatus: StaffInvitationStatus;
  /**
   * MILESTONE 25A — how far this person's branch reach extends. Shown in
   * Usuarios y roles so an administrator can see at a glance who is national
   * without opening each profile. Changed only by an administrador (B4).
   */
  branchScopeMode: BranchScopeMode;
  /**
   * MILESTONE 26B-6B — does this advisor receive automatically distributed
   * portal leads?
   *
   * Deliberately independent of `active`. Someone can work here full time and
   * still be outside the rotation — handling only walk-ins, covering a
   * different product, or away this month — and excluding them from
   * distribution must not require locking them out of the CRM.
   */
  autoAssignmentEnabled: boolean;
}

/**
 * A staff member who may own an Application (Milestone 23) — the option list
 * behind advisor assignment.
 *
 * Deliberately minimal: an id to store, a name to render, and the role to
 * disambiguate two people with similar names. No e-mail, no active flag, no
 * auth-link flag — getAssignableAdvisors() has already applied every rule, so
 * a caller cannot accidentally offer someone the database would refuse.
 */
export interface AssignableAdvisor {
  /** `profiles.id` — exactly what applications.assigned_advisor_profile_id
   * stores. */
  id: string;
  fullName: string;
  role: UserRole;
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
