import { getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { ALERT_LEVEL_VALUES } from "@/lib/config/alert";
import type { DossierAlert } from "@/types";

interface AlertsSummaryProps {
  alerts: DossierAlert[];
  /** True when the parent page's getAllAlerts() call failed. Counts show
   * "—" instead of a number in that case — never a fabricated 0, which
   * would misleadingly read as "no alerts" instead of "unknown". */
  loadError: boolean;
}

export async function AlertsSummary({ alerts, loadError }: AlertsSummaryProps) {
  const active = alerts.filter((alert) => alert.active).length;
  const resolved = alerts.filter((alert) => !alert.active).length;
  const t = await getTranslations();

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Card>
        <CardContent>
          <p className="text-xs text-muted-foreground">{t("alertsModule.activeAlerts")}</p>
          <p className="mt-1 text-xl font-semibold text-warning">{loadError ? "—" : active}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <p className="text-xs text-muted-foreground">{t("alertsModule.resolvedAlerts")}</p>
          <p className="mt-1 text-xl font-semibold text-success">{loadError ? "—" : resolved}</p>
        </CardContent>
      </Card>
      {ALERT_LEVEL_VALUES.map((level) => {
        const count = alerts.filter((alert) => alert.level === level).length;
        return (
          <Card key={level}>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                {t("alertsModule.levelLabel", { level: t(`statuses.alertLevel.${level}`) })}
              </p>
              <p className="mt-1 text-xl font-semibold text-foreground">{loadError ? "—" : count}</p>
            </CardContent>
          </Card>
        );
      })}
      {loadError && (
        <p className="col-span-2 text-xs text-destructive sm:col-span-3 lg:col-span-6">
          {t("alertsModule.summaryLoadError")}
        </p>
      )}
    </div>
  );
}
