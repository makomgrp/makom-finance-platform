import { useTranslations } from "next-intl";

/**
 * ============================================================================
 * ⚠️ TYPOGRAPHIC PLACEHOLDER — NOT THE OFFICIAL ODL LOGO
 * ============================================================================
 *
 * This repository contains NO ODL brand asset. `public/` holds only the five
 * SVGs the Next.js starter ships with (file, globe, next, vercel, window), and
 * nothing in `src/` references an ODL image.
 *
 * Milestone 26B-1 is explicit that an official logo must not be redrawn,
 * approximated or generated. So this component sets the COMPANY'S OWN NAME in
 * the application's own typeface and does nothing else — no mark, no
 * monogram-as-emblem, no invented glyph, no colours claimed as brand colours
 * (the navy is the existing `--navy` design token the CRM already uses).
 *
 * WHEN THE REAL ASSET ARRIVES: drop it into `public/`, replace the two elements
 * below with a `next/image`, and keep the `alt` text. Nothing else in the
 * portal needs to change — every other component composes this one.
 */
export function PortalBrand() {
  const t = useTranslations("portal.header");

  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-navy text-[0.8125rem] font-semibold tracking-tight text-navy-foreground"
      >
        {t("brandName")}
      </span>
      {/* The mark already reads "ODL", so the text beside it carries only the
          rest of the name — repeating "ODL" next to itself looked like a
          rendering bug at 375px, where the suffix had been hidden. Screen
          readers get the whole company name in one piece below, since the mark
          is aria-hidden. */}
      <span className="text-sm font-semibold tracking-tight text-foreground">
        <span className="sr-only">{`${t("brandName")} `}</span>
        {t("brandSuffix")}
      </span>
    </span>
  );
}
