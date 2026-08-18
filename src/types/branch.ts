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
 *
 * ============================================================================
 * MILESTONE 25C-1 — WHY `mode` IS WIDER THAN `BranchScopeMode`
 * ============================================================================
 *
 * There are now TWO kinds of scope flowing through this system, and the
 * difference is the whole security model:
 *
 *   AUTHORIZED SCOPE — what this person may reach. Produced ONLY by
 *     getCurrentProfile(), only ever 'national' or 'branch', because those are
 *     the only two values `profiles.branch_scope_mode` can hold and the only
 *     two an administrador role can resolve to.
 *
 *   VIEW SCOPE — what they are currently LOOKING at. Always a subset of their
 *     authorized scope, produced ONLY by resolveBranchViewScope(), and able to
 *     take one extra value: 'unassigned'.
 *
 * Both are carried by this one interface so that all ~25 scoped service
 * functions keep a single parameter type — widening the type here rather than
 * forking it avoids a signature change across the entire read layer, which
 * would have been a far larger and more dangerous diff than the property it
 * buys.
 *
 * 'unassigned' IS NOT AN AUTHORIZATION. It cannot be stored, cannot be granted,
 * and cannot be reached by a branch-scoped user: `BranchScopeMode` (the DB
 * column's type) deliberately does NOT include it, so getCurrentProfile() is
 * structurally incapable of producing it, and resolveBranchViewScope() only
 * returns it when the AUTHORIZED scope is already national. It is a filter that
 * narrows national reach down to the records nobody owns yet.
 */
export interface BranchScope {
  mode: BranchViewMode;
  /** Empty when mode is 'national' or 'unassigned'. */
  branchIds: string[];
}

/**
 * MILESTONE 25C-1 — the modes a VIEW may take.
 *
 * `BranchScopeMode` (above) stays exactly as it was: the two values
 * `profiles.branch_scope_mode` accepts, and therefore the only two an
 * AUTHORIZED scope can ever hold. This adds the third value only a VIEW can
 * have. Keeping them as two named types is what makes "unassigned is not
 * grantable" a fact the compiler helps enforce rather than a comment.
 */
export type BranchViewMode = BranchScopeMode | "unassigned";

/**
 * One entry in the topbar branch selector.
 *
 * `code` — never the UUID — is what reaches the URL. It is already unique and
 * constrained to `^[A-Z0-9-]{2,12}$`, so it is short, legible in a shared link,
 * and meaningless as a credential: it is resolved back to a branch server-side,
 * against the caller's own authorized scope, on every request.
 */
export interface BranchContextOption {
  /** `branches.code`, or one of the reserved UI tokens. */
  value: string;
  /** Display label. For real branches this is `branches.name`. */
  label: string;
  kind: "all" | "unassigned" | "branch";
}
