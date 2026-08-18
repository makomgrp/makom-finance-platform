import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { applyBranchScope, isEmptyScope, isNationalScope } from "@/lib/services/branch-scope-query";
import type { BranchContextOption, BranchScope } from "@/types";

/**
 * ============================================================================
 * MILESTONE 25C-1 — VIEW CONTEXT: WHAT AM I LOOKING AT, NOT WHAT MAY I SEE
 * ============================================================================
 *
 * The branch selector is a DISPLAY FILTER. This module is the one place a
 * user-supplied context is turned into a scope, and it exists to make one
 * property structurally true:
 *
 *     effectiveViewScope  ⊆  authorizedScope
 *
 * A requested context can only ever NARROW. It is not merely "checked" against
 * the authorized scope — it is only ever used to SELECT FROM it. Every function
 * below starts from `authorized` and either returns it unchanged or returns a
 * strictly smaller subset of it. There is no code path where a request adds a
 * branch, and that is deliberate: a validation that can be forgotten is a
 * weaker guarantee than a construction that cannot express the mistake.
 *
 * ----------------------------------------------------------------------------
 * WHY THE URL CARRIES A CODE AND NOT A UUID
 * ----------------------------------------------------------------------------
 * `branches.code` is already unique and constrained to `^[A-Z0-9-]{2,12}$`, so
 * it is short, legible in a shared link, and stable. It is a LOOKUP KEY, never
 * a credential: possessing the right code grants nothing, because the lookup
 * runs against the caller's own authorized scope on every request. A UUID in
 * the address bar would have been equally unsafe to trust and considerably
 * uglier to read.
 *
 * ----------------------------------------------------------------------------
 * WHY AN INVALID CONTEXT FAILS SILENTLY
 * ----------------------------------------------------------------------------
 * Nonexistent code, malformed code, inactive branch, branch outside the
 * caller's scope, a membership removed since the link was shared, a stale
 * bookmark — ALL of them resolve to the caller's authorized default, with no
 * error, no toast and no distinction between the cases.
 *
 * Distinguishing them would be an existence oracle over ODL's branch structure:
 * "this branch is not yours" and "this branch does not exist" must be
 * indistinguishable, exactly as out-of-scope and nonexistent records are
 * throughout 25B. It also keeps users out of a dead end — someone whose
 * membership changed yesterday gets a working page today rather than an error
 * they cannot act on.
 */

/** URL token for "no branch filter" — the caller's whole authorized scope. */
export const BRANCH_CONTEXT_ALL = "todas";

/**
 * URL token for the UNASSIGNED queue.
 *
 * Deliberately a WORD, not a UUID and not an empty string: `branches.code` is
 * constrained to `^[A-Z0-9-]{2,12}$`, which is uppercase-only, so a lowercase
 * token can never collide with a real branch code no matter what ODL names
 * their offices.
 */
export const BRANCH_CONTEXT_UNASSIGNED = "sin-asignar";

/** What the caller asked for, before it has been validated against anything. */
export type RequestedBranchContext = string | undefined;

export interface BranchViewContext {
  /** Pass THIS to scoped reads. Always a subset of the authorized scope. */
  viewScope: BranchScope;
  /**
   * The context that was actually applied — which may differ from what was
   * requested, when the request fell back. Drives the selector's checkmark and
   * the dashboard heading.
   */
  selection: string;
}

/**
 * Turns an authorized scope plus a requested context into the scope to query
 * with.
 *
 * | authorized | requested        | result                    |
 * |------------|------------------|---------------------------|
 * | EMPTY      | anything         | EMPTY                     |
 * | national   | absent / todas   | national                  |
 * | national   | sin-asignar      | UNASSIGNED                |
 * | national   | active branch A  | branch [A]                |
 * | {A,B}      | absent / todas   | branch [A,B]              |
 * | {A,B}      | A                | branch [A]                |
 * | {A,B}      | C                | branch [A,B]  (silent)    |
 * | {A,B}      | sin-asignar      | branch [A,B]  (silent)    |
 *
 * NOTE the two rows that matter most. A branch-scoped user asking for
 * `sin-asignar` does NOT get unassigned records — unassigned is national-only,
 * and the request is treated exactly like any other context they cannot reach.
 * And a national user selecting one branch gets THAT BRANCH ONLY, which
 * correctly excludes unassigned rows; that is precisely why `sin-asignar` has
 * to be its own selectable context rather than being folded into either "all"
 * or a branch.
 */
export async function resolveBranchViewScope(
  authorized: BranchScope,
  requested: RequestedBranchContext
): Promise<BranchViewContext> {
  // No reach, nothing to narrow. Never queries, never falls anywhere else.
  if (isEmptyScope(authorized)) {
    return { viewScope: authorized, selection: BRANCH_CONTEXT_ALL };
  }

  const token = typeof requested === "string" ? requested.trim() : "";
  if (token === "" || token === BRANCH_CONTEXT_ALL) {
    return { viewScope: authorized, selection: BRANCH_CONTEXT_ALL };
  }

  if (token === BRANCH_CONTEXT_UNASSIGNED) {
    // NATIONAL-ONLY, and silently ignored otherwise. This single line is what
    // stops `?sucursal=sin-asignar` from being an escalation for a
    // branch-scoped employee.
    if (isNationalScope(authorized)) {
      return {
        viewScope: { mode: "unassigned", branchIds: [] },
        selection: BRANCH_CONTEXT_UNASSIGNED,
      };
    }
    return { viewScope: authorized, selection: BRANCH_CONTEXT_ALL };
  }

  const branch = await findActiveBranchInScope(authorized, token);
  if (!branch) {
    // Unknown, malformed, inactive, or simply not theirs — all one outcome.
    return { viewScope: authorized, selection: BRANCH_CONTEXT_ALL };
  }

  return {
    viewScope: { mode: "branch", branchIds: [branch.id] },
    selection: branch.code,
  };
}

/**
 * Resolves a branch code to a branch the caller may actually reach.
 *
 * The scope filter is part of the SAME query as the code lookup, so a branch
 * outside the caller's reach simply does not come back — this never learns
 * whether such a branch exists and therefore cannot leak it. Inactive branches
 * are excluded too: they are not valid operating contexts.
 */
async function findActiveBranchInScope(
  authorized: BranchScope,
  code: string
): Promise<{ id: string; code: string } | null> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await applyBranchScope(
      supabase.from("branches").select("id, code").eq("code", code).eq("active", true),
      authorized,
      // Scoping the branch directory filters on the branch's OWN id — branches
      // do not belong to branches.
      "id"
    ).maybeSingle<{ id: string; code: string }>();

    if (error) {
      console.error("[branch-view-context] Failed to resolve branch code:", error.message);
      return null;
    }
    return data ?? null;
  } catch (error) {
    console.error(
      "[branch-view-context] Unexpected failure resolving branch code:",
      error instanceof Error ? error.message : "unknown error"
    );
    return null;
  }
}

/**
 * The options the topbar selector may offer, built entirely from the caller's
 * own authorized scope.
 *
 * A branch the caller cannot reach is never returned, so its NAME never reaches
 * the browser — the selector cannot leak ODL's branch structure to someone who
 * is not entitled to it. Inactive branches are excluded: a closed office is not
 * somewhere you operate.
 *
 * Returns an EMPTY array for an empty scope, and a SINGLE-entry array for a
 * one-branch user — the topbar decides from the length whether to render a
 * dropdown, a passive label, or nothing at all.
 */
export async function getBranchContextOptions(
  authorized: BranchScope
): Promise<BranchContextOption[]> {
  if (isEmptyScope(authorized)) return [];

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await applyBranchScope(
      supabase.from("branches").select("id, code, name").eq("active", true),
      authorized,
      "id"
    ).order("name", { ascending: true });

    if (error) {
      console.error("[branch-view-context] Failed to load branch options:", error.message);
      return [];
    }

    const branches = ((data ?? []) as { id: string; code: string; name: string }[]).map(
      (branch): BranchContextOption => ({
        value: branch.code,
        label: branch.name,
        kind: "branch",
      })
    );

    // A single-branch user gets exactly that branch and no aggregate entry:
    // "all my branches" and "my branch" would be the same list, and offering
    // both is how a selector becomes noise. The topbar renders this as a
    // passive label rather than a control.
    if (!isNationalScope(authorized) && branches.length <= 1) {
      return branches;
    }

    const aggregate: BranchContextOption = {
      value: BRANCH_CONTEXT_ALL,
      label: "", // resolved in the UI: national vs "my branches" wording differs
      kind: "all",
    };

    // UNASSIGNED IS NATIONAL-ONLY, and it is omitted rather than disabled for
    // everyone else — an option that is visible but always refuses is worse
    // than one that was never offered.
    return isNationalScope(authorized)
      ? [aggregate, { value: BRANCH_CONTEXT_UNASSIGNED, label: "", kind: "unassigned" }, ...branches]
      : [aggregate, ...branches];
  } catch (error) {
    console.error(
      "[branch-view-context] Unexpected failure loading branch options:",
      error instanceof Error ? error.message : "unknown error"
    );
    return [];
  }
}
