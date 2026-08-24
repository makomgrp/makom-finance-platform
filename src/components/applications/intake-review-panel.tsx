"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ArrowLeft, ShieldQuestion, UserCheck, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import { formatCurrency, formatDate } from "@/lib/format";
import type { Locale } from "@/i18n/config";
import type { IntakeReviewCaseDetail, IntakeReviewSummary } from "@/lib/services/intake-review";
import {
  resolveIntakeAsExistingClientAction,
  resolveIntakeAsNewClientAction,
} from "@/app/(app)/solicitudes/actions";

/**
 * ============================================================================
 * MILESTONE 26B-19 — THE TRAY FOR APPLICATIONS NOBODY COULD IDENTIFY
 * ============================================================================
 *
 * A third view inside Solicitudes rather than a module of its own. These ARE
 * loan applications — they simply have not been attached to a person yet — and
 * an employee looking for "the form that came in this morning" should find them
 * where every other form lives, not in a settings screen they never open.
 *
 * ----------------------------------------------------------------------------
 * IT PRESENTS A COMPARISON, NOT A VERDICT
 * ----------------------------------------------------------------------------
 * Two columns of the same fields, side by side, so the differences are visible
 * rather than described. No score, no confidence bar, no "87% match" — the
 * engine does not produce one and inventing a number here would lend a
 * machine's authority to a judgement it explicitly declined to make.
 *
 * WHAT IS DELIBERATELY ABSENT: uuids, raw enum values, `review_reason` as
 * stored. The reason is rendered as a sentence an employee can act on; the
 * identifiers stay in the server actions where they belong.
 */

export function IntakeReviewPanel({
  cases,
  details,
  canResolve,
}: {
  cases: IntakeReviewSummary[];
  details: Record<string, IntakeReviewCaseDetail>;
  canResolve: boolean;
}) {
  const t = useTranslations("applications.intakeReview");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [abierto, setAbierto] = useState<string | null>(null);
  const [pendiente, startTransition] = useTransition();

  const etiquetaMotivo = (reason: string) =>
    reason === "low_confidence_client_match"
      ? t("reasonLowConfidence")
      : reason === "conflicting_client_identity"
        ? t("reasonConflicting")
        : t("reasonOther");

  const resolver = (accion: () => Promise<{ status: string; code?: string }>, exito: string) => {
    startTransition(async () => {
      const result = await accion();
      if (result.status === "ok") {
        toast.success(exito);
        setAbierto(null);
        router.refresh();
        return;
      }
      // Named outcomes get a sentence that tells the reviewer what to do
      // instead; anything else is a genuine failure and says so.
      toast.error(
        result.code === "INVALID_CANDIDATE"
          ? t("resolveDuplicate")
          : result.code === "FORBIDDEN" || result.code === "UNAUTHENTICATED"
            ? t("resolveForbidden")
            : t("resolveError")
      );
    });
  };

  if (cases.length === 0) {
    return (
      <EmptyState icon={ShieldQuestion} title={t("empty")} description={t("emptyDescription")} />
    );
  }

  const detalle = abierto ? details[abierto] : undefined;

  if (detalle) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <Button variant="ghost" size="sm" onClick={() => setAbierto(null)}>
            <ArrowLeft className="size-4" />
            {t("back")}
          </Button>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground">{t("title")}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("subtitle")}</p>
          <p className="mt-3 inline-flex rounded-full bg-warning/15 px-3 py-1 text-xs font-semibold text-warning">
            {etiquetaMotivo(detalle.reason)}
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Bloque titulo={t("receivedTitle")}>
            <Campo etiqueta={t("fieldName")} valor={detalle.applicantFullName} />
            <Campo
              etiqueta={t("fieldIdentification")}
              valor={detalle.applicantIdentificationNumber}
            />
            <Campo etiqueta={t("fieldEmail")} valor={detalle.applicantEmail} />
            <Campo etiqueta={t("fieldPhone")} valor={detalle.applicantPhone} />
            <Campo
              etiqueta={t("fieldBirthDate")}
              valor={
                detalle.applicantBirthDate
                  ? formatDate(detalle.applicantBirthDate, locale)
                  : undefined
              }
            />
            <Campo
              etiqueta={t("fieldReceivedAt")}
              valor={formatDate(detalle.receivedAt, locale)}
            />
          </Bloque>

          {detalle.candidates.length === 0 ? (
            <Bloque titulo={t("candidateTitle")}>
              <p className="text-sm text-muted-foreground">{t("noCandidates")}</p>
            </Bloque>
          ) : (
            detalle.candidates.map((c) => (
              <Bloque key={c.clientId} titulo={t("candidateTitle")}>
                <Campo etiqueta={t("fieldName")} valor={c.fullName} />
                <Campo etiqueta={t("fieldIdentification")} valor={c.identificationNumber} />
                <Campo etiqueta={t("fieldEmail")} valor={c.email} />
                <Campo etiqueta={t("fieldPhone")} valor={c.phone} />
                <Campo
                  etiqueta={t("fieldBirthDate")}
                  valor={c.birthDate ? formatDate(c.birthDate, locale) : undefined}
                />
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {c.matchedOn.map((señal) => (
                    <span
                      key={señal}
                      className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground"
                    >
                      {señal === "email" ? t("matchedOnEmail") : t("matchedOnPhone")}
                    </span>
                  ))}
                </div>
                {canResolve && (
                  <Button
                    className="mt-3 w-full"
                    disabled={pendiente}
                    onClick={() =>
                      resolver(
                        () =>
                          resolveIntakeAsExistingClientAction({
                            intakeId: detalle.intakeId,
                            clientId: c.clientId,
                          }),
                        t("resolvedExisting")
                      )
                    }
                  >
                    <UserCheck className="size-4" />
                    {t("linkExisting")}
                  </Button>
                )}
              </Bloque>
            ))
          )}
        </div>

        {canResolve && (
          <div>
            <Button
              variant="outline"
              disabled={pendiente}
              onClick={() =>
                resolver(
                  () => resolveIntakeAsNewClientAction({ intakeId: detalle.intakeId }),
                  t("resolvedNew")
                )
              }
            >
              <UserPlus className="size-4" />
              {t("createNew")}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {cases.map((c) => (
        <div
          key={c.intakeId}
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {c.applicantFullName ?? "—"}
            </p>
            <p className="truncate text-sm text-muted-foreground">
              {[c.applicantEmail, c.applicantPhone].filter(Boolean).join(" · ") || "—"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatDate(c.receivedAt, locale)}
              {c.requestedAmount ? ` · ${formatCurrency(c.requestedAmount)}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="rounded-full bg-warning/15 px-3 py-1 text-xs font-semibold text-warning">
              {etiquetaMotivo(c.reason)}
            </span>
            <Button variant="secondary" size="sm" onClick={() => setAbierto(c.intakeId)}>
              {t("open")}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-xl border border-border bg-card p-5">
      <h3 className="text-sm font-semibold text-foreground">{titulo}</h3>
      {children}
    </section>
  );
}

/** An absent value is shown as absent — a blank row would read as "same". */
function Campo({ etiqueta, valor }: { etiqueta: string; valor?: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{etiqueta}</span>
      <span className="text-right font-medium break-all text-foreground">{valor ?? "—"}</span>
    </div>
  );
}
