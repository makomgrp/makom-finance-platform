import { getTranslations } from "next-intl/server";
import { Users, FilePlus2, FileClock, Scale, CheckCircle2, XCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { RecentActivityCard } from "@/components/dashboard/recent-activity-card";
import { StatusDistributionCard } from "@/components/dashboard/status-distribution-card";
import { PendingTasksCard } from "@/components/dashboard/pending-tasks-card";
import { CLIENTS, APPLICATIONS } from "@/lib/demo-data";
import { getDocumentSlotsAwaitingReviewCount } from "@/lib/services/requirement-slots";

export default async function DashboardPage() {
  const t = await getTranslations("dashboard");
  const documentsAwaitingReviewResult = await getDocumentSlotsAwaitingReviewCount();

  const kpis = [
    {
      label: t("kpis.registeredClients"),
      value: CLIENTS.length,
      icon: Users,
    },
    {
      label: t("kpis.newApplications"),
      value: APPLICATIONS.filter((app) => app.status === "nueva").length,
      icon: FilePlus2,
    },
    {
      label: t("kpis.documentsAwaitingReview"),
      value: documentsAwaitingReviewResult.status === "ok" ? documentsAwaitingReviewResult.count : "—",
      hint: documentsAwaitingReviewResult.status === "error" ? t("kpis.documentsAwaitingReviewUnavailable") : undefined,
      icon: FileClock,
      accentClass: "bg-warning/10 text-warning",
    },
    {
      label: t("kpis.applicationsUnderReview"),
      value: APPLICATIONS.filter((app) => app.status === "en_evaluacion").length,
      icon: Scale,
      accentClass: "bg-navy/10 text-navy",
    },
    {
      label: t("kpis.approvedApplications"),
      value: APPLICATIONS.filter((app) => app.status === "aprobada").length,
      icon: CheckCircle2,
      accentClass: "bg-success/10 text-success",
    },
    {
      label: t("kpis.notEligibleApplications"),
      value: APPLICATIONS.filter((app) => app.status === "no_aplica").length,
      icon: XCircle,
      accentClass: "bg-muted text-muted-foreground",
    },
  ];

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} />
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <RecentActivityCard />
        </div>
        <div className="space-y-4">
          <StatusDistributionCard />
        </div>
      </div>

      <div className="mt-4">
        <PendingTasksCard />
      </div>
    </div>
  );
}
