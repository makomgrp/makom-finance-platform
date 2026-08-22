import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ACTIVE_PIPELINE_STAGES } from "@/lib/config/pipeline";
import type { PipelineStage } from "@/types";

interface PipelineOverviewCardProps {
  stageCounts: Record<PipelineStage, number>;
}

/**
 * ============================================================================
 * MILESTONE 26B-7 — WHERE THE WORK IS
 * ============================================================================
 *
 * The four open stages as a compact strip, in board order, with the same
 * derived counts /solicitudes renders.
 *
 * ONLY THE OPEN STAGES. Approved, cancelled and discarded are deliberately
 * absent: this answers "what is in flight this morning", and three terminal
 * columns that only ever grow would push the live numbers off the useful part
 * of the card. The formal outcome breakdown already exists directly below, in
 * StatusDistributionCard.
 *
 * NO CHART LIBRARY. A funnel here is four numbers and a proportion bar; the
 * bar is a div whose width is a percentage of the largest stage, which is the
 * same primitive StatusDistributionCard has used since Milestone 13.
 *
 * THE LINKS GO WHERE A FILTER ACTUALLY EXISTS. /solicitudes is a real route
 * and lands on the board these numbers come from. It does NOT carry a stage
 * query parameter, because the board's stage/advisor filters are component
 * state with no URL representation — inventing `?stage=paso_2` here would
 * produce a link that silently does nothing, which is worse than a link that
 * honestly goes to the board.
 */
export async function PipelineOverviewCard({ stageCounts }: PipelineOverviewCardProps) {
  const t = await getTranslations();
  const stages = ACTIVE_PIPELINE_STAGES;
  const peak = Math.max(...stages.map((stage) => stageCounts[stage]), 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("dashboard.pipeline.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {stages.map((stage) => {
          const count = stageCounts[stage];
          // Proportional to the BUSIEST stage, not to the total. A funnel read
          // as a share of everything flattens into four near-identical stubs
          // the moment one stage dominates, which is exactly when the shape
          // matters most.
          const width = peak === 0 ? 0 : Math.round((count / peak) * 100);
          return (
            <Link
              key={stage}
              href="/solicitudes"
              className="block rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="text-foreground">{t(`pipeline.stages.${stage}`)}</span>
                <span className="font-semibold text-foreground tabular-nums">{count}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
              </div>
            </Link>
          );
        })}

        {peak === 0 && (
          <p className="pt-1 text-sm text-muted-foreground">{t("dashboard.pipeline.empty")}</p>
        )}
      </CardContent>
    </Card>
  );
}
