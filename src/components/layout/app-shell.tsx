"use client";

import { useState, type ReactNode } from "react";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

/**
 * Milestone 4: pure layout/UX shell — sidebar + topbar + content area.
 * No longer decides whether the caller is allowed to see this content;
 * that access-control responsibility moved to
 * src/app/(app)/layout.tsx (a Server Component, checked before AppShell
 * ever mounts) and, as a fast outer gate, src/proxy.ts. By the time this
 * component renders, the request has already passed both. See the Auth
 * migration plan.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 overflow-x-hidden p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
