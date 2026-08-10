import { getTranslations } from "next-intl/server";
import { Users, FilePlus2, FileClock, Scale, CheckCircle2, XCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { RecentActivityCard } from "@/components/dashboard/recent-activity-card";
import { StatusDistributionCard } from "@/components/dashboard/status-distribution-card";
import { PendingTasksCard } from "@/components/dashboard/pending-tasks-card";
import { CLIENTS } from "@/lib/demo-data";
import { getApplications } from "@/lib/services/applications";
import { getDocumentSlotsAwaitingReviewCount } from "@/lib/services/requirement-slots";
import type { ApplicationListItem } from "@/types";

/**
 * Server Component -> service, direct — same posture as every other
 * initial page load in this app (Milestone 13D; see the Milestone 13A
 * architecture review and its final validation). Reuses getApplications()
 * unchanged (extended in 13B, already used by Solicitudes in 13C) — one
 * fetch, shared between the four Application-status KPIs below and
 * StatusDistributionCard, which now receives the list as a prop instead
 * of independently importing demo data. No new service, no workspace
 * abstraction: getApplications() already carries everything a
 * status-count needs.
 *
 * registeredClients (Client Engine) and documentsAwaitingReview
 * (Requirement Slot Engine, migrated in 12E1b) are untouched — neither
 * derives from demo Applications, so neither belongs to this milestone.
 */
export default async function DashboardPage() {
  const t = await getTranslations("dashboard");
  const [documentsAwaitingReviewResult, applicationsResult] = await Promise.all([
    getDocumentSlotsAwaitingReviewCount(),
    getApplications(),
  ]);

  const applications: ApplicationListItem[] =
    applicationsResult.status === "ok" ? applicationsResult.applications : [];
  const applicationsUnavailable = applicationsResult.status === "error";
  const applicationsUnavailableHint = applicationsUnavailable ? t("kpis.applicationsUnavailable") : undefined;

  const kpis = [
    {
      label: t("kpis.registeredClients"),
      value: CLIENTS.length,
      icon: Users,
    },
    {
      label: t("kpis.newApplications"),
      value: applicationsUnavailable ? "—" : applications.filter((app) => app.status === "new").length,
      hint: applicationsUnavailableHint,
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
      value: applicationsUnavailable ? "—" : applications.filter((app) => app.status === "in_review").length,
      hint: applicationsUnavailableHint,
      icon: Scale,
      accentClass: "bg-navy/10 text-navy",
    },
    {
      label: t("kpis.approvedApplications"),
      value: applicationsUnavailable ? "—" : applications.filter((app) => app.status === "approved").length,
      hint: applicationsUnavailableHint,
      icon: CheckCircle2,
      accentClass: "bg-success/10 text-success",
    },
    {
      label: t("kpis.notEligibleApplications"),
      value: applicationsUnavailable ? "—" : applications.filter((app) => app.status === "not_eligible").length,
      hint: applicationsUnavailableHint,
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
          <StatusDistributionCard applications={applications} />
        </div>
      </div>

      <div className="mt-4">
        <PendingTasksCard />
      </div>
    </div>
  );
}
