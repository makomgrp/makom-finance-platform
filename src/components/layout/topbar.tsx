"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Bell, LogOut, Settings, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LocaleSwitcher } from "@/components/shared/locale-switcher";
import { useCurrentProfile } from "@/lib/auth/current-profile-context";
import { signOutAction } from "@/lib/auth/actions";
import { getSectionTitleKey } from "./nav-config";
import { MobileNav } from "./mobile-nav";
import { getInitials } from "@/lib/format";

/**
 * MILESTONE 18: the bell used to open a dropdown listing three hardcoded
 * "notifications" about demo clients, directly beneath a badge showing a
 * REAL active-alert count — the true number made the invented entries
 * read as real.
 *
 * The fix is a COUNT ONLY, and deliberately not a list of real alerts
 * either. Every alert currently persisted is seeded fixture content: it
 * is real PERSISTENCE, but it is not real ODL business history. An
 * aggregate count over those rows is a true statement about the system's
 * state ("there are N unresolved alerts"); rendering them individually in
 * the app shell — client name, alert type, timestamp — would narrate
 * fixture data as though it were operational history, which is precisely
 * what this milestone exists to remove. The alerts module itself is the
 * right place to inspect individual records, with its own context.
 *
 * So the bell is now a plain link to /alertas carrying the real count.
 * No dropdown, no per-record narrative, and no notification
 * infrastructure: there is no notifications table, no read/unread state,
 * no preference model and no delivery channel, and Milestone 18
 * introduced none of them.
 */
interface TopbarProps {
  /** Resolved server-side by src/app/(app)/layout.tsx via
   * getActiveAlertsCount() — null means the count failed to load. The
   * badge is simply not rendered in that case, the same as a genuine
   * zero, rather than asserting a count we don't actually know. */
  activeAlertsCount: number | null;
}

export function Topbar({ activeAlertsCount }: TopbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  // Milestone 5A: real authenticated identity, resolved once server-side
  // by src/app/(app)/layout.tsx and provided via CurrentProfileProvider —
  // no query happens here.
  const profile = useCurrentProfile();
  const t = useTranslations();

  // Real sign-out: signOutAction clears the Supabase session cookie
  // server-side — that alone is what makes the next request to any
  // protected route bounce back to /login (via proxy.ts/the (app) layout),
  // regardless of this client-side redirect. router.replace here is purely
  // immediate UX, not part of the access-control guarantee. The Milestone 3
  // demo-flag bridge (logout()) is gone — AppShell no longer reads that
  // flag for anything, so clearing it no longer serves a purpose.
  const handleLogout = async () => {
    try {
      await signOutAction();
    } catch (error) {
      console.error(
        "[topbar] signOutAction threw:",
        error instanceof Error ? error.message : "unknown error"
      );
    }
    router.replace("/login");
  };

  return (
    <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-background px-4 md:px-6">
      <MobileNav />

      <h1 className="text-base font-semibold text-foreground md:text-lg">
        {t(getSectionTitleKey(pathname))}
      </h1>

      <div className="ml-auto flex items-center gap-2 md:gap-3">
        <LocaleSwitcher />

        <Button
          variant="ghost"
          size="icon"
          className="relative"
          onClick={() => router.push("/alertas")}
        >
          <Bell className="size-[18px]" />
          {activeAlertsCount !== null && activeAlertsCount > 0 && (
            <Badge className="absolute -right-1 -top-1 size-4 justify-center rounded-full bg-destructive p-0 text-[10px] text-white">
              {activeAlertsCount}
            </Badge>
          )}
          <span className="sr-only">{t("navigation.alerts")}</span>
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" className="gap-2 px-1.5 sm:px-2">
                <Avatar className="size-7">
                  <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                    {getInitials(profile.fullName)}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden text-sm font-medium sm:inline">{profile.fullName}</span>
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                <p className="text-sm font-medium">{profile.fullName}</p>
                <p className="text-xs font-normal text-muted-foreground">
                  {t(`roles.${profile.role}`)}
                </p>
              </DropdownMenuLabel>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => router.push("/configuracion")}>
              <UserRound className="size-4" />
              {t("navigation.myProfile")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => router.push("/configuracion")}>
              <Settings className="size-4" />
              {t("navigation.settings")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={handleLogout}>
              <LogOut className="size-4" />
              {t("navigation.signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
