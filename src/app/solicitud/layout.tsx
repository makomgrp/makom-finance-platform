import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ShieldCheck } from "lucide-react";
import { LocaleSwitcher } from "@/components/shared/locale-switcher";
import { PortalBrand } from "@/components/portal/portal-brand";

/**
 * ============================================================================
 * THE PUBLIC ODL LOAN PORTAL SHELL (26B-1)
 * ============================================================================
 *
 * Deliberately NOT the CRM chrome. No sidebar, no branch context selector, no
 * navigation rail, no dense toolbar — a customer applying for a loan is not
 * operating a back office, and borrowing an internal layout is the fastest way
 * to make a public product feel like someone else's software.
 *
 * WHAT THE LAYOUT IS TRYING TO ACHIEVE
 *
 *   * CALM. One column, one job per screen, generous whitespace. The anxiety in
 *     a loan application comes from the subject matter; the page should not add
 *     to it.
 *   * READABLE. The workspace caps at 44rem so text keeps a comfortable
 *     measure on a 1440px monitor instead of stretching into a spreadsheet.
 *   * MOBILE FIRST. Padding starts at 1rem and the surface goes edge-to-edge
 *     on small screens, so nothing is cramped at 375px and nothing scrolls
 *     sideways.
 *   * OLDER-ADULT FRIENDLY. Base body text, not the CRM's compressed scale.
 *     Nothing important is set below 0.75rem, and the primary action is large.
 *
 * PUBLIC BY CONSTRUCTION: no `getCurrentProfile()` anywhere in this subtree.
 * The customer has no CRM session and never will — see `src/proxy.ts`, which
 * lists these paths as public.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.meta");
  return {
    title: t("title"),
    description: t("description"),
    // A half-finished loan application is not something a customer wants
    // surfacing in search results.
    robots: { index: false, follow: false },
  };
}

export default async function PortalLayout({ children }: LayoutProps<"/solicitud">) {
  const t = await getTranslations("portal.header");

  return (
    <div className="flex min-h-screen w-full flex-col bg-background">
      <header className="sticky top-0 z-20 border-b border-border/70 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <PortalBrand />
          <div className="flex items-center gap-2 sm:gap-3">
            {/* The reassurance cue. Quiet on purpose — a loud security badge
                reads as protesting too much. Hidden below `sm` so the header
                never crowds; the padlock alone carries it there. */}
            <span className="hidden items-center gap-1.5 text-xs font-medium text-muted-foreground md:flex">
              <ShieldCheck className="size-3.5 text-success" aria-hidden="true" />
              {t("secure")}
            </span>
            <LocaleSwitcher />
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto w-full max-w-2xl px-4 pt-6 pb-16 sm:px-6 sm:pt-10">{children}</div>
      </main>

      <footer className="border-t border-border/70 bg-card/50">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-1 px-4 py-6 sm:px-6">
          <p className="flex items-center gap-1.5 text-xs font-medium text-foreground md:hidden">
            <ShieldCheck className="size-3.5 text-success" aria-hidden="true" />
            {t("secure")}
          </p>
          <p className="text-xs text-muted-foreground">{t("secureDetail")}</p>
        </div>
      </footer>
    </div>
  );
}
