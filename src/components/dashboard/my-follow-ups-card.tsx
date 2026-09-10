import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { CalendarClock, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/config";
import type { MyFollowUpItem } from "@/lib/services/dashboard-operations";

interface MyFollowUpsCardProps {
  items: MyFollowUpItem[];
}

/**
 * ============================================================================
 * MILESTONE 2.2 — A PERSISTENT PLACE, NOT JUST A TOAST
 * ============================================================================
 *
 * The automated reminder cron (see follow-up-reminders.ts) pushes a one-time
 * toast when a commitment becomes due — but a toast is transient, and an
 * advisor who was away from the screen the moment it fired would simply never
 * see it. This card answers the same question on demand, every time the
 * dashboard loads, independent of whether any reminder ever fired: "what have
 * I promised, and what of it is late".
 *
 * SAME URGENCY LANGUAGE AS THE PIPELINE BOARD. Colour + written word, never
 * colour alone, matching pipeline-kanban.tsx's own next-action chip exactly —
 * a second visual vocabulary for the same fact would be its own kind of bug.
 *
 * SELF ONLY. This card only ever renders for the viewer's own queue (see
 * dashboard/page.tsx — same gate as AdvisorWorkloadCard's selfOnly split). A
 * team-wide version is a different, larger question this milestone does not
 * answer.
 */
export async function MyFollowUpsCard({ items }: MyFollowUpsCardProps) {
  const t = await getTranslations();
  const locale = (await getLocale()) as Locale;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("dashboard.myFollowUps.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
            {t("dashboard.myFollowUps.empty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {items.map((item) => (
              <li key={item.applicationId}>
                <Link
                  href={`/solicitudes/${item.applicationId}`}
                  className={cn(
                    "flex items-start gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-muted/60",
                    item.nextActionUrgency === "overdue"
                      ? "bg-warning/10"
                      : item.nextActionUrgency === "today"
                        ? "bg-navy/10"
                        : "bg-muted/40"
                  )}
                >
                  <CalendarClock
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      item.nextActionUrgency === "overdue"
                        ? "text-warning"
                        : item.nextActionUrgency === "today"
                          ? "text-navy"
                          : "text-muted-foreground"
                    )}
                    aria-hidden="true"
                    strokeWidth={1.75}
                  />
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">
                      {item.clientFullName}
                      {item.applicationNumber && (
                        <span className="ml-1.5 font-normal text-muted-foreground">
                          {item.applicationNumber}
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      <span className="font-medium">
                        {item.nextActionUrgency === "overdue"
                          ? t("followUp.overdue")
                          : item.nextActionUrgency === "today"
                            ? t("followUp.today")
                            : formatDateTime(item.nextActionAt, locale)}
                      </span>
                      {" — "}
                      {item.nextAction}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
