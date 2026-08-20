"use client";

import { useLocale, useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LocalizedText } from "@/types";

/**
 * ============================================================================
 * CHOOSING A LOAN (26B-1)
 * ============================================================================
 *
 * WHY NOT A `<select>`: this is the single most consequential choice in the
 * whole flow, and four options is few enough to show all at once. A native
 * dropdown hides three of the four behind a tap, gives no room to explain what
 * each one means, and is a small target for an older adult on a phone. Cards
 * make the choice legible and comfortable to hit.
 *
 * NATIVE RADIO INPUTS UNDERNEATH. Each card is a real `<input type="radio">`
 * inside a `<label>`, inside a `<fieldset>` with a `<legend>`. That buys arrow-
 * key navigation, roving focus, the correct screen-reader group semantics and
 * form submission for free — all things a `div` with `onClick` would have to
 * reimplement badly. The input is visually hidden with `sr-only`, never with
 * `display:none` or a zero-size box, both of which break the very keyboard
 * behaviour the native element was chosen for.
 *
 * SELECTION IS NOT SIGNALLED BY COLOUR ALONE. A selected card gets a ring, a
 * heavier border, a tinted surface AND a filled check mark. Someone who cannot
 * distinguish the tint still sees the check.
 *
 * THE CATALOG IS NOT DEFINED HERE, AND NEITHER IS THE COPY. Both the name and
 * the one-line explanation come from the official Product record — ODL's own
 * `short_description`, already maintained in Spanish and English. Nothing in
 * this component describes a loan.
 *
 * That was a deliberate correction during 26B-1: the first draft carried its
 * own per-code descriptions in the translation file, which would have been a
 * second product catalog quietly competing with the real one. A product ODL
 * edits, renames or adds now flows straight through, and a product with no
 * description simply renders without one rather than being given invented copy.
 */

export interface PortalProductOption {
  id: string;
  /** The public N/D/V/E identifier — what the radio value and URLs carry. */
  applicationCode: string;
  name: LocalizedText;
  shortDescription?: LocalizedText;
}

interface ProductChoiceGroupProps {
  products: PortalProductOption[];
  value: string;
  onChange: (code: string) => void;
  errorMessage?: string;
  errorId?: string;
}

export function ProductChoiceGroup({
  products,
  value,
  onChange,
  errorMessage,
  errorId,
}: ProductChoiceGroupProps) {
  const t = useTranslations("portal.step1");
  const locale = useLocale() as keyof LocalizedText;

  return (
    <fieldset
      className="min-w-0"
      aria-describedby={errorMessage && errorId ? errorId : undefined}
      aria-invalid={errorMessage ? true : undefined}
    >
      <legend className="text-base font-semibold text-foreground">{t("productLegend")}</legend>
      <p className="mt-1 mb-3 text-sm text-muted-foreground">{t("productHelp")}</p>

      <div className="grid gap-2.5">
        {products.map((product) => {
          const isSelected = value === product.applicationCode;
          const description =
            product.shortDescription?.[locale] ?? product.shortDescription?.es;

          return (
            <label
              key={product.id}
              className={cn(
                "group relative flex cursor-pointer items-start gap-3 rounded-xl border bg-card p-4 transition-all",
                // The whole card reacts to keyboard focus on the hidden input,
                // so a keyboard user sees exactly what a mouse user hovers.
                "has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/40",
                isSelected
                  ? "border-primary bg-primary/[0.04] shadow-sm ring-1 ring-primary/20"
                  : "border-border hover:border-primary/40 hover:bg-muted/40"
              )}
            >
              <input
                type="radio"
                name="productCode"
                value={product.applicationCode}
                checked={isSelected}
                onChange={() => onChange(product.applicationCode)}
                // `sr-only` rather than a zero-sized `size-0 opacity-0` box:
                // it is the established accessible-hiding pattern, keeps a real
                // (1px, clipped) layout box, and avoids relying on browser
                // behaviour for zero-area focusable controls — which is
                // under-specified and has historically been inconsistent.
                className="peer sr-only"
              />

              <span
                aria-hidden="true"
                className={cn(
                  "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                  isSelected ? "border-primary bg-primary" : "border-input bg-card"
                )}
              >
                {isSelected && <Check className="size-3 text-primary-foreground" strokeWidth={3} />}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-foreground sm:text-[0.9375rem]">
                  {product.name[locale] ?? product.name.es}
                </span>
                {description && (
                  <span className="mt-1 block text-sm leading-relaxed text-muted-foreground">
                    {description}
                  </span>
                )}
              </span>

              {isSelected && <span className="sr-only">{t("productSelected")}</span>}
            </label>
          );
        })}
      </div>

      {errorMessage && (
        <p id={errorId} role="alert" className="mt-2 text-sm font-medium text-destructive">
          {errorMessage}
        </p>
      )}
    </fieldset>
  );
}
