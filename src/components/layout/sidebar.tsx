"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronsLeft, ChevronsRight, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDemoSession } from "@/lib/demo-session";
import { SidebarNavLinks } from "./sidebar-nav-links";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const router = useRouter();
  const { user, logout } = useDemoSession();
  const t = useTranslations();

  const handleLogout = () => {
    logout();
    router.replace("/login");
  };

  return (
    <aside
      className={
        "hidden md:flex md:flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-200 " +
        (collapsed ? "md:w-[68px]" : "md:w-64")
      }
    >
      <div className="flex h-16 items-center gap-2 px-4">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground">
          OD
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-tight">{t("common.brand.name")}</p>
            <p className="truncate text-[11px] leading-tight text-sidebar-foreground/60">
              {t("common.brand.company")}
            </p>
          </div>
        )}
      </div>

      <Separator className="bg-sidebar-border" />

      <div className="flex-1 overflow-y-auto py-3">
        <SidebarNavLinks collapsed={collapsed} />
      </div>

      <Separator className="bg-sidebar-border" />

      <div className="p-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggle}
          className="w-full justify-center text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
        >
          {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
          {!collapsed && <span className="ml-2">{t("navigation.collapseMenu")}</span>}
        </Button>
      </div>

      <div className={"flex items-center gap-2 p-3 " + (collapsed ? "flex-col" : "")}>
        <Avatar className="size-9 border border-sidebar-border">
          <AvatarFallback className="bg-sidebar-accent text-sidebar-accent-foreground text-xs font-semibold">
            {user.initials}
          </AvatarFallback>
        </Avatar>
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user.fullName}</p>
            <p className="truncate text-[11px] text-sidebar-foreground/60">
              {t(`roles.${user.role}`)}
            </p>
          </div>
        )}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon"
                onClick={handleLogout}
                className="size-8 shrink-0 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
              >
                <LogOut className="size-4" />
                <span className="sr-only">{t("navigation.signOut")}</span>
              </Button>
            }
          />
          <TooltipContent side="right">{t("navigation.signOut")}</TooltipContent>
        </Tooltip>
      </div>
    </aside>
  );
}
