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
import { useCurrentProfile } from "@/lib/auth/current-profile-context";
import { signOutAction } from "@/lib/auth/actions";
import { getInitials } from "@/lib/format";
import { SidebarNavLinks } from "./sidebar-nav-links";

export function MobileNav() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  // Milestone 5A: real authenticated identity, resolved once server-side
  // by src/app/(app)/layout.tsx and provided via CurrentProfileProvider —
  // no query happens here.
  const profile = useCurrentProfile();
  const t = useTranslations();

  // Real sign-out: must call signOutAction to actually clear the Supabase
  // session cookie server-side — this button previously only cleared the
  // demo-session flag, which left a real session valid after "logging
  // out" through here. See the same pattern in Topbar's handleLogout.
  const handleLogout = async () => {
    setOpen(false);
    try {
      await signOutAction();
    } catch (error) {
      console.error(
        "[mobile-nav] signOutAction threw:",
        error instanceof Error ? error.message : "unknown error"
      );
    }
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
              {getInitials(profile.fullName)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{profile.fullName}</p>
            <p className="truncate text-[11px] text-sidebar-foreground/60">
              {t(`roles.${profile.role}`)}
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
