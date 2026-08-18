import "server-only";
import type { BranchScope } from "@/types";

/**
 * ============================================================================
 * THE ONLY PLACE BRANCH PREDICATES ARE WRITTEN (Milestone 25B-1)
 * ============================================================================
 *
 * Every branch-scoped read funnels through here. No service writes
 * `.in("branch_id", …)` by hand: twenty hand-written filters is twenty chances
 * to forget one, and a forgotten branch filter is a silent cross-branch leak —
 * no error, no log, no failing test.
 *
 * THREE SCOPES, THREE BEHAVIOURS:
 *
 *   national      no predicate. Sees every branch AND unassigned (NULL) rows.
 *   branch + ids  branch_id IN (ids). NULL is excluded automatically, because
 *                 SQL `IN` never matches NULL.
 *   branch + []   MATCHES NOTHING. Never "no predicate" — see below.
 *
 * ----------------------------------------------------------------------------
 * THE EMPTY-SCOPE TRAP — READ BEFORE CHANGING ANYTHING HERE
 * ----------------------------------------------------------------------------
 * A user with no memberships has an EMPTY scope, and empty must mean "sees
 * nothing", never "sees everything". PostgREST renders `.in("branch_id", [])`
 * as `in.()`, which is not a dependable false predicate — depending on version
 * it can error or behave unexpectedly. Emitting it and hoping is unacceptable
 * for a security boundary.
 *
 * So empty scope NEVER produces an `.in()`. Callers short-circuit on
 * isEmptyScope() and return an empty result without querying; if a query is
 * built anyway, applyBranchScope substitutes an impossible-UUID equality,
 * which is provably false in every PostgREST version. Both paths are asserted
 * in the Milestone 25B-1 runtime tests.
 *
 * ----------------------------------------------------------------------------
 * WHY NULL IS INVISIBLE TO BRANCH-SCOPED USERS
 * ----------------------------------------------------------------------------
 * `branch_id IS NULL` means "not yet assigned to a real branch" — pre-cutover
 * data, or a record awaiting routing. It does NOT mean "all branches", "my
 * branch", "default" or "headquarters". Letting NULL fall into every branch
 * would leak the entire pre-branch dataset into every office at once, which is
 * exactly backwards. Only NATIONAL scope sees unassigned rows, so an
 * administrador can find and route them.
 */

/**
 * The canonical EMPTY scope: matches nothing, ever.
 *
 * Used where a page cannot resolve a profile. That should be unreachable — the
 * (app) layout redirects to /login first — but if it ever happens the page must
 * show nothing rather than everything. Fail closed, never to national.
 */
export const EMPTY_BRANCH_SCOPE: BranchScope = { mode: "branch", branchIds: [] };

/** A UUID that cannot collide with a real row — the false predicate used when
 * a query is somehow built under an empty scope. */
const IMPOSSIBLE_BRANCH_ID = "00000000-0000-0000-0000-000000000000";

/**
 * True when this scope can never match any row.
 *
 * Callers MUST check this before querying and return an empty result directly.
 * It saves a round-trip, and more importantly it makes "empty means nothing"
 * explicit at every call site instead of buried inside a query builder.
 */
export function isEmptyScope(scope: BranchScope): boolean {
  return scope.mode === "branch" && scope.branchIds.length === 0;
}

/** True when this scope sees every branch, including unassigned rows. */
export function isNationalScope(scope: BranchScope): boolean {
  return scope.mode === "national";
}

/**
 * Applies branch scope to a PostgREST query builder.
 *
 * `column` allows scoping through an embedded relation — e.g.
 * "application.branch_id" — for tables that derive their branch from a parent
 * rather than storing it.
 *
 * NARROW CAST, DELIBERATE AND CONTAINED. Typing the parameter structurally
 * (`T extends { in(...): T; eq(...): T }`) makes TypeScript verify that
 * constraint against PostgrestFilterBuilder's deeply recursive generics and
 * bail out with TS2589. Keeping `T` unconstrained preserves the caller's exact
 * builder type — so `.order()`, `.maybeSingle()`, `.eq()` still chain and
 * still type-check at the call site — while this one function absorbs the
 * structural work. The cast is confined to three lines here and to a shape
 * every PostgREST builder genuinely has.
 */
export function applyBranchScope<T>(query: T, scope: BranchScope, column = "branch_id"): T {
  if (scope.mode === "national") {
    return query;
  }

  const builder = query as unknown as {
    in: (column: string, values: readonly string[]) => T;
    eq: (column: string, value: string) => T;
  };

  if (scope.branchIds.length === 0) {
    // Provably false. NEVER `.in(column, [])` — see the header.
    return builder.eq(column, IMPOSSIBLE_BRANCH_ID);
  }
  return builder.in(column, scope.branchIds);
}

/**
 * In-memory equivalent, for rows already fetched through a parent query that
 * could not express the filter in SQL.
 *
 * Same three behaviours and the same NULL rule: a row whose branch is
 * null/undefined is visible only to national scope.
 */
export function isBranchInScope(scope: BranchScope, branchId: string | null | undefined): boolean {
  if (scope.mode === "national") return true;
  if (scope.branchIds.length === 0) return false;
  if (!branchId) return false; // NULL is national-only
  return scope.branchIds.includes(branchId);
}

/**
 * Builds a select string that adds an `!inner` parent embed when — and only
 * when — the scope actually needs one.
 *
 * `!inner` turns the embed into an INNER JOIN, so a child whose parent is out
 * of scope disappears from the result rather than returning with a null
 * parent. That distinction is the whole security property, which is why the
 * hint is not optional.
 *
 * NATIONAL adds no embed at all: a join could only risk excluding rows whose
 * parent relation is legitimately absent, and national must see unassigned
 * data.
 */
export function withScopedParent(
  baseSelect: string,
  scope: BranchScope,
  parentEmbed: string
): string {
  if (scope.mode === "national") return baseSelect;
  return `${baseSelect}, ${parentEmbed}`;
}

/**
 * ============================================================================
 * THE SYSTEM SCOPE — FOR AUTOMATED PIPELINES WITH NO HUMAN ACTOR
 * ============================================================================
 *
 * Some reads happen with no authenticated user at all: the public website
 * intake pipeline matching an applicant against existing clients, document
 * classification during ingestion, evidence look-ups inside an upload. There is
 * no profile, therefore no memberships, therefore no scope to resolve — and
 * defaulting such a caller to EMPTY would silently break intake, while leaving
 * the parameter optional would let a human-facing read forget it.
 *
 * So automated callers pass THIS, explicitly and visibly.
 *
 * ----------------------------------------------------------------------------
 * WHEN THIS MAY BE USED — AND WHEN IT MAY NOT
 * ----------------------------------------------------------------------------
 * ONLY on a code path that:
 *   1. has no authenticated CRM user (public intake, background processing), or
 *   2. is reading back rows the same function just wrote,
 * AND whose result is never returned to a human caller unfiltered.
 *
 * It is NOT a fallback for "I could not resolve the user's scope" — that case
 * must fail closed to an empty scope. It is NOT a convenience for a service
 * whose caller forgot to thread scope through. Every use is a deliberate
 * statement that the reader is the system, not a person.
 *
 * Client identification matching is national BY DESIGN regardless: a cédula
 * identifies one person across all of ODL, which is why
 * findClientByIdentification is unscoped entirely.
 */
export const SYSTEM_NATIONAL_SCOPE: BranchScope = { mode: "national", branchIds: [] };
