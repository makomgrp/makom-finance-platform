"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { setLocale } from "@/actions/locale";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/config";

interface LocaleSwitcherProps {
  className?: string;
  variant?: "light" | "dark";
}

export function LocaleSwitcher({ className, variant = "light" }: LocaleSwitcherProps) {
  const locale = useLocale();
  const t = useTranslations("common.language");
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleChange = (next: Locale) => {
    if (next === locale || isPending) return;
    startTransition(async () => {
      await setLocale(next);
      router.refresh();
    });
  };

  const options: Locale[] = ["es", "en"];

  return (
    <div
      role="group"
      aria-label={t("label")}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full border p-0.5 text-xs font-medium",
        variant === "dark"
          ? "border-white/15 bg-white/5"
          : "border-border bg-muted/60",
        isPending && "opacity-70",
        className
      )}
    >
      {options.map((option) => {
        const isActive = option === locale;
        return (
          <button
            key={option}
            type="button"
            onClick={() => handleChange(option)}
            aria-pressed={isActive}
            className={cn(
              "rounded-full px-2 py-1 transition-colors",
              isActive
                ? variant === "dark"
                  ? "bg-white/15 text-white"
                  : "bg-background text-foreground shadow-sm"
                : variant === "dark"
                  ? "text-white/60 hover:text-white"
                  : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t(option)}
          </button>
        );
      })}
    </div>
  );
}
