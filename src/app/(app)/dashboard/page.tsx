import { getTranslations } from "next-intl/server";
import { EMPTY_BRANCH_SCOPE, isEmptyScope, isNationalScope } from "@/lib/services/branch-scope-query";
import {
  BRANCH_CONTEXT_UNASSIGNED,
  getBranchContextOptions,
  resolveBranchViewScope,
} from "@/lib/services/branch-view-context";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
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
export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ sucursal?: string }> }) {
  const t = await getTranslations("dashboard");  // MILESTONE 25B-1 — effective branch scope, resolved server-side ONCE by
  // getCurrentProfile() (cached per request) and passed explicitly to every
  // scoped read. Services never resolve scope themselves, and the client never
  // supplies it. The (app) layout has already guaranteed an active profile.
  const profile = await getCurrentProfile();
  // MILESTONE 25C-1 — VIEW CONTEXT. `scope` below is no longer the caller's
  // authorized scope directly: it is the INTERSECTION of that scope with the
  // branch they are currently viewing. resolveBranchViewScope() can only ever
  // narrow — an unreachable, inactive, unknown or stale `?sucursal=` silently
  // falls back to their authorized default, with no error and no signal about
  // whether that branch exists. Everything downstream keeps receiving one
  // server-resolved BranchScope and is unchanged.
  const { sucursal } = await searchParams;
  const { viewScope: scope, selection: branchSelection } = await resolveBranchViewScope(
    profile?.branchScope ?? EMPTY_BRANCH_SCOPE,
    sucursal
  );
  // MILESTONE 25C-1 — the heading states the DENOMINATOR. Five KPI numbers with
  // no stated context are actively misleading in a multi-branch company: "12
  // clientes" means something different for Panamá Centro than for all of ODL.
  // The label is resolved from the SELECTION the server actually applied, not
  // from what the URL asked for, so a request that fell back reads honestly.
  const branchOptions = await getBranchContextOptions(profile?.branchScope ?? EMPTY_BRANCH_SCOPE);
  const tBranch = await getTranslations("branchContext");
  const selectedBranch = branchOptions.find((option) => option.value === branchSelection);
  const contextLabel =
    branchSelection === BRANCH_CONTEXT_UNASSIGNED
      ? tBranch("unassigned")
      : selectedBranch && selectedBranch.kind === "branch"
        ? selectedBranch.label
        : isNationalScope(profile?.branchScope ?? EMPTY_BRANCH_SCOPE)
          ? tBranch("allBranches")
          : tBranch("allMyBranches");
  // Only worth stating when there is more than one thing it could have been.
  const showContext = branchOptions.length > 1;
  // No authorized branch at all — distinct from "national with no branches
  // created yet", which is why this tests the SCOPE rather than the option list.
  const showNoBranchNotice = isEmptyScope(profile?.branchScope ?? EMPTY_BRANCH_SCOPE);

  const [documentsAwaitingReviewResult, applicationsResult, clientsResult] = await Promise.all([
    getDocumentSlotsAwaitingReviewCount(scope),
    getApplications(scope),
    getClients(scope),
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
      <PageHeader
        title={showContext ? t("contextTitle", { branch: contextLabel }) : t("title")}
        description={t("description")}
      />

      {/* MILESTONE 25C-1 — an employee with no branch membership sees zeros
          everywhere, which on its own reads as "the system is broken". This
          says what is actually true and what to do about it. Deliberately NOT
          styled as an error: it is a configuration state, not a failure, and it
          names no internal concept. The KPIs below still render (as real zeros
          from scoped reads) rather than being hidden — hiding them would look
          like a load failure. */}
      {showNoBranchNotice && (
        <div className="mb-6 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {tBranch("noBranchAssigned")}
        </div>
      )}

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
