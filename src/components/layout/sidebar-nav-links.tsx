"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav-config";
import { BRANCH_CONTEXT_PARAM, withBranchContext } from "@/lib/branch-context-url";

interface SidebarNavLinksProps {
  collapsed?: boolean;
  onNavigate?: () => void;
}

export function SidebarNavLinks({ collapsed, onNavigate }: SidebarNavLinksProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations("navigation");
  // MILESTONE 25C-1 — carry the selected branch between GLOBAL LIST surfaces so
  // moving from a Panamá Centro dashboard to Clientes stays on Panamá Centro.
  // withBranchContext() refuses to attach it to anything else (Chat,
  // Configuración, dossiers), so the parameter never appears where nothing
  // reads it.
  const branchContext = searchParams.get(BRANCH_CONTEXT_PARAM);

  return (
    <nav className="flex flex-col gap-1 px-2">
      {NAV_ITEMS.map((item) => {
        const isActive =
          pathname === item.href ||
          (pathname.startsWith(item.href) && item.href !== "/dashboard");
        const Icon = item.icon;
        const label = t(item.key);
        return (
          <Link
            key={item.href}
            href={withBranchContext(item.href, branchContext)}
            onClick={onNavigate}
            title={collapsed ? label : undefined}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              isActive &&
                "bg-sidebar-accent text-sidebar-accent-foreground",
              collapsed && "justify-center px-2"
            )}
          >
            <Icon className="size-[18px] shrink-0" strokeWidth={1.75} />
            {!collapsed && <span className="truncate">{label}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
