import { getLocale, getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ACTIVITY_TYPE_ICON } from "@/lib/config/activity";
import { getRecentActivities, getUserById } from "@/lib/demo-data";
import { formatRelativeTime } from "@/lib/format";
import type { Locale } from "@/i18n/config";

export async function RecentActivityCard() {
  const activities = getRecentActivities(6);
  const t = await getTranslations();
  const locale = (await getLocale()) as Locale;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("dashboard.recentActivity")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-4">
          {activities.map((activity) => {
            const Icon = ACTIVITY_TYPE_ICON[activity.type];
            const user = activity.userId ? getUserById(activity.userId) : undefined;
            return (
              <li key={activity.id} className="flex items-start gap-3">
                <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                  <Icon className="size-4" strokeWidth={1.75} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm text-foreground">
                    {t(`activityLog.${activity.descriptionKey}`, activity.params)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatRelativeTime(activity.date, locale, t)}
                    {user ? ` · ${user.fullName}` : ""}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}
