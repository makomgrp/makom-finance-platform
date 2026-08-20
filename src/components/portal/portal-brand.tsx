import fs from "node:fs";
import path from "node:path";
import Image from "next/image";
import { useTranslations } from "next-intl";

/**
 * ============================================================================
 * ODL BRAND MARK — PUBLIC PORTAL ONLY
 * ============================================================================
 *
 * Renders the official ODL Financial Corporation logo when the asset is
 * present, and the company name set in the application's own typeface when it
 * is not.
 *
 * ----------------------------------------------------------------------------
 * WHY THE FALLBACK EXISTS AT ALL
 * ----------------------------------------------------------------------------
 * The logo must never be redrawn, approximated, or reconstructed in CSS — a
 * near-miss of a financial institution's identity is worse than no logo,
 * because it looks official while being wrong. So there are exactly two honest
 * states: the real asset, or the company's name as plain text.
 *
 * The file is looked up ON THE SERVER at render time rather than imported, so
 * that dropping the asset in requires NO code change and shipping without it
 * produces no broken image. Add the file, restart, done.
 *
 * ----------------------------------------------------------------------------
 * REPLACING THE PLACEHOLDER
 * ----------------------------------------------------------------------------
 * Save the official logo (transparent PNG or SVG) as:
 *
 *     public/brand/odl-financial-corporation.png
 *
 * A wordmark-style asset roughly 3:1 to 4:1 works best in this header. Nothing
 * else needs to change: `object-contain` inside a fixed-height box means the
 * logo keeps its own proportions and cannot be stretched, whatever its
 * intrinsic size.
 *
 * This component is PUBLIC-PORTAL ONLY. The internal CRM's branding is
 * deliberately untouched.
 */

const LOGO_PUBLIC_PATH = "/brand/odl-financial-corporation.png";

/**
 * Resolved once per process rather than per render: `existsSync` is cheap but
 * a header renders on every page, and the answer cannot change without a
 * deploy or a restart.
 */
let logoPresent: boolean | undefined;

function hasLogoAsset(): boolean {
  if (logoPresent === undefined) {
    logoPresent = fs.existsSync(path.join(process.cwd(), "public", LOGO_PUBLIC_PATH));
  }
  return logoPresent;
}

export function PortalBrand() {
  const t = useTranslations("portal.header");
  const companyName = `${t("brandName")} ${t("brandSuffix")}`;

  if (hasLogoAsset()) {
    return (
      // Fixed height, automatic width, `object-contain`: the logo's own aspect
      // ratio is preserved at every breakpoint and it can never distort.
      <Image
        src={LOGO_PUBLIC_PATH}
        alt={companyName}
        width={320}
        height={80}
        priority
        className="h-8 w-auto object-contain sm:h-9"
      />
    );
  }

  return (
    <span className="flex items-center gap-2.5">
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-navy text-[0.8125rem] font-semibold tracking-tight text-navy-foreground"
      >
        {t("brandName")}
      </span>
      <span className="text-sm font-semibold tracking-tight text-foreground">
        <span className="sr-only">{`${t("brandName")} `}</span>
        {t("brandSuffix")}
      </span>
    </span>
  );
}
