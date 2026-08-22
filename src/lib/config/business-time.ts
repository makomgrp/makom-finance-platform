/**
 * ============================================================================
 * MILESTONE 26B-8 — ODL'S CALENDAR DAY
 * ============================================================================
 *
 * ODL operates in Panama. "Today" therefore means today in Panama, and it has
 * to mean that regardless of where the code happens to be running.
 *
 * ----------------------------------------------------------------------------
 * THE BUG THIS EXISTS TO PREVENT
 * ----------------------------------------------------------------------------
 * 26B-7 shipped Today/Overdue follow-up counts derived from the SERVER's local
 * calendar day. On a developer's Mac that is Panama time and the answer is
 * right by accident; on Vercel the runtime is UTC, and Panama is UTC-5. So a
 * commitment due at 8pm Panama on the 21st is already "the 22nd" in UTC — and
 * every follow-up scheduled after 7pm was filed under tomorrow, five hours
 * early, every single day. An advisor's "due today" list would quietly lose
 * its evening calls.
 *
 * ----------------------------------------------------------------------------
 * INSTANTS STAY INSTANTS
 * ----------------------------------------------------------------------------
 * Nothing here changes what is STORED. `next_action_at` remains a timestamptz
 * in UTC, as every timestamp in this schema is, and comparisons of the form
 * "is this instant before that instant" — which is what OVERDUE is — need no
 * timezone at all and deliberately do not use this module.
 *
 * A timezone is only needed to answer a CALENDAR question: do these two
 * instants fall on the same Panamanian date? That is the whole surface below.
 *
 * ----------------------------------------------------------------------------
 * WHY Intl AND NOT A -5 OFFSET
 * ----------------------------------------------------------------------------
 * Panama does not observe DST today, so subtracting five hours would be
 * correct right now — and would become a silent, once-a-year bug the moment
 * that stopped being true, or the moment ODL opened an office anywhere that
 * does. `Intl.DateTimeFormat` reads the IANA database, so the rule lives with
 * the platform rather than in a constant somebody has to remember to revisit.
 */
export const BUSINESS_TIME_ZONE = "America/Panama";

/**
 * `en-CA` is chosen for its FORMAT, not its language: it yields
 * `YYYY-MM-DD`, which sorts and compares as a plain string. The locale never
 * reaches a user — this value is an internal key, never rendered.
 */
const BUSINESS_DAY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Panamanian calendar date an instant falls on, as `YYYY-MM-DD`. */
export function businessDayKey(instant: Date): string {
  return BUSINESS_DAY_FORMATTER.format(instant);
}

/** Do two instants fall on the same Panamanian calendar date? */
export function isSameBusinessDay(a: Date, b: Date): boolean {
  return businessDayKey(a) === businessDayKey(b);
}
