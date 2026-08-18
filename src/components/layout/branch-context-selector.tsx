"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Building2, Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BRANCH_CONTEXT_PARAM, isBranchContextPath } from "@/lib/branch-context-url";
import type { BranchContextOption } from "@/types";

/**
 * ============================================================================
 * THE BRANCH CONTEXT SELECTOR (Milestone 25C-1)
 * ============================================================================
 *
 * THIS CONTROL GRANTS NOTHING. It writes a branch CODE into the URL; the server
 * re-resolves that code against the caller's own authorized scope on every
 * request and silently ignores anything they cannot reach. Editing the address
 * bar by hand achieves exactly as much as using this menu — which is the point.
 * There is deliberately no client-side scope state here to be trusted, cached,
 * or accidentally believed.
 *
 * WHAT IT RENDERS, AND WHY THE THREE SHAPES DIFFER:
 *
 *   0 options  nothing at all. An employee with no branch sees no control,
 *              because there is nothing to choose between and a disabled
 *              dropdown would only invite them to try.
 *
 *   1 option   a PASSIVE LABEL, not a menu. A dropdown with one item is
 *              friction pretending to be a feature; the person still needs to
 *              know which office they are in, so the answer is stated rather
 *              than hidden behind a click.
 *
 *   2+ options a dropdown, led by the aggregate entry.
 *
 * The aggregate's wording is decided HERE rather than on the server, because
 * "Todas las sucursales" and "Todas mis sucursales" are the same option
 * carrying different meaning: a national administrator really is looking at
 * every branch, while a manager is looking at every branch OF THEIRS. Saying
 * "all branches" to the second person would be a small, repeated lie.
 */
interface BranchContextSelectorProps {
  options: BranchContextOption[];
  /** True when the caller's authorized scope is national — decides the
   * aggregate label wording only. Never used for filtering. */
  isNational: boolean;
}

export function BranchContextSelector({ options, isNational }: BranchContextSelectorProps) {
  const t = useTranslations("branchContext");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (options.length === 0) return null;

  const labelFor = (option: BranchContextOption) => {
    if (option.kind === "all") return isNational ? t("allBranches") : t("allMyBranches");
    if (option.kind === "unassigned") return t("unassigned");
    return option.label;
  };

  // Exactly one branch and no aggregate: state it, do not ask about it.
  if (options.length === 1 && options[0].kind === "branch") {
    return (
      <span className="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex">
        <Building2 className="size-4 shrink-0" />
        <span className="truncate">{t("label", { branch: options[0].label })}</span>
      </span>
    );
  }

  // The URL is the single source of display context — never React state. A
  // value the server rejected simply is not in `options`, so the checkmark
  // falls back to the aggregate exactly as the server's own fallback did.
  const requested = searchParams.get(BRANCH_CONTEXT_PARAM);
  const active =
    options.find((option) => option.value === requested) ??
    options.find((option) => option.kind === "all") ??
    options[0];

  const select = (value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value === active.value) return;
    // "All" is the absence of a filter, so it is expressed by removing the
    // parameter rather than by writing a token — the clean URL IS the default.
    if (options.find((option) => option.value === value)?.kind === "all") {
      next.delete(BRANCH_CONTEXT_PARAM);
    } else {
      next.set(BRANCH_CONTEXT_PARAM, value);
    }
    const query = next.toString();
    // Only global list surfaces carry context. Changing it from a page that
    // does not honour it would write a parameter nothing reads.
    const target = isBranchContextPath(pathname) ? pathname : "/dashboard";
    router.push(query ? `${target}?${query}` : target);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="sm" className="max-w-[10rem] gap-1.5 px-2 md:max-w-[16rem]">
            <Building2 className="size-4 shrink-0" />
            <span className="truncate">{labelFor(active)}</span>
            <ChevronDown className="size-3.5 shrink-0 opacity-60" />
            <span className="sr-only">{t("srSelect")}</span>
          </Button>
        }
      />
      <DropdownMenuContent align="start" className="min-w-56">
        {options.map((option, index) => (
          <div key={option.value}>
            {/* One rule under the aggregate block, separating "everything" from
                the individual branches. */}
            {option.kind === "branch" && index > 0 && options[index - 1].kind !== "branch" ? (
              <DropdownMenuSeparator />
            ) : null}
            <DropdownMenuItem onClick={() => select(option.value)}>
              <Check
                className={
                  option.value === active.value ? "size-4 shrink-0" : "size-4 shrink-0 opacity-0"
                }
              />
              <span className="truncate">{labelFor(option)}</span>
            </DropdownMenuItem>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
