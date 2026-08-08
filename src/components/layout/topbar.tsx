"use client";

import { usePathname, useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Bell, Search, LogOut, Settings, UserRound } from "lucide-react";
import { Input } from "@/components/ui/input";
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
import { useDemoSession } from "@/lib/demo-session";
import { signOutAction } from "@/lib/auth/actions";
import { getSectionTitleKey } from "./nav-config";
import { MobileNav } from "./mobile-nav";
import { getActiveAlerts } from "@/lib/demo-data";
import { formatRelativeTime } from "@/lib/format";
import type { Locale } from "@/i18n/config";

const DEMO_NOTIFICATIONS = [
  {
    id: "n-1",
    titleKey: "notificationsDropdown.n1Title",
    descriptionKey: "activityLog.act003",
    params: { name: "Juan Pérez" },
    date: "2026-08-02T14:20:00-05:00",
  },
  {
    id: "n-2",
    titleKey: "notificationsDropdown.n2Title",
    descriptionKey: "activityLog.act007",
    params: { name: "Ana Gómez" },
    date: "2026-08-03T09:10:00-05:00",
  },
  {
    id: "n-3",
    titleKey: "notificationsDropdown.n3Title",
    descriptionKey: "activityLog.act017",
    params: { name: "Pedro González" },
    date: "2026-07-20T10:35:00-05:00",
  },
];

export function Topbar() {
  const pathname = usePathname();
  const router = useRouter();
  const locale = useLocale() as Locale;
  // `user` still comes from the demo session — display-only, unrelated to
  // access control (see the "temporary demo-session compatibility" note in
  // src/lib/demo-session.tsx). Real identity display is Milestone 5's job.
  const { user } = useDemoSession();
  const t = useTranslations();
  const activeAlertsCount = getActiveAlerts().length;

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
        <div className="relative hidden sm:block">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder={t("common.globalSearchPlaceholder")}
            className="w-48 pl-8 md:w-64"
          />
        </div>

        <LocaleSwitcher />

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="size-[18px]" />
                {activeAlertsCount > 0 && (
                  <Badge className="absolute -right-1 -top-1 size-4 justify-center rounded-full bg-destructive p-0 text-[10px] text-white">
                    {activeAlertsCount}
                  </Badge>
                )}
                <span className="sr-only">{t("common.notifications")}</span>
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-80">
            <DropdownMenuLabel>{t("notificationsDropdown.recent")}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {DEMO_NOTIFICATIONS.map((notification) => (
              <DropdownMenuItem key={notification.id} className="flex-col items-start gap-0.5">
                <span className="text-sm font-medium">{t(notification.titleKey)}</span>
                <span className="text-xs text-muted-foreground">
                  {t(notification.descriptionKey, notification.params)}
                </span>
                <span className="text-[11px] text-muted-foreground/70">
                  {formatRelativeTime(notification.date, locale, t)}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="ghost" className="gap-2 px-1.5 sm:px-2">
                <Avatar className="size-7">
                  <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
                    {user.initials}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden text-sm font-medium sm:inline">{user.fullName}</span>
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                <p className="text-sm font-medium">{user.fullName}</p>
                <p className="text-xs font-normal text-muted-foreground">
                  {t(`roles.${user.role}`)}
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
