import type { Locale } from "@/i18n/config";

function intlLocale(locale: Locale): string {
  return locale === "en" ? "en-US" : "es-PA";
}

/**
 * A calendar date has no timezone, so it must not be given one.
 *
 * `new Date("2016-09-01")` is parsed as UTC MIDNIGHT. Rendered in Panama
 * (UTC-5) that is 7pm on 31 August, so a DATE column read back to the person
 * who typed it shows the day BEFORE the one they entered — an employment start
 * date, a date of birth, a business's first day of trading, each off by one.
 *
 * Pinning the formatter to UTC cancels the shift, but only for values that are
 * date-only. A real timestamp still renders in local time, which for a
 * timestamp is the correct and expected behaviour.
 */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function zoneFor(iso: string): string | undefined {
  return DATE_ONLY.test(iso) ? "UTC" : undefined;
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
  const now = new Date("2026-08-05T12:00:00-05:00");
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
