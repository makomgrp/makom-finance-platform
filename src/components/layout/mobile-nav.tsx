"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Menu, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Separator } from "@/components/ui/separator";
import { useDemoSession } from "@/lib/demo-session";
import { SidebarNavLinks } from "./sidebar-nav-links";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { user, logout } = useDemoSession();
  const t = useTranslations();

  const handleLogout = () => {
    setOpen(false);
    logout();
    router.replace("/login");
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={
          <Button variant="ghost" size="icon" className="md:hidden">
            <Menu className="size-5" />
            <span className="sr-only">{t("navigation.openMenu")}</span>
          </Button>
        }
      />
      <SheetContent
        side="left"
        className="w-72 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground"
      >
        <SheetHeader className="h-16 flex-row items-center gap-2 space-y-0 px-4">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-sidebar-primary text-sm font-bold text-sidebar-primary-foreground">
            OD
          </div>
          <SheetTitle className="text-sm font-semibold text-sidebar-foreground">
            {t("common.brand.name")}
          </SheetTitle>
        </SheetHeader>

        <Separator className="bg-sidebar-border" />

        <div className="py-3">
          <SidebarNavLinks onNavigate={() => setOpen(false)} />
        </div>

        <Separator className="bg-sidebar-border" />

        <div className="flex items-center gap-2 p-3">
          <Avatar className="size-9 border border-sidebar-border">
            <AvatarFallback className="bg-sidebar-accent text-sidebar-accent-foreground text-xs font-semibold">
              {user.initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{user.fullName}</p>
            <p className="truncate text-[11px] text-sidebar-foreground/60">
              {t(`roles.${user.role}`)}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleLogout}
            className="size-8 shrink-0 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          >
            <LogOut className="size-4" />
            <span className="sr-only">{t("navigation.signOut")}</span>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
