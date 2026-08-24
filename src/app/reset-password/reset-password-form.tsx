"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Lock, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LocaleSwitcher } from "@/components/shared/locale-switcher";
import { updatePasswordAction } from "@/lib/auth/actions";

const MIN_PASSWORD_LENGTH = 8;

export function ResetPasswordForm() {
  const t = useTranslations();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Set by /auth/callback when exchanging the emailed link's code failed
  // (expired or already-used link) — no session was ever established, so
  // there's nothing to reset yet; the user needs a fresh link.
  const linkInvalid = searchParams.get("error") === "1";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage(null);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setErrorMessage(t("resetPassword.passwordTooShort"));
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage(t("resetPassword.passwordMismatch"));
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await updatePasswordAction({ password, confirmPassword });
      if (result.status === "success") {
        setIsSuccess(true);
        setTimeout(() => router.push("/login"), 2000);
      } else {
        setErrorMessage(t("resetPassword.errorMessage"));
      }
    } catch {
      setErrorMessage(t("resetPassword.errorMessage"));
    } finally {
      setIsSubmitting(false);
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
              {t("resetPassword.title")}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("resetPassword.subtitle")}</p>
          </div>

          {linkInvalid ? (
            <div className="space-y-4">
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm text-foreground">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
                <span>{t("resetPassword.linkInvalid")}</span>
              </div>
              <Button
                className="w-full"
                nativeButton={false}
                render={<Link href="/forgot-password" />}
              >
                {t("resetPassword.requestNewLink")}
              </Button>
            </div>
          ) : isSuccess ? (
            <div className="flex items-start gap-2 rounded-md border border-border bg-card p-4 text-sm text-foreground">
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" />
              <span>{t("resetPassword.successMessage")}</span>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="new-password">{t("resetPassword.newPassword")}</Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="new-password"
                    type="password"
                    required
                    autoComplete="new-password"
                    placeholder="••••••••"
                    className="pl-9"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirm-password">{t("resetPassword.confirmPassword")}</Label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="confirm-password"
                    type="password"
                    required
                    autoComplete="new-password"
                    placeholder="••••••••"
                    className="pl-9"
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                  />
                </div>
              </div>

              {errorMessage && (
                <p className="text-sm text-destructive" role="alert">
                  {errorMessage}
                </p>
              )}

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? t("resetPassword.submitting") : t("resetPassword.submit")}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
