"use client";

import { useLocale, useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { History } from "lucide-react";
import { ACTIVITY_TYPE_ICON } from "@/lib/config/activity";
import { getUserById } from "@/lib/demo-data";
import { formatDateTime } from "@/lib/format";
import type { Locale } from "@/i18n/config";
import type { ActivityEvent } from "@/types";

interface ActivityTabProps {
  activities: ActivityEvent[];
}

export function ActivityTab({ activities }: ActivityTabProps) {
  const locale = useLocale() as Locale;
  const t = useTranslations();

  if (activities.length === 0) {
    return (
      <Card>
        <CardContent>
          <EmptyState
            icon={History}
            title={t("dossier.activity.emptyTitle")}
            description={t("dossier.activity.emptyDescription")}
          />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <ol className="relative space-y-6 border-l border-border pl-6">
          {activities.map((activity) => {
            const Icon = ACTIVITY_TYPE_ICON[activity.type];
            const user = activity.userId ? getUserById(activity.userId) : undefined;

            return (
              <li key={activity.id} className="relative">
                <span className="absolute -left-[31px] flex size-6 items-center justify-center rounded-full border border-border bg-card">
                  <Icon className="size-3.5 text-primary" strokeWidth={1.75} />
                </span>
                <p className="text-sm text-foreground">
                  {t(`activityLog.${activity.descriptionKey}`, activity.params)}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatDateTime(activity.date, locale)}
                  {user ? ` · ${user.fullName}` : ""}
                </p>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
