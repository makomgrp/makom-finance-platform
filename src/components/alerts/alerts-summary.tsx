import { getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { ALERT_LEVEL_VALUES } from "@/lib/config/alert";
import { ALERTS } from "@/lib/demo-data";

export async function AlertsSummary() {
  const active = ALERTS.filter((alert) => alert.active).length;
  const resolved = ALERTS.filter((alert) => !alert.active).length;
  const t = await getTranslations();

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      <Card>
        <CardContent>
          <p className="text-xs text-muted-foreground">{t("alertsModule.activeAlerts")}</p>
          <p className="mt-1 text-xl font-semibold text-warning">{active}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <p className="text-xs text-muted-foreground">{t("alertsModule.resolvedAlerts")}</p>
          <p className="mt-1 text-xl font-semibold text-success">{resolved}</p>
        </CardContent>
      </Card>
      {ALERT_LEVEL_VALUES.map((level) => {
        const count = ALERTS.filter((alert) => alert.level === level).length;
        return (
          <Card key={level}>
            <CardContent>
              <p className="text-xs text-muted-foreground">
                {t("alertsModule.levelLabel", { level: t(`statuses.alertLevel.${level}`) })}
              </p>
              <p className="mt-1 text-xl font-semibold text-foreground">{count}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
