import { getLocale, getTranslations } from "next-intl/server";
import { CheckCircle2 } from "lucide-react";
import { formatLongDate } from "@/lib/format";
import type { Locale } from "@/i18n/config";

/**
 * ============================================================================
 * SOLICITUD RECIBIDA (26B-4)
 * ============================================================================
 *
 * What the applicant sees once ODL has their application — and what the same
 * continuation link shows every time afterwards, instead of an editable form.
 *
 * ----------------------------------------------------------------------------
 * IT CONFIRMS RECEIPT AND PROMISES NOTHING
 * ----------------------------------------------------------------------------
 * No approval, no pre-approval, no turnaround time, no disbursement date, no
 * "you qualify". ODL has not made any of those decisions at this point and
 * every one of them would be read as a commitment. The copy says the
 * application arrived, gives the number to quote, and describes what happens
 * next in neutral terms.
 *
 * THE APPLICATION NUMBER IS THE HERO. It is the customer's reference for every
 * future conversation, so it is the largest thing on the page and selectable.
 * It is NOT a credential: quoting it proves nothing and unlocks nothing, which
 * is exactly why a future status portal must authenticate on something else.
 */
export async function PortalConfirmation({
  applicationNumber,
  submittedAt,
}: {
  applicationNumber: string;
  /** When ODL received it — a fact about the past, never a promise about a date. */
  submittedAt: string;
}) {
  const [t, locale] = await Promise.all([getTranslations("portal.confirmation"), getLocale()]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-success/30 bg-success/[0.05] px-6 py-10 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-success/15 text-success">
          <CheckCircle2 className="size-8" aria-hidden="true" />
        </span>

        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t("title")}</h1>
          <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">{t("body")}</p>
        </div>

        <div className="mt-2 w-full rounded-xl border border-border bg-card px-4 py-4">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t("numberLabel")}
          </p>
          {/* `select-all` so a customer on a phone can copy it in one tap, and
              `break-all` so it never pushes the card sideways at 375px. */}
          <p className="mt-1 font-mono text-xl font-semibold break-all text-foreground select-all sm:text-2xl">
            {applicationNumber}
          </p>
        </div>

        {/* The submission DATE, formatted for a person. It says when ODL
            received the application — not when anything will be decided. An
            un-formatted ISO timestamp here would be machine noise, and as
            screen-reader-only text it would be read out digit by digit. */}
        <p className="text-sm text-muted-foreground">
          {t("submittedOn", { date: formatLongDate(submittedAt, locale as Locale) })}
        </p>
        <p className="text-sm text-muted-foreground">{t("keepReference")}</p>
      </div>

      <section aria-labelledby="what-next" className="rounded-2xl border border-border bg-card p-5">
        <h2 id="what-next" className="text-base font-semibold text-foreground">
          {t("whatNextTitle")}
        </h2>
        {/* An ordered list because these genuinely happen in sequence — and
            none of them states a deadline ODL has not committed to. */}
        <ol className="mt-3 flex flex-col gap-2.5">
          {[t("whatNext1"), t("whatNext2"), t("whatNext3")].map((line, index) => (
            <li key={line} className="flex gap-3">
              <span
                aria-hidden="true"
                className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
              >
                {index + 1}
              </span>
              <span className="text-sm leading-relaxed text-muted-foreground">{line}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
