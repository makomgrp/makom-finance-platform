"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PortalProgress } from "@/components/portal/portal-progress";
import {
  ProductChoiceGroup,
  type PortalProductOption,
} from "@/components/portal/product-choice-group";
import { submitPortalStepOne } from "./actions";
import type { PortalStepOneField, PortalStepOneFieldErrorCode } from "@/lib/validation/portal-step-one";

/**
 * ============================================================================
 * STEP 1 (26B-1)
 * ============================================================================
 *
 * Two jobs and no more: confirm who the customer is, and find out which loan
 * they want. Employment, banking, obligations, guarantors, collateral and
 * business details are Step 2's — deliberately absent here, because the whole
 * point of splitting the flow is that the first screen must not look like a
 * bank questionnaire.
 *
 * PREFILL IS A DRAFT, NOT A VERDICT. Every prefilled value is an ordinary
 * editable input. Data that arrived from the ODL website is the customer's own,
 * and locking it would strand anyone whose name was mistyped upstream.
 *
 * VALIDATION IS SERVER-AUTHORITATIVE. `noValidate` turns off the browser's
 * bubbles so errors render inline, associated with their field, in the
 * customer's language. The server validator is the one that decides; this
 * component only displays what it says. Errors clear as the customer types, so
 * a corrected field stops shouting immediately.
 *
 * THE DOUBLE-CLICK GUARD. `submissionId` is minted ONCE per mounted form and
 * reused by every attempt, including retries after a network failure. Combined
 * with `unique(channel, submission_id)` on the intake table, a second click
 * resolves to the row the first one created instead of opening a second
 * application. The button is also disabled while pending, but that is the
 * courtesy — the id is the actual guarantee.
 */

export interface StepOneInitialValues {
  fullName: string;
  phone: string;
  email: string;
  identificationType: "cedula" | "pasaporte";
  identificationNumber: string;
  productCode: string;
  requestedAmount: string;
}

interface StepOneFormProps {
  products: PortalProductOption[];
  initialValues: StepOneInitialValues;
  /**
   * Set when resuming through a continuation link. Sent back to the server,
   * which resolves it to the intake — the browser never names a row to write.
   * No added exposure: it is already in this page's address bar.
   */
  continuationToken?: string;
  /** True when anything arrived prefilled, so the customer is told why. */
  hasPrefill: boolean;
}

type FieldErrors = Partial<Record<PortalStepOneField, PortalStepOneFieldErrorCode>>;

export function StepOneForm({
  products,
  initialValues,
  continuationToken,
  hasPrefill,
}: StepOneFormProps) {
  const t = useTranslations("portal.step1");
  const tErrors = useTranslations("portal.errors");
  const router = useRouter();

  const [values, setValues] = useState<StepOneInitialValues>(initialValues);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [honeypot, setHoneypot] = useState("");

  // Minted once for the lifetime of this form instance. See the header note.
  const submissionIdRef = useRef<string>(crypto.randomUUID());
  // Set just before errors are shown, consumed by the summary's callback ref
  // below. A plain ref + requestAnimationFrame did NOT work here: rAF is
  // scheduled before React commits the re-render, so the summary element does
  // not exist yet and focus silently stayed on <body>. A callback ref fires at
  // mount, which is exactly the moment the element becomes focusable.
  const shouldFocusErrorsRef = useRef(false);
  const baseId = useId();

  const set = <K extends keyof StepOneInitialValues>(field: K, value: StepOneInitialValues[K]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    setFieldErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field as PortalStepOneField];
      return next;
    });
  };

  const errorFor = (field: PortalStepOneField): string | undefined => {
    const code = fieldErrors[field];
    return code ? tErrors(code) : undefined;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isPending) return;

    setIsPending(true);
    setFormError(null);

    try {
      const result = await submitPortalStepOne({
        fullName: values.fullName,
        phone: values.phone,
        email: values.email,
        identificationType: values.identificationType,
        identificationNumber: values.identificationNumber,
        productCode: values.productCode,
        requestedAmount: values.requestedAmount,
        submissionId: submissionIdRef.current,
        continuationToken,
        website: honeypot,
      });

      if (result.status === "invalid") {
        // Move attention to the summary so a screen-reader user and a customer
        // who scrolled past the first bad field both learn something failed.
        shouldFocusErrorsRef.current = true;
        setFieldErrors(result.fieldErrors);
        setIsPending(false);
        return;
      }

      if (result.status === "error") {
        shouldFocusErrorsRef.current = true;
        setFormError(tErrors(result.code));
        setIsPending(false);
        return;
      }

      // Deliberately stays pending across the navigation: re-enabling the
      // button while the next screen is still loading invites a second click
      // on work that already succeeded.
      router.push(`/solicitud/paso-2?estado=${result.outcome}`);
    } catch {
      shouldFocusErrorsRef.current = true;
      setFormError(tErrors("SAVE_FAILED"));
      setIsPending(false);
    }
  };

  const hasErrors = Object.keys(fieldErrors).length > 0 || formError !== null;

  return (
    <div className="flex flex-col gap-7 sm:gap-8">
      <PortalProgress currentStep={1} />

      <header className="flex flex-col gap-1.5">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[1.75rem]">
          {t("title")}
        </h1>
        {/* One short line. A longer welcome paragraph is the fastest way to make
            a two-minute form feel like a commitment. */}
        <p className="text-[0.9375rem] leading-relaxed text-muted-foreground">{t("subtitle")}</p>
      </header>

      {hasPrefill && (
        <div className="rounded-xl border border-primary/20 bg-primary/[0.04] p-4">
          <p className="text-sm font-semibold text-foreground">{t("prefilledTitle")}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("prefilledBody")}</p>
        </div>
      )}

      {/* Mounted only when there is something to say. An always-present empty
          wrapper still consumed a flex gap, leaving a visible hole between the
          subtitle and the first fieldset. */}
      {hasErrors && (
        <div
          ref={(node) => {
            if (node && shouldFocusErrorsRef.current) {
              shouldFocusErrorsRef.current = false;
              node.focus();
            }
          }}
          tabIndex={-1}
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/[0.06] p-4 outline-none"
        >
          <p className="text-sm font-medium text-destructive">
            {formError ?? t("errorSummary")}
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-7 sm:gap-8">
        {/* ---- Identity ------------------------------------------------- */}
        <fieldset className="flex min-w-0 flex-col gap-4">
          {/* `legend` sits outside the flex flow, so the fieldset's gap does
              not apply under it — the spacing has to be explicit. */}
          <legend className="mb-1 text-base font-semibold text-foreground">
            {t("identityLegend")}
          </legend>

          <PortalField
            id={`${baseId}-fullName`}
            label={t("fullName")}
            error={errorFor("fullName")}
            required
          >
            {(props) => (
              <Input
                {...props}
                value={values.fullName}
                onChange={(e) => set("fullName", e.target.value)}
                autoComplete="name"
                autoCapitalize="words"
                className="h-11"
              />
            )}
          </PortalField>

          <div className="grid gap-4 sm:grid-cols-2">
            <PortalField
              id={`${baseId}-email`}
              label={t("email")}
              hint={t("emailHint")}
              error={errorFor("email")}
              required
            >
              {(props) => (
                <Input
                  {...props}
                  type="email"
                  inputMode="email"
                  value={values.email}
                  onChange={(e) => set("email", e.target.value)}
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  className="h-11"
                />
              )}
            </PortalField>

            <PortalField
              id={`${baseId}-phone`}
              label={t("phone")}
              hint={t("phoneHint")}
              error={errorFor("phone")}
              required
            >
              {(props) => (
                <Input
                  {...props}
                  // `tel` opens the phone keypad rather than a full keyboard.
                  type="tel"
                  inputMode="tel"
                  value={values.phone}
                  onChange={(e) => set("phone", e.target.value)}
                  autoComplete="tel"
                  className="h-11"
                />
              )}
            </PortalField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <PortalField
              id={`${baseId}-identificationType`}
              label={t("identificationType")}
              error={errorFor("identificationType")}
              required
            >
              {(props) => (
                // A native <select> IS right here: two mutually exclusive
                // values with no explanation needed, and the platform picker is
                // the most familiar control on every phone.
                <select
                  {...props}
                  value={values.identificationType}
                  onChange={(e) =>
                    set("identificationType", e.target.value as "cedula" | "pasaporte")
                  }
                  className="h-11 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40 aria-invalid:border-destructive"
                >
                  <option value="cedula">{t("cedula")}</option>
                  <option value="pasaporte">{t("pasaporte")}</option>
                </select>
              )}
            </PortalField>

            <PortalField
              id={`${baseId}-identificationNumber`}
              label={t("identificationNumber")}
              error={errorFor("identificationNumber")}
              required
            >
              {(props) => (
                <Input
                  {...props}
                  value={values.identificationNumber}
                  onChange={(e) => set("identificationNumber", e.target.value)}
                  autoCapitalize="characters"
                  spellCheck={false}
                  className="h-11"
                />
              )}
            </PortalField>
          </div>
          <PortalField
            id={`${baseId}-requestedAmount`}
            label={t("requestedAmount")}
            hint={t("requestedAmountHint")}
            error={errorFor("requestedAmount")}
            required
          >
            {(props) => (
              <div className="relative">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted-foreground"
                >
                  $
                </span>
                <Input
                  {...props}
                  // `decimal` not `numeric`: amounts can carry cents.
                  inputMode="decimal"
                  value={values.requestedAmount}
                  onChange={(e) => set("requestedAmount", e.target.value)}
                  className="h-11 pl-7"
                />
              </div>
            )}
          </PortalField>
        </fieldset>

        {/* A real rule, not just whitespace: Step 1 asks two different kinds of
            question — who you are, and what you want — and the separation is
            what stops the screen reading as one long undifferentiated list. */}
        <hr className="border-border" />

        {/* ---- Product -------------------------------------------------- */}
        <ProductChoiceGroup
          products={products}
          value={values.productCode}
          onChange={(code) => set("productCode", code)}
          errorMessage={errorFor("productCode")}
          errorId={`${baseId}-productCode-error`}
        />

        {/* Honeypot. Off-screen rather than display:none, which some bots
            detect; hidden from assistive tech and skipped by tab order, so no
            real customer can reach it. Preserved from the 15C endpoint. */}
        <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
          <label htmlFor={`${baseId}-website`}>Website</label>
          <input
            id={`${baseId}-website`}
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={honeypot}
            onChange={(e) => setHoneypot(e.target.value)}
          />
        </div>

        <Button
          type="submit"
          disabled={isPending}
          // Full width on mobile so the CTA sits under the thumb; auto width on
          // desktop so it does not stretch into a banner. h-12 clears the 44px
          // touch-target floor on both.
          className="h-12 w-full px-8 text-[0.9375rem] font-semibold sm:w-auto sm:self-start"
        >
          {isPending && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
          {isPending ? t("continueSaving") : t("continue")}
        </Button>
      </form>
    </div>
  );
}

/**
 * One labelled field.
 *
 * Exists so that label association, hint association, error association and
 * `aria-invalid` are wired the SAME way for every input — the parts that are
 * easy to get subtly wrong when hand-written nine times. The render-prop hands
 * back the ids the control must carry, so a field cannot be added without them.
 *
 * There is no placeholder-as-label anywhere: placeholders vanish on focus,
 * which is precisely when someone re-reading the form needs the label most.
 */
function PortalField({
  id,
  label,
  hint,
  error,
  required,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: (props: {
    id: string;
    "aria-describedby"?: string;
    "aria-invalid"?: true;
    "aria-required"?: true;
  }) => React.ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </Label>
      {children({
        id,
        "aria-describedby": describedBy,
        "aria-invalid": error ? true : undefined,
        "aria-required": required ? true : undefined,
      })}
      {error && (
        <p id={errorId} className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      {hint && !error && (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}
