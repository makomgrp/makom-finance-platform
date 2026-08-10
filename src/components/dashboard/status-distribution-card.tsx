import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { APPLICATION_STATUS_ORDER } from "@/lib/config/application";
import type { ApplicationListItem } from "@/types";

interface StatusDistributionCardProps {
  /** Real Applications, fetched once by dashboard/page.tsx and shared with
   * the KPI cards above — this component no longer fetches its own data
   * (Milestone 13D; previously read demo APPLICATIONS directly). */
  applications: ApplicationListItem[];
}

export async function StatusDistributionCard({ applications }: StatusDistributionCardProps) {
  const total = applications.length;
  const t = await getTranslations();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("dashboard.statusDistribution")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {APPLICATION_STATUS_ORDER.map((status) => {
          const count = applications.filter((app) => app.status === status).length;
          const percentage = total === 0 ? 0 : Math.round((count / total) * 100);
          return (
            <div key={status}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="text-foreground">{t(`statuses.applicationStatus.${status}`)}</span>
                <span className="text-muted-foreground">{count}</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${percentage}%` }}
                />
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
