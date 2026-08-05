import { getTranslations } from "next-intl/server";
import { FileText, FileCheck2, CheckCircle2, XCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  REPORT_SUMMARY,
  FREQUENT_REJECTION_REASONS,
  ADVISOR_PRODUCTIVITY,
  AVERAGE_TIME_BETWEEN_STATES,
} from "@/lib/demo-data";

export default async function ReportesPage() {
  const t = await getTranslations();

  const kpis = [
    {
      label: t("reports.kpis.applicationsReceived"),
      value: REPORT_SUMMARY.applicationsReceived,
      hint: `+${REPORT_SUMMARY.applicationsReceivedChangePercent}%`,
      icon: FileText,
    },
    {
      label: t("reports.kpis.documentationRate"),
      value: `${REPORT_SUMMARY.documentationCompletionRate}%`,
      hint: t("reports.kpis.documentationRateHint"),
      icon: FileCheck2,
    },
    {
      label: t("reports.kpis.approvedApplications"),
      value: REPORT_SUMMARY.approvedApplications,
      hint: t("reports.kpis.ofTotal", { percent: REPORT_SUMMARY.approvedRate }),
      icon: CheckCircle2,
    },
    {
      label: t("reports.kpis.notEligibleApplications"),
      value: REPORT_SUMMARY.notApplicableApplications,
      hint: t("reports.kpis.ofTotal", { percent: REPORT_SUMMARY.notApplicableRate }),
      icon: XCircle,
    },
  ];

  const maxReasonCount = Math.max(...FREQUENT_REJECTION_REASONS.map((r) => r.count));

  return (
    <div>
      <PageHeader title={t("reports.title")} description={t("reports.description")} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm text-muted-foreground">{kpi.label}</p>
                <p className="mt-1.5 text-2xl font-semibold text-foreground">{kpi.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{kpi.hint}</p>
              </div>
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <kpi.icon className="size-5" strokeWidth={1.75} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t("reports.frequentReasonsTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {FREQUENT_REJECTION_REASONS.map((reason) => (
              <div key={reason.key}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="text-foreground">
                    {t(`reports.frequentReasons.${reason.key}`)}
                  </span>
                  <span className="text-muted-foreground">{reason.count}</span>
                </div>
                <Progress value={(reason.count / maxReasonCount) * 100} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("reports.avgTimeTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {AVERAGE_TIME_BETWEEN_STATES.map((item) => (
                <li
                  key={`${item.from}-${item.to}`}
                  className="flex items-center justify-between border-b border-border pb-3 text-sm last:border-b-0 last:pb-0"
                >
                  <span className="text-foreground">
                    {t(`statuses.loanApplication.${item.from}`)} →{" "}
                    {t(`statuses.loanApplication.${item.to}`)}
                  </span>
                  <span className="font-medium text-muted-foreground">
                    {item.avgDays} {t("common.days")}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>{t("reports.advisorProductivityTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("reports.columns.advisor")}</TableHead>
                  <TableHead className="text-center">
                    {t("reports.columns.managedApplications")}
                  </TableHead>
                  <TableHead className="text-center">{t("reports.columns.approved")}</TableHead>
                  <TableHead className="text-center">
                    {t("reports.columns.avgClosingTime")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ADVISOR_PRODUCTIVITY.map((advisor) => (
                  <TableRow key={advisor.advisorName}>
                    <TableCell className="font-medium text-foreground">
                      {advisor.advisorName}
                    </TableCell>
                    <TableCell className="text-center text-muted-foreground">
                      {advisor.applications}
                    </TableCell>
                    <TableCell className="text-center text-muted-foreground">
                      {advisor.approved}
                    </TableCell>
                    <TableCell className="text-center text-muted-foreground">
                      {advisor.avgDaysToClose} {t("common.days")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
