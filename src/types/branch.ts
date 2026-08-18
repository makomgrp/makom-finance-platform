/**
 * ============================================================================
 * BRANCHES — THE THIRD AUTHORIZATION AXIS (Milestone 25A)
 * ============================================================================
 *
 * ODL is scaling to branches across Panama. Branch is NOT a display field: it
 * is the answer to "on which data may this person act", which is a genuinely
 * different question from "what may this person do" (capabilities) and "what
 * kind of work do they perform" (role). All three stay independent.
 *
 * MILESTONE 25A IS STRUCTURE ONLY. These types describe branches and staff
 * branch scope so they can be administered; NOTHING in 25A filters client or
 * application data by branch. That enforcement is 25B, and separating them is
 * deliberate — 25A is provably behaviour-neutral, 25B is the security change.
 */

/**
 * How far a staff member's branch reach extends.
 *
 *   'branch'   — exactly the branches they hold a membership in
 *   'national' — every active branch, present AND future, with no membership
 *                bookkeeping
 *
 * DELIBERATELY NOT A CAPABILITY. National reach is a SCOPE property set only by
 * an administrador (B4). If it were a capability it would be grantable through
 * profile_capability_grants, letting data reach be widened by a mechanism built
 * for action permissions. Delegating an action must never delegate scope.
 *
 * There is no "all branches" branch row. A magic sentinel would be a branch
 * that is not a branch, and every join would have to special-case it.
 */
export type BranchScopeMode = "branch" | "national";

/**
 * An ODL branch.
 *
 * `code` is the stable machine identity (e.g. "PTY01"); `name` is display only
 * and freely editable. Every foreign key uses `id` — never `code`, never
 * `name`. That is the Milestone 21 `legacy_id` lesson applied up front: an
 * identity you can rename is not an identity.
 *
 * DEACTIVATE-ONLY. There is no delete path, by approved policy and because
 * branches are permanent FK targets on historical clients and applications.
 */
export interface Branch {
  id: string;
  /** Stable, machine-readable, unique. `^[A-Z0-9-]{2,12}$`. */
  code: string;
  name: string;
  /** Required — the one field with real downstream consumers: regional
   * reporting, and future website intake routing. */
  province: string;
  city?: string;
  address?: string;
  phone?: string;
  email?: string;
  /** Head office is a PROPERTY of a branch, not a separate entity — modelling
   * it separately would fork every query. At most one, enforced by a partial
   * unique index. */
  isHeadquarters: boolean;
  active: boolean;
  createdAt: string;
}

/**
 * One staff member's membership in one branch.
 *
 * NO `active` COLUMN, deliberately. Two deactivation concepts (profile inactive
 * vs membership inactive) would immediately raise "is an active membership on
 * an inactive profile meaningful?" — a question with no business answer.
 * Removing someone from a branch DELETES the row, audited in crm_events,
 * exactly as capability revocation works in Milestone 24. `profiles.active`
 * remains the single access switch.
 */
export interface BranchMembership {
  /** `profiles.id`. */
  profileId: string;
  /** `branches.id`. */
  branchId: string;
  /** At most one per profile, enforced by a partial unique index. Drives
   * defaults and reporting, never authorization — scope is the full membership
   * set, not the primary. */
  isPrimary: boolean;
}

/**
 * A staff member's resolved branch reach — the branch-axis counterpart to the
 * effective capability set.
 *
 * Resolved SERVER-SIDE in getCurrentProfile(), once per request, alongside
 * identity and effective capabilities. Never asserted by the client.
 *
 * `branchIds` is empty when `mode` is 'national' — national means "all active
 * branches, including ones created tomorrow", which an enumerated list could
 * not express without a backfill every time a branch is added.
 *
 * MILESTONE 25A RESOLVES THIS BUT ENFORCES NOTHING WITH IT. It exists now so
 * that 25B is a pure enforcement change rather than enforcement plus plumbing.
 */
export interface BranchScope {
  mode: BranchScopeMode;
  /** Empty when mode is 'national'. */
  branchIds: string[];
}
