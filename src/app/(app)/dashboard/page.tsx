import { getTranslations } from "next-intl/server";
import { EMPTY_BRANCH_SCOPE, isEmptyScope, isNationalScope } from "@/lib/services/branch-scope-query";
import {
  BRANCH_CONTEXT_UNASSIGNED,
  getBranchContextOptions,
  resolveBranchViewScope,
} from "@/lib/services/branch-view-context";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import {
  AlarmClock,
  CalendarClock,
  FileClock,
  Scale,
  UserRoundSearch,
  Users,
  UserX,
} from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { KpiCard } from "@/components/dashboard/kpi-card";
import { StatusDistributionCard } from "@/components/dashboard/status-distribution-card";
import { PipelineOverviewCard } from "@/components/dashboard/pipeline-overview-card";
import { AdvisorWorkloadCard } from "@/components/dashboard/advisor-workload-card";
import { MyFollowUpsCard } from "@/components/dashboard/my-follow-ups-card";
import { MyDocumentRequestsCard } from "@/components/dashboard/my-document-requests-card";
import { AttentionCard } from "@/components/dashboard/attention-card";
import { getClients } from "@/lib/services/clients";
import { getApplications } from "@/lib/services/applications";
import { getDashboardOperations } from "@/lib/services/dashboard-operations";
import { getMyOutstandingDocumentRequests } from "@/lib/services/document-requests";
import { getProfiles } from "@/lib/services/profiles";
import { requireCapability } from "@/lib/auth/authorize";
import { getReportingComparison } from "@/lib/services/reporting";
import { resolvePeriodFromParams } from "@/lib/reporting/period-params";
import { AnalyticsSection } from "@/components/dashboard/analytics/analytics-section";
import type { ApplicationListItem } from "@/types";

/**
 * Server Component -> service, direct — same posture as every other
 * initial page load in this app (Milestone 13D; see the Milestone 13A
 * architecture review and its final validation).
 *
 * MILESTONE 18: every panel on this page reads real Supabase data.
 * RecentActivityCard (fabricated events about demo clients) and
 * PendingTasksCard (four invented tasks with checkboxes that persisted
 * nothing) were removed rather than re-sourced. Error states stay honest: a
 * failed read renders "—" plus an explanatory hint, never a fabricated 0.
 *
 * ----------------------------------------------------------------------------
 * MILESTONE 26B-7 — FROM SUMMARY TO CONTROL SCREEN
 * ----------------------------------------------------------------------------
 * The page previously answered six questions, all of them about FORMAL
 * applications, and was therefore blind to the entire pre-submission funnel —
 * which, since the portal shipped, is where most of the day's work actually
 * sits. Someone could open the CRM to "0 solicitudes nuevas" while three leads
 * were stuck at Paso 2 with nobody assigned.
 *
 * The operational figures now come from getDashboardOperations(), which
 * aggregates the SAME pipeline cards /solicitudes renders rather than counting
 * a status column. See that module for why re-deriving stages in SQL would be
 * both cheaper and wrong.
 *
 * WHAT WAS DROPPED FROM THE KPI ROW, AND WHY IT IS NOT LOST: the "Aprobadas"
 * and "No aplican" cards. Both are outcome totals, and both are still on this
 * screen — StatusDistributionCard directly below lists every formal status
 * with its count. They were duplicate renderings of the same two numbers, and
 * the row needed the space for figures that appear nowhere else.
 *
 * WHAT CHANGED MEANING: the document KPI counted requirement SLOTS awaiting
 * review. "17" is a pile, not a queue; a reviewer works application by
 * application, so it now counts applications with at least one received-but-
 * unreviewed requirement. getDocumentSlotsAwaitingReviewCount() is left in the
 * requirement-slots service, unreferenced, rather than deleted in a dashboard
 * milestone.
 *
 * QUERY BUDGET: getClients, getApplications, and getDashboardOperations (which
 * is the pipeline read plus, only for a viewer authorized to see it, the staff
 * roster). Fixed, regardless of how many leads or advisors exist.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{
    sucursal?: string;
    periodo?: string;
    desde?: string;
    hasta?: string;
  }>;
}) {
  const t = await getTranslations("dashboard");
  // MILESTONE 25B-1 — effective branch scope, resolved server-side ONCE by
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
  const params = await searchParams;
  const { sucursal } = params;
  const { viewScope: scope, selection: branchSelection } = await resolveBranchViewScope(
    profile?.branchScope ?? EMPTY_BRANCH_SCOPE,
    sucursal
  );
  // MILESTONE 25C-1 — the heading states the DENOMINATOR. KPI numbers with no
  // stated context are actively misleading in a multi-branch company: "12
  // clientes" means something different for Panamá Centro than for all of ODL.
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
  const showContext = branchOptions.length > 1;
  const showNoBranchNotice = isEmptyScope(profile?.branchScope ?? EMPTY_BRANCH_SCOPE);

  // MILESTONE 26B-7 — WHO MAY SEE OTHER PEOPLE'S WORKLOAD.
  //
  // Gated on `application:assign_advisor`, which is already the authority to
  // decide who owns a process — deciding that and seeing what each person is
  // carrying are the same job. Reusing it rather than minting a capability
  // keeps the matrix the single answer, and it grants nothing new: the two
  // roles holding it (administrador, gerente) can already see every advisor in
  // Configuración.
  //
  // An `asesor` sees ONLY THEIR OWN row. That is a narrowing, not a widening —
  // their own caseload is data they already work from — and it keeps the screen
  // useful for them without exposing the team.
  const canSeeTeamWorkload = profile?.capabilities.includes("application:assign_advisor") ?? false;
  const workloadFor = canSeeTeamWorkload
    ? ("all" as const)
    : profile?.role === "asesor" && profile.id
      ? ({ selfProfileId: profile.id } as const)
      : ("none" as const);

  // ---------------------------------------------------------------------------
  // MILESTONE 26B-26D — LA CAPA GERENCIAL, DETRÁS DE SU PROPIA CAPACIDAD
  //
  // `requireCapability` es la MISMA puerta que usan las Server Actions, y se
  // usa aquí por lo mismo: ocultar una sección no es controlar el acceso. Quien
  // no tenga `analytics:view` no ve el bloque porque LOS DATOS NUNCA SE PIDEN —
  // no hay respuesta que interceptar, ni petición que reproducir a mano.
  //
  // Esto NO cambia el Dashboard operativo. Un asesor sigue viendo sus KPIs, su
  // pipeline y su carga exactamente igual que antes; lo que no ve es el informe
  // de resultados del negocio, que es una pregunta distinta.
  // ---------------------------------------------------------------------------
  const analyticsAuth = await requireCapability("analytics:view");
  const canSeeAnalytics = analyticsAuth.status === "authorized";

  // MILESTONE 26B-26F — una segunda puerta, para una pregunta distinta.
  //
  // Ver los agregados no da derecho a descargar la cartera de clientes. Se
  // resuelve aquí, en el servidor, y baja como booleano hasta el botón: la ruta
  // `/api/exportacion-detallada` vuelve a exigir la misma capacidad, así que
  // esconder el control es una cortesía y no la defensa.
  const exportAuth = await requireCapability("reports:export_sensitive");
  const canExportSensitive = exportAuth.status === "authorized";
  const periodSelection = resolvePeriodFromParams(params);

  const [
    applicationsResult,
    clientsResult,
    operationsResult,
    reportingResult,
    profilesResult,
    myDocumentRequests,
  ] = await Promise.all([
    getApplications(scope),
    getClients(scope),
    getDashboardOperations(scope, workloadFor),
    // Una sola llamada: el servicio ya paraleliza sus catorce RPC por período
    // y resuelve el actual y el anterior a la vez. Nada aquí itera.
    canSeeAnalytics ? getReportingComparison(periodSelection.period) : Promise.resolve(null),
    // Los nombres del personal se resuelven APARTE, contra el directorio que
    // este perfil ya puede leer. La capa agregada lleva `profileId` y ningún
    // dato personal, y así debe seguir: un informe de dirección no es el sitio
    // donde ampliar el acceso a datos de personas.
    canSeeAnalytics ? getProfiles() : Promise.resolve(null),
    // MILESTONE 2.3 — solo para quien tiene fila propia (un asesor); un
    // supervisor ve la carga del equipo arriba, no una cola personal que no
    // describiría su propio trabajo.
    typeof workloadFor === "object"
      ? getMyOutstandingDocumentRequests(scope, workloadFor.selfProfileId)
      : Promise.resolve([]),
  ]);

  const reporting = reportingResult?.status === "ok" ? reportingResult.data : null;
  const reportingFailed = canSeeAnalytics && reportingResult?.status !== "ok";
  const nameByProfileId: Record<string, string> = {};
  if (profilesResult?.status === "ok") {
    for (const user of profilesResult.users) nameByProfileId[user.id] = user.fullName;
  }

  const applications: ApplicationListItem[] =
    applicationsResult.status === "ok" ? applicationsResult.applications : [];
  const applicationsUnavailable = applicationsResult.status === "error";
  const applicationsUnavailableHint = applicationsUnavailable ? t("kpis.applicationsUnavailable") : undefined;

  const operations = operationsResult.status === "ok" ? operationsResult.operations : null;
  const workload = operationsResult.status === "ok" ? operationsResult.workload : [];
  // A failed pipeline read must not become a confident zero. Every figure it
  // feeds renders "—" with the same hint the application KPIs use.
  const opsHint = operations ? undefined : t("kpis.operationsUnavailable");
  const ops = (value: number) => (operations ? value : "—");

  const kpis = [
    {
      label: t("kpis.activeLeads"),
      value: ops(operations?.activeLeads ?? 0),
      hint: opsHint,
      icon: UserRoundSearch,
    },
    {
      label: t("kpis.applicationsUnderReview"),
      value: applicationsUnavailable ? "—" : applications.filter((app) => app.status === "in_review").length,
      hint: applicationsUnavailableHint,
      icon: Scale,
      accentClass: "bg-navy/10 text-navy",
    },
    {
      label: t("kpis.unassigned"),
      value: ops(operations?.unassignedActive ?? 0),
      hint: opsHint,
      icon: UserX,
      accentClass: "bg-warning/10 text-warning",
    },
    {
      label: t("kpis.overdueFollowUps"),
      value: ops(operations?.followUpsOverdue ?? 0),
      hint: opsHint,
      icon: AlarmClock,
      accentClass: "bg-warning/10 text-warning",
    },
    {
      label: t("kpis.todayFollowUps"),
      value: ops(operations?.followUpsToday ?? 0),
      hint: opsHint,
      icon: CalendarClock,
    },
    {
      label: t("kpis.applicationsWithDocumentsToReview"),
      value: ops(operations?.applicationsWithDocumentsToReview ?? 0),
      hint: opsHint,
      icon: FileClock,
      accentClass: "bg-warning/10 text-warning",
    },
    {
      label: t("kpis.registeredClients"),
      value: clientsResult.status === "ok" ? clientsResult.clients.length : "—",
      icon: Users,
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
          styled as an error: it is a configuration state, not a failure. */}
      {showNoBranchNotice && (
        <div className="mb-6 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          {tBranch("noBranchAssigned")}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} />
        ))}
      </div>

      {/* Where the work is, and what is late — side by side, because the second
          is almost always a consequence of the first. */}
      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PipelineOverviewCard stageCounts={operations?.stageCounts ?? EMPTY_STAGE_COUNTS} />
        {operations && <AttentionCard operations={operations} />}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
        {workloadFor !== "none" && (
          <AdvisorWorkloadCard rows={workload} selfOnly={workloadFor !== "all"} />
        )}
        <StatusDistributionCard applications={applications} />
      </div>

      {/* MILESTONE 2.2 — only for a viewer with their own row (an asesor):
          a supervisor sees the team's workload above, not a personal queue
          that would not describe their own job. */}
      {workloadFor !== "all" && workloadFor !== "none" && operations && (
        <div className="mt-6">
          <MyFollowUpsCard items={operations.myFollowUps} />
        </div>
      )}

      {/* MILESTONE 2.3 — misma puerta que MyFollowUpsCard. */}
      {typeof workloadFor === "object" && (
        <div className="mt-6">
          <MyDocumentRequestsCard items={myDocumentRequests} />
        </div>
      )}

      {/* MILESTONE 26B-26D — el informe de dirección, bajo `analytics:view`.
          Va DEBAJO de lo operativo a propósito: quien abre el CRM por la mañana
          necesita primero saber qué hay que hacer hoy, y después cómo va el
          negocio. Un asesor no llega hasta aquí porque para él no existe. */}
      {canSeeAnalytics && (
        <div className="mt-10 border-t border-border pt-8">
          {reportingFailed ? (
            /* Una consulta fallida NO se convierte en ceros. Un cero es una
               respuesta —«no pasó nada»— y presentarlo cuando en realidad no
               pudimos leer sería el peor fallo posible en un informe. */
            <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
              {t("analytics.error")}
            </div>
          ) : (
            reporting && (
              <AnalyticsSection
                data={reporting}
                activeKind={periodSelection.kind}
                nameByProfileId={nameByProfileId}
                canExportSensitive={canExportSensitive}
              />
            )
          )}
        </div>
      )}
    </div>
  );
}

/** Rendered only when the pipeline read failed; the card then shows its own
 * empty state rather than four bars claiming zero. */
const EMPTY_STAGE_COUNTS = {
  nuevo: 0,
  paso_2: 0,
  paso_3: 0,
  en_evaluacion: 0,
  aprobado: 0,
  cancelado: 0,
  descartado: 0,
} as const;
