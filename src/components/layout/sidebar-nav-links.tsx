"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { NAV_ITEMS } from "./nav-config";
import { useCapability } from "@/lib/auth/use-capability";
import { BRANCH_CONTEXT_PARAM, withBranchContext } from "@/lib/branch-context-url";
import { useChatNotifications } from "@/lib/chat/chat-notifications-context";

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
  // MILESTONE 26B-9A — the mailbox link is hidden from roles that cannot open
  // it. Reads the same resolved capability set the server authorizes against,
  // so a hidden link and a rejected request can never disagree.
  const canManageEmail = useCapability("email:manage");
  // MILESTONE 26B-13 — el sidebar sólo consume un número; quién escucha
  // Realtime, cuenta y descuenta es el provider global.
  const { unreadTotal } = useChatNotifications();

  return (
    <nav className="flex flex-col gap-1 px-2">
      {NAV_ITEMS.filter((item) => item.capability !== "email:manage" || canManageEmail).map((item) => {
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
              "relative flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
              "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              isActive &&
                "bg-sidebar-accent text-sidebar-accent-foreground",
              collapsed && "justify-center px-2"
            )}
          >
            <Icon className="size-[18px] shrink-0" strokeWidth={1.75} />
            {!collapsed && <span className="truncate">{label}</span>}
            {/* Sin no leídos no hay badge: un cero permanente sería ruido. */}
            {item.key === "chat" && unreadTotal > 0 && (
              <span
                aria-label={t("unreadMessages", { count: unreadTotal })}
                className={cn(
                  "ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-destructive px-1.5 py-0.5 text-[11px] font-semibold text-destructive-foreground tabular-nums",
                  collapsed && "ml-0 absolute top-1 right-1 min-w-4 px-1 py-0 text-[10px]"
                )}
              >
                {unreadTotal > 99 ? "99+" : unreadTotal}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
