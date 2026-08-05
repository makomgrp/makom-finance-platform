import type { Locale } from "@/i18n/config";

function intlLocale(locale: Locale): string {
  return locale === "en" ? "en-US" : "es-PA";
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
  }).format(new Date(iso));
}

export function formatLongDate(iso: string, locale: Locale = "es"): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "numeric",
    month: "long",
    year: "numeric",
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
