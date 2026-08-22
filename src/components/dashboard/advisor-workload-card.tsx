import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ACTIVE_PIPELINE_STAGES } from "@/lib/config/pipeline";
import { getInitials } from "@/lib/format";
import type { AdvisorWorkloadRow } from "@/lib/services/dashboard-operations";

interface AdvisorWorkloadCardProps {
  rows: AdvisorWorkloadRow[];
  /** Rendered when the viewer sees only their own row, so the heading does not
   * claim to be the whole team. */
  selfOnly?: boolean;
}

/**
 * ============================================================================
 * MILESTONE 26B-7 — WHO IS CARRYING WHAT
 * ============================================================================
 *
 * Open processes per advisor, broken down by stage.
 *
 * A ZERO IS THE MOST USEFUL ROW ON THIS CARD. An advisor with nothing is
 * either available or being skipped by the rotation, and both are things a
 * manager acts on — so every eligible advisor is listed whether or not they
 * appear in the pipeline. That is also why this cannot be built from the cards
 * alone.
 *
 * SORTED BUSIEST FIRST, because the question this answers is "who is
 * overloaded"; ties fall back to name so the order is stable between loads.
 *
 * NOT A TABLE. At 390px a six-column table either scrolls sideways or shrinks
 * the type; a stacked row with inline stage chips reflows instead, and the
 * chips carry their own labels so nothing depends on remembering a column
 * header that has scrolled away.
 */
export async function AdvisorWorkloadCard({ rows, selfOnly }: AdvisorWorkloadCardProps) {
  const t = await getTranslations();

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {selfOnly ? t("dashboard.workload.titleSelf") : t("dashboard.workload.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("dashboard.workload.empty")}</p>
        ) : (
          rows.map((row) => (
            <div
              key={row.profileId}
              className="flex flex-col gap-2 border-b border-border/60 pb-3 last:border-0 last:pb-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground"
                >
                  {getInitials(row.fullName)}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{row.fullName}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {t("dashboard.workload.activeCount", { count: row.activeTotal })}
                  </p>
                </div>
              </div>

              {/* Only the stages this advisor actually holds. Printing four
                  chips of which three read zero turns a glance into arithmetic. */}
              <div className="flex flex-wrap gap-1.5 sm:justify-end">
                {ACTIVE_PIPELINE_STAGES.filter((stage) => row.byStage[stage] > 0).map((stage) => (
                  <span
                    key={stage}
                    className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
                  >
                    {t(`pipeline.stages.${stage}`)}
                    <span className="ml-1 font-medium text-foreground tabular-nums">
                      {row.byStage[stage]}
                    </span>
                  </span>
                ))}
                {row.activeTotal === 0 && (
                  <span className="text-[11px] text-muted-foreground">
                    {t("dashboard.workload.noActive")}
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}
