"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Mail, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LocaleSwitcher } from "@/components/shared/locale-switcher";
import { requestPasswordResetAction } from "@/lib/auth/actions";

export default function ForgotPasswordPage() {
  const t = useTranslations();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      await requestPasswordResetAction({ email });
    } finally {
      setIsSubmitting(false);
      // Always shows the same success state, whether or not the address
      // matched an account or the send even succeeded — the action itself
      // never reports failure to the caller, on purpose (no enumeration).
      setIsSubmitted(true);
    }
  };

  return (
    <div className="flex min-h-screen w-full">
      <div className="relative hidden w-1/2 flex-col justify-between bg-navy p-10 text-navy-foreground lg:flex">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-md bg-white/10 text-sm font-bold">
              OD
            </div>
            <div>
              <p className="text-sm font-semibold">{t("common.brand.company")}</p>
              <p className="text-xs text-white/60">{t("common.brand.name")}</p>
            </div>
          </div>
          <LocaleSwitcher variant="dark" />
        </div>

        <div className="my-auto max-w-md">
          <h2 className="text-3xl font-semibold leading-tight">{t("login.brandTagline")}</h2>
          <p className="mt-4 text-sm text-white/70">{t("login.brandDescription")}</p>
        </div>
      </div>

      <div className="flex w-full flex-col items-center justify-center bg-muted/40 px-6 py-12 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center text-center lg:items-start lg:text-left">
            <div className="mb-3 flex w-full items-center justify-between gap-2 lg:hidden">
              <div className="flex items-center gap-2">
                <div className="flex size-9 items-center justify-center rounded-md bg-navy text-sm font-bold text-navy-foreground">
                  OD
                </div>
                <span className="text-sm font-semibold text-foreground">
                  {t("common.brand.company")}
                </span>
              </div>
              <LocaleSwitcher />
            </div>
            <div className="hidden w-full justify-end lg:flex">
              <LocaleSwitcher />
            </div>
            <h1 className="mt-2 text-2xl font-semibold text-foreground">
              {t("forgotPassword.title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("forgotPassword.subtitle")}</p>
          </div>

          {isSubmitted ? (
            <div className="space-y-4">
              <div className="flex items-start gap-2 rounded-md border border-border bg-card p-4 text-sm text-foreground">
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
                <span>{t("forgotPassword.successMessage")}</span>
              </div>
              <Link
                href="/login"
                className="block text-center text-sm font-medium text-primary hover:underline"
              >
                {t("forgotPassword.backToLogin")}
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">{t("forgotPassword.email")}</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    required
                    autoComplete="username"
                    placeholder="usuario@odlfinancial.com"
                    className="pl-9"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? t("forgotPassword.submitting") : t("forgotPassword.submit")}
              </Button>

              <Link
                href="/login"
                className="block text-center text-sm font-medium text-primary hover:underline"
              >
                {t("forgotPassword.backToLogin")}
              </Link>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
