import { getTranslations } from "next-intl/server";
import { Users, FilePlus2, FileClock, Scale, CheckCircle2, XCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { StatusDistributionCard } from "@/components/dashboard/status-distribution-card";
import { getClients } from "@/lib/services/clients";
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
 * registeredClients now reads the real Client Engine (Milestone 14E —
 * previously the demo CLIENTS array, migrated here since it's a one-line
 * data-source swap, not a redesign). documentsAwaitingReview (Requirement
 * Slot Engine, migrated in 12E1b) is untouched — it derives from neither
 * demo Applications nor demo Clients.
 *
 * MILESTONE 18: every panel remaining on this page reads real Supabase
 * data. RecentActivityCard (fabricated events about demo clients) and
 * PendingTasksCard (four invented tasks with checkboxes that persisted
 * nothing — there is no tasks table in this schema) were removed rather
 * than re-sourced. Neither was replaced: a real activity feed is a later
 * milestone, and inventing "tasks" out of alerts or documents would have
 * been the same fabrication in a new costume. /documentos and /alertas
 * are already the real operational queues and are one click away.
 *
 * Error states stay honest: a failed read renders "—" plus an
 * explanatory hint, never a fabricated 0.
 */
export default async function DashboardPage() {
  const t = await getTranslations("dashboard");
  const [documentsAwaitingReviewResult, applicationsResult, clientsResult] = await Promise.all([
    getDocumentSlotsAwaitingReviewCount(),
    getApplications(),
    getClients(),
  ]);

  const applications: ApplicationListItem[] =
    applicationsResult.status === "ok" ? applicationsResult.applications : [];
  const applicationsUnavailable = applicationsResult.status === "error";
  const applicationsUnavailableHint = applicationsUnavailable ? t("kpis.applicationsUnavailable") : undefined;

  const kpis = [
    {
      label: t("kpis.registeredClients"),
      value: clientsResult.status === "ok" ? clientsResult.clients.length : "—",
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

      <div className="mt-6">
        <StatusDistributionCard applications={applications} />
      </div>
    </div>
  );
}
