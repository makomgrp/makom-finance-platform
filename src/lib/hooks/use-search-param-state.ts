"use client";

import { useCallback } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * ============================================================================
 * MILESTONE 26B-8 — OPERATIONAL FILTERS THAT SURVIVE A LINK
 * ============================================================================
 *
 * The pipeline's view, advisor and follow-up filters lived in `useState`, so
 * 26B-7's Dashboard could count overdue follow-ups but could not hand anyone a
 * link that opened them. Reloading the board also silently discarded whatever
 * an advisor had been looking at.
 *
 * This puts that state in the query string instead. It is a URL because it is
 * a VIEW someone should be able to bookmark, send to a colleague, or reach by
 * pressing Back — not because the server needs to know.
 *
 * ----------------------------------------------------------------------------
 * IT CANNOT WIDEN AUTHORIZATION, BY CONSTRUCTION
 * ----------------------------------------------------------------------------
 * The server has already fetched exactly the rows this user may see, scoped by
 * branch, before any of this runs. These values only ever FILTER that array
 * down. Putting `advisor=<someone-else's-id>` in the URL by hand shows fewer
 * cards, never more, and an id that matches nothing simply shows none — there
 * is no request it can influence and no predicate it can escape.
 *
 * Nothing sensitive is encoded: a view name, a filter name, and a profile id
 * that is already rendered on every card the viewer can see.
 *
 * ----------------------------------------------------------------------------
 * replace, NOT push
 * ----------------------------------------------------------------------------
 * Changing a filter is refining one view, not navigating. `push` would make
 * Back walk through every dropdown change someone tried before it left the
 * board — so the entry that Back returns to is the page they arrived from,
 * while the URL still updates and still reloads correctly.
 *
 * OTHER PARAMS ARE PRESERVED. `?sucursal=` is the branch view context (25C-1)
 * and is read server-side; rebuilding the query string from scratch would drop
 * it and silently move the user back to their default branch.
 */
export function useSearchParamState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  /**
   * Reads one param, validated against the values the screen actually
   * supports.
   *
   * FALLS BACK SILENTLY on anything unexpected — missing, misspelt, an
   * abandoned bookmark from a renamed filter, or someone typing in the address
   * bar. A filter is not a place to report errors: showing the default view is
   * what the person wanted anyway, and an error state here would be noise.
   */
  const read = useCallback(
    <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
      const value = searchParams.get(key);
      return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
    },
    [searchParams]
  );

  /** Reads a free-form param (an advisor id) with a caller-supplied guard. */
  const readGuarded = useCallback(
    (key: string, isValid: (value: string) => boolean, fallback: string): string => {
      const value = searchParams.get(key);
      return value !== null && isValid(value) ? value : fallback;
    },
    [searchParams]
  );

  /**
   * Writes params, dropping any set to the `defaultValue` so a pristine view
   * has a clean URL rather than `?view=tabla&advisor=all&followup=all`.
   */
  const write = useCallback(
    (updates: Record<string, { value: string; defaultValue: string }>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, { value, defaultValue }] of Object.entries(updates)) {
        if (value === defaultValue) next.delete(key);
        else next.set(key, value);
      }
      const query = next.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  return { read, readGuarded, write };
}
