"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ShieldCheck, Lock, Mail } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { LocaleSwitcher } from "@/components/shared/locale-switcher";
import { signInAction } from "@/lib/auth/actions";

export function LoginForm() {
  const router = useRouter();
  const t = useTranslations();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      const result = await signInAction({ email, password });
      if (result.status === "success") {
        // Real access control already happened inside signInAction
        // (Supabase session + getCurrentProfile()). This navigation just
        // moves the user along — src/app/(app)/layout.tsx re-verifies the
        // session server-side on the way in regardless.
        router.push("/dashboard");
        return;
      }
      toast.error(t("login.invalidCredentials"));
    } catch {
      toast.error(t("login.invalidCredentials"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleForgotPassword = () => {
    router.push("/forgot-password");
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

        <div className="max-w-md">
          <h2 className="text-3xl font-semibold leading-tight">{t("login.brandTagline")}</h2>
          <p className="mt-4 text-sm text-white/70">{t("login.brandDescription")}</p>
        </div>

        <div className="flex items-center gap-2 text-xs text-white/50">
          <ShieldCheck className="size-4" />
          <span>{t("login.demoEnvironmentNotice")}</span>
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
            <h1 className="mt-2 text-2xl font-semibold text-foreground">{t("login.title")}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{t("login.subtitle")}</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email">{t("login.email")}</Label>
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

            <div className="space-y-1.5">
              <Label htmlFor="password">{t("login.password")}</Label>
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="pl-9"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="remember"
                  checked={rememberMe}
                  onCheckedChange={(checked) => setRememberMe(checked === true)}
                />
                <Label htmlFor="remember" className="text-sm font-normal text-muted-foreground">
                  {t("login.rememberMe")}
                </Label>
              </div>
              <button
                type="button"
                onClick={handleForgotPassword}
                className="text-sm font-medium text-primary hover:underline"
              >
                {t("login.forgotPassword")}
              </button>
            </div>

            <Button type="submit" className="w-full" disabled={isSubmitting}>
              {isSubmitting ? t("login.submitting") : t("login.submit")}
            </Button>
          </form>

          <p className="mt-6 text-center text-xs text-muted-foreground lg:text-left">
            {t("login.privateNotice")}
          </p>
        </div>
      </div>
    </div>
  );
}
