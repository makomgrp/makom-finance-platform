import { getTranslations } from "next-intl/server";
import { Clock } from "lucide-react";

/**
 * ============================================================================
 * MILESTONE 26B-18 — WHAT AN APPLICANT SEES WHILE A PERSON DECIDES
 * ============================================================================
 *
 * The matching engine could not establish, on its own, who this applicant is.
 * That is a good outcome — it refused to guess — but the applicant must not pay
 * for it with a 404. This is the destination instead.
 *
 * ----------------------------------------------------------------------------
 * IT SAYS NOTHING ABOUT WHY
 * ----------------------------------------------------------------------------
 * Every honest-sounding explanation available here is dangerous. "This email is
 * already registered" tells a stranger which addresses exist in ODL's book.
 * "Your details do not match our records" confirms there ARE records for the
 * identity they typed. Either one turns a loan form into a lookup tool for
 * anyone willing to submit guesses.
 *
 * So the copy describes only ODL's own next action, which is true regardless of
 * the reason and reveals nothing: we have your information, a person will look
 * at it, we will get in touch. No name, no document number, no client id, no
 * review reason, no score. Nothing on this page varies with whether a matching
 * customer exists, so nothing on it can be used to find out.
 *
 * ----------------------------------------------------------------------------
 * NEUTRAL, NOT ALARMING AND NOT CONGRATULATORY
 * ----------------------------------------------------------------------------
 * Structurally the same card as `PortalConfirmation`, because this is the same
 * moment in the same journey and a second visual language would read as a
 * different product. But the success palette is wrong here — nothing has been
 * received in the sense that screen means — and the warning palette would tell
 * the applicant they did something wrong, which they did not. A muted card with
 * a clock says the honest thing: this is with us, and it is waiting.
 *
 * There is no application number, because there is no application. Printing a
 * placeholder would give the customer a reference that identifies nothing.
 */
export async function PortalUnderReview() {
  const t = await getTranslations("portal.underReview");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-muted/40 px-6 py-10 text-center">
        <span className="flex size-14 items-center justify-center rounded-full bg-background text-muted-foreground">
          <Clock className="size-8" aria-hidden="true" />
        </span>

        <div className="flex flex-col gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{t("title")}</h1>
          <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">{t("body")}</p>
        </div>
      </div>

      <section aria-labelledby="review-next" className="rounded-2xl border border-border bg-card p-5">
        <h2 id="review-next" className="text-base font-semibold text-foreground">
          {t("whatNextTitle")}
        </h2>
        {/* Two steps, not three: the confirmation screen's third line promises a
            decision on an application, and there is no application to decide. */}
        <ol className="mt-3 flex flex-col gap-2.5">
          {[t("whatNext1"), t("whatNext2")].map((line, index) => (
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

        {/* Explicit permission to leave. Without it a customer sits on a page
            with no button, waiting for something to happen. */}
        <p className="mt-4 text-sm text-muted-foreground">{t("closeSafely")}</p>
      </section>
    </div>
  );
}
