import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * ============================================================================
 * WHERE THE CUSTOMER IS (26B-1)
 * ============================================================================
 *
 * The approved four-part flow: Tus datos → Información → Documentos → Revisar
 * y enviar.
 *
 * NO PERCENTAGE IS SHOWN, and that is deliberate rather than an omission.
 * 26A-4 derives progress from real completion state precisely so nothing has to
 * invent a number; printing "25%" here would be a fourth opinion about
 * something the server already answers honestly. "Paso 1 de 4" is a fact.
 *
 * FUTURE STEPS ARE NOT LINKS. They render as plain text with
 * `aria-disabled`, because a step whose UI does not exist must not look
 * clickable — a customer tapping "Documentos" and landing nowhere learns not to
 * trust the rest of the flow.
 *
 * TWO LAYOUTS, ONE SOURCE OF TRUTH. Desktop gets the labelled rail; mobile gets
 * a counter and a bar, because four labels at 375px would either wrap into a
 * mess or shrink into unreadable type. Both are driven by the same `steps`
 * array, so they cannot disagree.
 */

interface PortalProgressProps {
  /** 1-based. Only step 1 is reachable in 26B-1. */
  currentStep: number;
}

export function PortalProgress({ currentStep }: PortalProgressProps) {
  const t = useTranslations("portal.progress");
  const steps = [t("step1"), t("step2"), t("step3"), t("review")];
  const total = steps.length;

  return (
    <nav aria-label={t("label")} className="w-full">
      {/* ---- Mobile: counter + bar ------------------------------------- */}
      <div className="sm:hidden">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold text-foreground">{steps[currentStep - 1]}</p>
          <p className="shrink-0 text-xs font-medium text-muted-foreground">
            {t("stepOf", { current: currentStep, total })}
          </p>
        </div>
        <div
          className="h-1.5 w-full overflow-hidden rounded-full bg-border"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={total}
          aria-valuenow={currentStep}
          aria-valuetext={t("stepOf", { current: currentStep, total })}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500"
            style={{ width: `${(currentStep / total) * 100}%` }}
          />
        </div>
      </div>

      {/* ---- Desktop / tablet: labelled rail ---------------------------- */}
      <ol className="hidden items-center gap-2 sm:flex">
        {steps.map((label, index) => {
          const stepNumber = index + 1;
          const isComplete = stepNumber < currentStep;
          const isCurrent = stepNumber === currentStep;
          const isUpcoming = stepNumber > currentStep;

          return (
            <li key={label} className="flex flex-1 items-center gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                    isComplete && "bg-primary text-primary-foreground",
                    isCurrent && "bg-primary text-primary-foreground ring-4 ring-primary/15",
                    isUpcoming && "border border-border bg-background text-muted-foreground"
                  )}
                >
                  {isComplete ? <Check className="size-3.5" /> : stepNumber}
                </span>
                <span
                  aria-current={isCurrent ? "step" : undefined}
                  aria-disabled={isUpcoming || undefined}
                  className={cn(
                    "truncate text-sm transition-colors",
                    isCurrent ? "font-semibold text-foreground" : "font-medium text-muted-foreground"
                  )}
                >
                  {label}
                  {/* Named for screen readers; the visual cue is the ring/fill,
                      which is never the ONLY signal. */}
                  <span className="sr-only">
                    {isCurrent ? ` — ${t("statusCurrent")}` : isUpcoming ? ` — ${t("statusUpcoming")}` : ""}
                  </span>
                </span>
              </div>
              {stepNumber < total && (
                <span
                  aria-hidden="true"
                  className={cn(
                    "h-px min-w-4 flex-1 rounded-full",
                    isComplete ? "bg-primary/40" : "bg-border"
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
