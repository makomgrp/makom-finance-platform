"use client";

import { useLocale, useTranslations } from "next-intl";
import { History } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { ACTIVITY_CODE_NAMESPACE, ACTIVITY_TYPE_ICON } from "@/lib/config/activity";
import { formatDateTime } from "@/lib/format";
import type { Locale } from "@/i18n/config";
import type { ActivityFeedItem } from "@/types";

/**
 * The Dossier's Activity tab (restored in Milestone 19).
 *
 * PRESENTATIONAL ONLY — and that is the point. The tab Milestone 18 removed
 * seeded itself from demo fixtures and appended new "events" to React state
 * that disappeared on reload, so it both invented the past and lied about
 * the present. This component owns no state, performs no fetch, calls no
 * Server Action and logs nothing. It renders exactly the array it is given,
 * which src/app/(app)/expedientes/[id]/page.tsx builds server-side from
 * persisted rows via buildClientActivityFeed().
 *
 * Every string is parameterised from real values; there is no return of the
 * old `activityLog.actNNN` fixture-translation architecture.
 */

interface ActivityTabProps {
  /** Already ordered (newest first) and fully resolved by the builder. */
  activities: ActivityFeedItem[];
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
            const namespace = ACTIVITY_CODE_NAMESPACE[activity.type];

            // Raw canonical codes are resolved through the app's EXISTING
            // status catalogues, never re-translated here.
            const status =
              namespace && activity.code ? t(`${namespace}.${activity.code}`) : "";

            return (
              <li key={activity.id} className="relative">
                <span className="absolute -left-[31px] flex size-6 items-center justify-center rounded-full border border-border bg-card">
                  <Icon className="size-3.5 text-primary" strokeWidth={1.75} />
                </span>
                <p className="text-sm text-foreground">
                  {t(`dossier.activity.events.${activity.type}`, {
                    number: activity.applicationNumber ?? "",
                    label: activity.label ?? "",
                    status,
                  })}
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatDateTime(activity.at, locale)}
                  {/* Omitted entirely when the database recorded no actor —
                      never "Unknown"/"Desconocido", never inferred. */}
                  {activity.actorFullName ? ` · ${activity.actorFullName}` : ""}
                </p>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
