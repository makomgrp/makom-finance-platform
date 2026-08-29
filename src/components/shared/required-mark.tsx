"use client";

import { useTranslations } from "next-intl";

/**
 * ============================================================================
 * MILESTONE 26B-24 — WHICH FIELDS THE FORM WILL REFUSE TO SUBMIT WITHOUT
 * ============================================================================
 *
 * The client form has nine required fields and said so nowhere. An operator
 * filled it in, pressed Register, and the browser stopped them on the first
 * empty one; they filled that, pressed again, and were stopped on the next.
 * Loading twenty-five historical clients that way means discovering the same
 * nine fields twenty-five times.
 *
 * This marks them BEFORE the attempt. It adds no rule: every field wearing one
 * already carried `required`, and nothing became mandatory to make the asterisk
 * look tidy. Optional fields — employer, observations — stay unmarked, which is
 * what keeps the mark worth reading.
 *
 * The asterisk is decorative for assistive technology (`aria-hidden`), because
 * the input's own `required` attribute is what a screen reader announces; a
 * second announcement of "asterisk" after every label is noise, not help. The
 * legend at the foot of the form explains the symbol for everyone reading it
 * visually.
 */
export function RequiredMark() {
  const t = useTranslations();
  return (
    <span className="ml-0.5 text-destructive" aria-hidden="true" title={t("common.requiredFieldAria")}>
      *
    </span>
  );
}

/** The legend that gives the asterisks their meaning. One per form, at the end. */
export function RequiredFieldsNote() {
  const t = useTranslations();
  return <p className="text-xs text-muted-foreground">{t("common.requiredFieldsNote")}</p>;
}
