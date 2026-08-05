import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LOAN_STATUS_ORDER } from "@/lib/config/loan-status";
import { APPLICATIONS } from "@/lib/demo-data";

export async function StatusDistributionCard() {
  const total = APPLICATIONS.length;
  const t = await getTranslations();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("dashboard.statusDistribution")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {LOAN_STATUS_ORDER.map((status) => {
          const count = APPLICATIONS.filter((app) => app.status === status).length;
          const percentage = total === 0 ? 0 : Math.round((count / total) * 100);
          return (
            <div key={status}>
              <div className="mb-1 flex items-center justify-between text-sm">
                <span className="text-foreground">{t(`statuses.loanApplication.${status}`)}</span>
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
