import "server-only";
import type { BranchOrigin, BranchScope } from "@/types";

/**
 * ============================================================================
 * MILESTONE 25C-2 — RESOLVING A ROW'S BRANCH ORIGIN FOR DISPLAY
 * ============================================================================
 *
 * Branch origin is read as an EMBED ON THE ALREADY-AUTHORIZED ROW, never as a
 * separate branches lookup. That is a security property, not a performance one:
 *
 *   - the row was returned because the caller's scope allowed it, so the branch
 *     hanging off that row is by construction a branch they may know about;
 *   - no branches directory is ever shipped to the browser to translate ids
 *     into names, so there is no list from which an out-of-scope branch name
 *     could be read;
 *   - there is no second query whose filter could drift from the first.
 *
 * THE EMBED IS DELIBERATELY NOT `!inner`. An inner join would silently drop
 * every unassigned record — precisely the rows a national administrator most
 * needs to find and route. A left embed resolves to null, which is the honest
 * answer and the one `toBranchOrigin` turns into an unassigned origin.
 */

/** The columns every branch-origin embed selects. One shape, one place. */
const BRANCH_ORIGIN_COLUMNS = "id, code, name";

/**
 * Builds the PostgREST embed for a branch-origin join.
 *
 * `fkName` is the foreign key constraint, e.g. `clients_branch_id_fkey` — the
 * same `!constraint` hint idiom used throughout this codebase, which keeps the
 * join unambiguous if a table ever gains a second reference to `branches`.
 */
export function branchOriginEmbed(fkName: string, alias = "branch"): string {
  return `${alias}:branches!${fkName}(${BRANCH_ORIGIN_COLUMNS})`;
}

/** The row shape a branch-origin embed produces. */
export interface BranchOriginRow {
  id: string;
  code: string;
  name: string;
}

/**
 * Maps an embedded branch row to a display origin.
 *
 * A null/absent embed means the record is UNASSIGNED — a real state, never an
 * error and never a missing name to paper over.
 */
export function toBranchOrigin(row: BranchOriginRow | null | undefined): BranchOrigin {
  if (!row) return { id: null, code: null, name: null };
  return { id: row.id, code: row.code, name: row.name };
}

/**
 * Can the CURRENT VIEW contain records from more than one branch?
 *
 * This is the single rule deciding whether a Sucursal column or badge is worth
 * showing, and the deciding factor is the VIEW — not the viewer's role. A
 * gerente holding two branches needs the column just as much as an
 * administrador does, and an administrador who has narrowed to one branch needs
 * it just as little.
 *
 *   national            YES — any branch, plus unassigned rows
 *   branch, 2+ ids      YES — rows may come from either
 *   branch, exactly 1   NO  — every row repeats the same label
 *   unassigned          NO  — every row is unassigned; the context says so
 *   empty               NO  — there are no rows
 *
 * Computed SERVER-SIDE from the effective view scope and passed to components
 * as a single boolean. Client components never receive the scope itself, so
 * they cannot recompute — or misread — authorization.
 */
export function viewSpansMultipleBranches(scope: BranchScope): boolean {
  if (scope.mode === "national") return true;
  if (scope.mode === "unassigned") return false;
  return scope.branchIds.length > 1;
}
