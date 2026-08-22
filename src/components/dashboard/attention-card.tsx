import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AlertTriangle, CalendarClock, CheckCircle2, FileClock, UserX } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardOperations } from "@/lib/services/dashboard-operations";

interface AttentionCardProps {
  operations: DashboardOperations;
}

/**
 * ============================================================================
 * MILESTONE 26B-7 — WHAT NEEDS A DECISION TODAY
 * ============================================================================
 *
 * Four conditions, each of which is a plain fact already recorded in the CRM:
 * a commitment whose date has passed, one due today, an open process with no
 * owner, and an application whose documents nobody has reviewed.
 *
 * NO INVENTED URGENCY. There is no scoring, no "at risk", no threshold anyone
 * chose — a lead is not flagged for being seven days old, because ODL has not
 * decided that seven days is late. Every line here is a count of rows meeting
 * a condition the data states outright, which is also why each one can be
 * reconciled against the pipeline by hand.
 *
 * A CONDITION AT ZERO DISAPPEARS, and if all four are clear the card says so
 * rather than listing four reassuring zeros. This is a to-do list; an empty
 * to-do list should read as empty.
 *
 * COMPLIANCE AND AML ARE DEFINITELY NOT HERE — that engine does not exist yet,
 * and a "0 alerts" line would imply screening had run.
 */
export async function AttentionCard({ operations }: AttentionCardProps) {
  const t = await getTranslations();

  const items = [
    {
      key: "overdue",
      count: operations.followUpsOverdue,
      label: t("dashboard.attention.overdueFollowUps", { count: operations.followUpsOverdue }),
      href: "/solicitudes",
      icon: AlertTriangle,
      tone: "text-warning",
    },
    {
      key: "today",
      count: operations.followUpsToday,
      label: t("dashboard.attention.todayFollowUps", { count: operations.followUpsToday }),
      href: "/solicitudes",
      icon: CalendarClock,
      tone: "text-navy",
    },
    {
      key: "unassigned",
      count: operations.unassignedActive,
      label: t("dashboard.attention.unassigned", { count: operations.unassignedActive }),
      href: "/solicitudes",
      icon: UserX,
      tone: "text-warning",
    },
    {
      key: "documents",
      count: operations.applicationsWithDocumentsToReview,
      label: t("dashboard.attention.documentsToReview", {
        count: operations.applicationsWithDocumentsToReview,
      }),
      href: "/documentos",
      icon: FileClock,
      tone: "text-navy",
    },
  ].filter((item) => item.count > 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("dashboard.attention.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
            {t("dashboard.attention.allClear")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {items.map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className="flex items-start gap-2.5 rounded-sm text-sm text-foreground underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <item.icon
                    className={`mt-0.5 size-4 shrink-0 ${item.tone}`}
                    aria-hidden="true"
                    strokeWidth={1.75}
                  />
                  <span>{item.label}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
