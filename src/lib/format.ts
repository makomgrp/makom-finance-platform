import { BUSINESS_TIME_ZONE } from "@/lib/config/business-time";
import type { Locale } from "@/i18n/config";

function intlLocale(locale: Locale): string {
  return locale === "en" ? "en-US" : "es-PA";
}

/**
 * Every value this module renders is pinned to an explicit zone. WHICH zone
 * depends on what the value is.
 *
 * A CALENDAR DATE has no timezone, so it must not be given a real one.
 * `new Date("2016-09-01")` is parsed as UTC MIDNIGHT. Rendered in Panama
 * (UTC-5) that is 7pm on 31 August, so a DATE column read back to the person
 * who typed it shows the day BEFORE the one they entered — an employment start
 * date, a date of birth, a business's first day of trading, each off by one.
 * Pinning date-only values to UTC cancels the shift.
 *
 * ----------------------------------------------------------------------------
 * MILESTONE 26B-15A — AN INSTANT NEEDS A ZONE TOO
 * ----------------------------------------------------------------------------
 * This used to return `undefined` for timestamps, on the reasoning that a real
 * instant "renders in local time, which for a timestamp is the correct and
 * expected behaviour". That is wrong twice over.
 *
 * `undefined` means the RUNTIME's zone — and this code renders twice, in two
 * different runtimes. Vercel renders in UTC, the browser re-renders in the
 * viewer's zone, and React compares the two strings. A follow-up logged at
 * 6:20pm Panama shipped as "23 ago 2026, 11:20 p. m." and hydrated as
 * "23 ago 2026, 06:20 p. m.", so every screen showing a time of day threw a
 * hydration mismatch and silently repainted.
 *
 * And "local time" was never what these values mean. They are ODL's own record
 * of when something happened — a note authored, a decision taken, an email
 * received. An advisor opening the CRM from Madrid has to read the same hour
 * her colleague in Panama City reads, or the audit trail says two different
 * things about one event.
 *
 * So instants render in ODL's business zone: deterministic on both sides of
 * hydration, and the only reading that means anything institutionally. The
 * zone comes from `business-time.ts` rather than a literal here, so the rule
 * lives in one place — see that file for why it is an IANA name and not -5.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function zoneFor(iso: string): string {
  return DATE_ONLY.test(iso) ? "UTC" : BUSINESS_TIME_ZONE;
}

export function formatCurrency(amount: number): string {
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `B/. ${formatted}`;
}

export function formatDate(iso: string, locale: Locale = "es"): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: zoneFor(iso),
  }).format(new Date(iso));
}

export function formatLongDate(iso: string, locale: Locale = "es"): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: zoneFor(iso),
  }).format(new Date(iso));
}

export function formatDateTime(iso: string, locale: Locale = "es"): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: zoneFor(iso),
  }).format(new Date(iso));
}

type RelativeTimeTranslator = (
  key: "common.relativeTime.justNow" | "common.relativeTime.minutes" | "common.relativeTime.hours" | "common.relativeTime.days",
  values?: { count: number }
) => string;

export function formatRelativeTime(
  iso: string,
  locale: Locale,
  t: RelativeTimeTranslator
): string {
  // MILESTONE 26B-6D — THE CLOCK IS THE REAL ONE.
  //
  // This read `new Date("2026-08-05T12:00:00-05:00")` — a fixed instant that
  // shipped in the initial release alongside seed data dated around it. Every
  // relative timestamp in the CRM was therefore measured against 5 August 2026
  // forever, so once real activity moved past that date every diff went
  // NEGATIVE and fell into the `< 1 minute` branch. A call logged nine hours
  // ago rendered as "hace instantes", and so did one logged last week: the
  // pipeline's last-contact line, the application table's status-changed
  // column and the chat conversation list all reported the same thing about
  // every record, which is worse than showing nothing.
  //
  // Kept as a plain `new Date()` rather than an injected clock: this is a
  // display helper called during render, the value is never persisted or
  // compared, and a parameter would push the same decision onto a dozen call
  // sites for no gain.
  const now = new Date();
  const date = new Date(iso);
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.round(diffMs / 60000);
  const diffHours = Math.round(diffMinutes / 60);
  const diffDays = Math.round(diffHours / 24);

  if (diffMinutes < 1) return t("common.relativeTime.justNow");
  if (diffMinutes < 60) return t("common.relativeTime.minutes", { count: diffMinutes });
  if (diffHours < 24) return t("common.relativeTime.hours", { count: diffHours });
  if (diffDays < 7) return t("common.relativeTime.days", { count: diffDays });
  return formatDate(iso, locale);
}

export function getInitials(fullName: string): string {
  return fullName
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
