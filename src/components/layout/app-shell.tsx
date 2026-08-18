"use client";

import { useState, type ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";
import type { BranchContextOption } from "@/types";

/**
 * Milestone 4: pure layout/UX shell — sidebar + topbar + content area.
 * No longer decides whether the caller is allowed to see this content;
 * that access-control responsibility moved to
 * src/app/(app)/layout.tsx (a Server Component, checked before AppShell
 * ever mounts) and, as a fast outer gate, src/proxy.ts. By the time this
 * component renders, the request has already passed both. See the Auth
 * migration plan.
 */
interface AppShellProps {
  children: ReactNode;
  /** MILESTONE 25C-1 — branch selector options, resolved server-side from the
   * caller's AUTHORIZED scope. Empty means "render no selector". */
  branchOptions: BranchContextOption[];
  /** Wording only: "all branches" vs "all my branches". Never filtering. */
  branchScopeIsNational: boolean;
  /** Resolved server-side by src/app/(app)/layout.tsx via
   * getActiveAlertsCount() — null means the count failed to load, never a
   * fabricated 0. Passed straight through to Topbar. */
  activeAlertsCount: number | null;
}

export function AppShell({
  children,
  activeAlertsCount,
  branchOptions,
  branchScopeIsNational,
}: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          activeAlertsCount={activeAlertsCount}
          branchOptions={branchOptions}
          branchScopeIsNational={branchScopeIsNational}
        />
        <main className="flex-1 overflow-x-hidden p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
