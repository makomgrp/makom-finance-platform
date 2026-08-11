"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { CheckCircle2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LocaleSwitcher } from "@/components/shared/locale-switcher";
import type { IdentificationType, LocalizedText } from "@/types";

/**
 * Milestone 15C — public website loan-application form. The customer-
 * facing counterpart to src/components/clients/real-client-form-dialog.tsx
 * (same field set for the applicant/employment section, deliberately not
 * shared/forked — that component stays CRM-internal, calling
 * createClientAction directly, which this form must never do).
 *
 * ADAPTER ONLY: this component's only backend interaction is one POST to
 * /api/public/application-intake. It contains no Client-matching,
 * Client-creation, Application-creation, or Product-resolution logic of
 * its own — all of that is the Milestone 15B Intake Engine's job, on the
 * server, behind that one endpoint.
 */

interface PublicProduct {
  id: string;
  code: string;
  name: LocalizedText;
}

interface FormState {
  fullName: string;
  identificationType: IdentificationType;
  identificationNumber: string;
  email: string;
  phone: string;
  birthDate: string;
  nationality: string;
  address: string;
  position: string;
  employerName: string;
  monthlySalary: string;
  requestedProductCode: string;
  requestedAmount: string;
  requestedTermMonths: string;
  consent: boolean;
  // Honeypot — real users never see or fill this field. See the field's
  // own JSX comment below and src/lib/validation/public-application-intake.ts.
  website: string;
}

const EMPTY_FORM: FormState = {
  fullName: "",
  identificationType: "cedula",
  identificationNumber: "",
  email: "",
  phone: "",
  birthDate: "",
  nationality: "",
  address: "",
  position: "",
  employerName: "",
  monthlySalary: "",
  requestedProductCode: "",
  requestedAmount: "",
  requestedTermMonths: "",
  consent: false,
  website: "",
};

type SubmitState = "idle" | "submitting" | "success" | "error";

export function PublicApplicationIntakeForm({ products }: { products: PublicProduct[] }) {
  const t = useTranslations();
  const locale = useLocale() as keyof LocalizedText;

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitState, setSubmitState] = useState<SubmitState>("idle");
  const [referenceId, setReferenceId] = useState<string | null>(null);

  // Minted once per page load, held for the lifetime of this form
  // instance — every submit attempt (including a retry after a network
  // failure or a double click) reuses the same value, which is exactly
  // what lets application_intakes' unique(channel, submission_id)
  // constraint absorb a duplicate click safely. See the implementation
  // report's idempotency section.
  const [submissionId] = useState(() => crypto.randomUUID());

  const update = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    if (fieldErrors[field]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const productOptions = useMemo(
    () => products.map((product) => ({ code: product.code, label: product.name[locale] ?? product.name.es })),
    [products, locale]
  );

  const fieldError = (field: string) => {
    const code = fieldErrors[field];
    return code ? t(`publicIntake.errors.${code}` as never) : undefined;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (submitState === "submitting" || submitState === "success") return;

    setSubmitState("submitting");
    setFieldErrors({});

    try {
      const response = await fetch("/api/public/application-intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          submissionId,
          fullName: form.fullName,
          identificationType: form.identificationType,
          identificationNumber: form.identificationNumber,
          email: form.email,
          phone: form.phone,
          birthDate: form.birthDate,
          nationality: form.nationality,
          address: form.address,
          position: form.position,
          employerName: form.employerName || undefined,
          monthlySalary: form.monthlySalary === "" ? undefined : Number(form.monthlySalary),
          requestedProductCode: form.requestedProductCode,
          requestedAmount: form.requestedAmount === "" ? undefined : Number(form.requestedAmount),
          requestedTermMonths: form.requestedTermMonths === "" ? undefined : Number(form.requestedTermMonths),
          consent: form.consent,
          website: form.website,
        }),
      });

      const data = (await response.json()) as {
        success: boolean;
        submissionId?: string;
        fieldErrors?: Record<string, string>;
        error?: string;
      };

      if (data.success) {
        setReferenceId(data.submissionId ?? submissionId);
        setSubmitState("success");
        return;
      }

      if (data.error === "VALIDATION_ERROR" && data.fieldErrors) {
        setFieldErrors(data.fieldErrors);
        setSubmitState("error");
        toast.error(t("publicIntake.errorGenericTitle"));
        return;
      }

      setSubmitState("error");
      toast.error(t("publicIntake.errorGenericTitle"));
    } catch {
      setSubmitState("error");
      toast.error(t("publicIntake.errorGenericTitle"));
    }
  };

  if (submitState === "success") {
    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-muted/40 px-6 py-12">
        <Card className="w-full max-w-md text-center">
          <CardContent className="flex flex-col items-center gap-4 pt-6">
            <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
              <CheckCircle2 className="size-8" />
            </div>
            <h1 className="text-xl font-semibold text-foreground">{t("publicIntake.successTitle")}</h1>
            <p className="text-sm text-muted-foreground">{t("publicIntake.successBody")}</p>
            {referenceId && (
              <p className="text-xs text-muted-foreground">
                {t("publicIntake.successReference")}: <span className="font-mono">{referenceId}</span>
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full bg-muted/40">
      <header className="flex items-center justify-between border-b bg-background px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex size-9 items-center justify-center rounded-md bg-navy text-sm font-bold text-navy-foreground">
            OD
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{t("common.brand.company")}</p>
          </div>
        </div>
        <LocaleSwitcher />
      </header>

      <main className="mx-auto w-full max-w-3xl px-6 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-foreground">{t("publicIntake.hero.title")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{t("publicIntake.hero.subtitle")}</p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="space-y-6">
          {/* Honeypot — hidden from real users (off-screen, unreachable by
              tab, unannounced by screen readers), left unfilled by every
              real human. A naive bot that fills every input it finds will
              fill this one, which is exactly the signal
              isHoneypotTriggered() checks server-side. */}
          <div className="absolute left-[-9999px] top-auto size-px overflow-hidden" aria-hidden="true">
            <label htmlFor="website">Website</label>
            <input
              id="website"
              name="website"
              type="text"
              tabIndex={-1}
              autoComplete="off"
              value={form.website}
              onChange={(e) => update("website", e.target.value)}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("publicIntake.sections.applicant")}</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="fullName">{t("clients.form.fullName")}</Label>
                <Input
                  id="fullName"
                  required
                  aria-invalid={Boolean(fieldError("fullName"))}
                  value={form.fullName}
                  onChange={(e) => update("fullName", e.target.value)}
                />
                {fieldError("fullName") && <p className="text-xs text-destructive">{fieldError("fullName")}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="identificationType">{t("clients.form.idType")}</Label>
                <Select
                  value={form.identificationType}
                  onValueChange={(value) => value && update("identificationType", value as IdentificationType)}
                >
                  <SelectTrigger id="identificationType" className="w-full">
                    <SelectValue>
                      {(value: string) =>
                        value === "cedula" ? t("clients.form.idTypeCedula") : t("clients.form.idTypePassport")
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cedula">{t("clients.form.idTypeCedula")}</SelectItem>
                    <SelectItem value="pasaporte">{t("clients.form.idTypePassport")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="identificationNumber">{t("clients.form.idNumber")}</Label>
                <Input
                  id="identificationNumber"
                  required
                  aria-invalid={Boolean(fieldError("identificationNumber"))}
                  value={form.identificationNumber}
                  onChange={(e) => update("identificationNumber", e.target.value)}
                />
                {fieldError("identificationNumber") && (
                  <p className="text-xs text-destructive">{fieldError("identificationNumber")}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email">{t("clients.form.email")}</Label>
                <Input
                  id="email"
                  type="email"
                  required
                  aria-invalid={Boolean(fieldError("email"))}
                  value={form.email}
                  onChange={(e) => update("email", e.target.value)}
                />
                {fieldError("email") && <p className="text-xs text-destructive">{fieldError("email")}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="phone">{t("clients.form.phone")}</Label>
                <Input
                  id="phone"
                  required
                  aria-invalid={Boolean(fieldError("phone"))}
                  value={form.phone}
                  onChange={(e) => update("phone", e.target.value)}
                />
                {fieldError("phone") && <p className="text-xs text-destructive">{fieldError("phone")}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="birthDate">{t("clients.form.birthDate")}</Label>
                <Input
                  id="birthDate"
                  type="date"
                  required
                  aria-invalid={Boolean(fieldError("birthDate"))}
                  value={form.birthDate}
                  onChange={(e) => update("birthDate", e.target.value)}
                />
                {fieldError("birthDate") && <p className="text-xs text-destructive">{fieldError("birthDate")}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="nationality">{t("clients.form.nationality")}</Label>
                <Input
                  id="nationality"
                  required
                  aria-invalid={Boolean(fieldError("nationality"))}
                  value={form.nationality}
                  onChange={(e) => update("nationality", e.target.value)}
                />
                {fieldError("nationality") && <p className="text-xs text-destructive">{fieldError("nationality")}</p>}
              </div>

              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="address">{t("clients.form.address")}</Label>
                <Input
                  id="address"
                  required
                  aria-invalid={Boolean(fieldError("address"))}
                  value={form.address}
                  onChange={(e) => update("address", e.target.value)}
                />
                {fieldError("address") && <p className="text-xs text-destructive">{fieldError("address")}</p>}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("publicIntake.sections.employment")}</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="position">{t("clients.form.position")}</Label>
                <Input
                  id="position"
                  required
                  aria-invalid={Boolean(fieldError("position"))}
                  value={form.position}
                  onChange={(e) => update("position", e.target.value)}
                />
                {fieldError("position") && <p className="text-xs text-destructive">{fieldError("position")}</p>}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="employerName">
                  {t("publicIntake.fields.employerName")}{" "}
                  <span className="text-muted-foreground">{t("publicIntake.fields.employerNameOptional")}</span>
                </Label>
                <Input
                  id="employerName"
                  aria-invalid={Boolean(fieldError("employerName"))}
                  value={form.employerName}
                  onChange={(e) => update("employerName", e.target.value)}
                />
                {fieldError("employerName") && (
                  <p className="text-xs text-destructive">{fieldError("employerName")}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="monthlySalary">{t("clients.form.monthlySalary")}</Label>
                <Input
                  id="monthlySalary"
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  aria-invalid={Boolean(fieldError("monthlySalary"))}
                  value={form.monthlySalary}
                  onChange={(e) => update("monthlySalary", e.target.value)}
                />
                {fieldError("monthlySalary") && (
                  <p className="text-xs text-destructive">{fieldError("monthlySalary")}</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("publicIntake.sections.loan")}</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="requestedProductCode">{t("publicIntake.fields.product")}</Label>
                <Select
                  value={form.requestedProductCode}
                  onValueChange={(value) => value && update("requestedProductCode", value)}
                >
                  <SelectTrigger id="requestedProductCode" className="w-full">
                    <SelectValue>
                      {(value: string) =>
                        productOptions.find((p) => p.code === value)?.label ??
                        t("publicIntake.fields.productPlaceholder")
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {productOptions.map((product) => (
                      <SelectItem key={product.code} value={product.code}>
                        {product.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {fieldError("requestedProductCode") && (
                  <p className="text-xs text-destructive">{fieldError("requestedProductCode")}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="requestedAmount">{t("publicIntake.fields.requestedAmount")}</Label>
                <Input
                  id="requestedAmount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  aria-invalid={Boolean(fieldError("requestedAmount"))}
                  value={form.requestedAmount}
                  onChange={(e) => update("requestedAmount", e.target.value)}
                />
                {fieldError("requestedAmount") && (
                  <p className="text-xs text-destructive">{fieldError("requestedAmount")}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="requestedTermMonths">{t("publicIntake.fields.requestedTermMonths")}</Label>
                <Input
                  id="requestedTermMonths"
                  type="number"
                  min="1"
                  max="360"
                  step="1"
                  required
                  aria-invalid={Boolean(fieldError("requestedTermMonths"))}
                  value={form.requestedTermMonths}
                  onChange={(e) => update("requestedTermMonths", e.target.value)}
                />
                {fieldError("requestedTermMonths") && (
                  <p className="text-xs text-destructive">{fieldError("requestedTermMonths")}</p>
                )}
              </div>
            </CardContent>
          </Card>

          <div className="flex items-start gap-2">
            <Checkbox
              id="consent"
              required
              checked={form.consent}
              onCheckedChange={(checked) => update("consent", checked === true)}
            />
            <Label htmlFor="consent" className="text-sm font-normal text-muted-foreground">
              {t("publicIntake.consent.label")}
            </Label>
          </div>
          {fieldError("consent") && <p className="text-xs text-destructive">{fieldError("consent")}</p>}

          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-between">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="size-4" />
              <span>{t("common.brand.company")}</span>
            </div>
            <Button type="submit" disabled={submitState === "submitting"} className="w-full sm:w-auto">
              {submitState === "submitting" ? t("publicIntake.submitting") : t("publicIntake.submit")}
            </Button>
          </div>
        </form>
      </main>
    </div>
  );
}
