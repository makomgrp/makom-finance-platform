"use client";

import { useTranslations } from "next-intl";

/**
 * ============================================================================
 * THE REFERENCE LINE — AND WHAT IT SAYS WHEN THERE IS NO REFERENCE (26B-5)
 * ============================================================================
 *
 * An ODL application number means ODL has the application. Until the customer
 * presses "Enviar solicitud" that is not true, so there is no number to show —
 * and showing one anyway, or inventing a DRAFT-0001 to fill the gap, would tell
 * the customer their application had been submitted when it had not.
 *
 * So this renders one of two honest things:
 *
 *   * before submission — "Tu solicitud está en progreso", no identifier;
 *   * after submission  — the real number, which is now a fact.
 *
 * It exists as one component because Steps 2, 3 and 4 all show this line, and a
 * rule about not fabricating an official identifier is worth stating once
 * rather than trusting three call sites to remember it.
 *
 * The continuation token is deliberately NOT offered as a stand-in reference:
 * it is a credential, not a customer-quotable identifier, and printing it on
 * screen would invite exactly the screenshotting and sharing it must not have.
 */
export function PortalReferenceLine({ applicationNumber }: { applicationNumber?: string }) {
  const t = useTranslations("portal.reference");

  return (
    <p className="text-xs text-muted-foreground">
      {applicationNumber ? t("official", { number: applicationNumber }) : t("inProgress")}
    </p>
  );
}
