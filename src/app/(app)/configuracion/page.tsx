import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/shared/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProfileSection } from "@/components/settings/profile-section";
import { UsersSection } from "@/components/settings/users-section";
import { BranchesSection } from "@/components/settings/branches-section";
import { CatalogSection } from "@/components/settings/catalog-section";
import { ProductsSection } from "@/components/settings/products-section";
import { APPLICATION_STATUS_BADGE_CLASS, APPLICATION_STATUS_ORDER } from "@/lib/config/application";
import { DOCUMENT_TYPE_ORDER } from "@/lib/config/document";
import { getProfiles } from "@/lib/services/profiles";
import { getAllCapabilityGrants } from "@/lib/services/capability-grants";
import { getBranches, getActiveBranchesInScope } from "@/lib/services/branches";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { EMPTY_BRANCH_SCOPE } from "@/lib/services/branch-scope-query";
import { assignableRolesFor } from "@/lib/auth/assignable-roles";
import { getAllBranchMemberships } from "@/lib/services/branch-memberships";
import type { DelegatableCapability } from "@/lib/auth/capabilities";
import type { BranchMembership } from "@/types";
import { getAllProducts } from "@/lib/services/products";

/**
 * MILESTONE 18 (Demo Data Purge): three tabs were removed because every
 * control on them was local React state presented as a system setting.
 *
 *   Seguridad — advertised two-factor authentication, an automatic
 *     session-timeout policy and a password age ("last updated 3 months
 *     ago"). None of the three exists. This was the only screen in the
 *     app claiming a SECURITY capability the product does not have, which
 *     is why it was deleted outright rather than trimmed. The real
 *     password-reset flow (/forgot-password -> /reset-password,
 *     requestPasswordResetAction) is untouched and still reachable from
 *     the login screen.
 *   Notificaciones — five e-mail preference switches with no preference
 *     table and no delivery mechanism behind them.
 *   Empresas — payroll-deduction toggles over the static COMPANIES array
 *     whose own toast said "(demostración)". NOTE: only the SCREEN was
 *     removed. COMPANIES and getCompanyById() remain, because every
 *     existing client persists a company_legacy_id that those resolve to
 *     an employer name in the clients table and both dossier tabs.
 *
 * What remains is either genuinely persistent (Perfil read-only, Usuarios,
 * Productos, Requisitos) or an accurate read-only reference to this app's
 * own configured vocabulary (Estados, Tipos de documento).
 */

export default async function ConfiguracionPage() {
  const t = await getTranslations();
  // MILESTONE 24 — grants for the whole directory in ONE read, rather than a
  // query per row. The table holds only delegated exceptions (never the base
  // role matrix), so it stays small by nature.
  // MILESTONE 25C-3 — the caller's own identity, needed for two UX decisions
  // that must be made SERVER-SIDE: which roles they may hand out (rule A2), and
  // which branches they may assign staff into (their own effective scope).
  const profile = await getCurrentProfile();
  const actorScope = profile?.branchScope ?? EMPTY_BRANCH_SCOPE;

  const [profilesResult, grantsResult, branchesResult, membershipsResult, assignableBranchesResult] =
    await Promise.all([
      getProfiles(),
      getAllCapabilityGrants(),
      getBranches(),
      getAllBranchMemberships(),
      // SCOPED, and deliberately a SECOND read rather than a filter over the
      // full list above: `branches` feeds the administration table (which must
      // show inactive branches so they can be reactivated), while this feeds
      // every "assign someone to a branch" control. Filtering the admin list
      // client-side would have shipped out-of-scope branch NAMES to the browser
      // and relied on the UI not to render them.
      getActiveBranchesInScope(actorScope),
    ]);

  // A failed grants read degrades to "no delegated extras shown" rather than
  // failing the whole Settings page — the same fail-closed direction
  // getCurrentProfile() takes when resolving a user's own capabilities.
  const grantsByProfileId: Record<string, DelegatableCapability[]> = {};
  if (grantsResult.status === "ok") {
    for (const grant of grantsResult.grants) {
      (grantsByProfileId[grant.profileId] ??= []).push(grant.capability);
    }
  }
  // MILESTONE 25A. Branch memberships for the whole directory in one read.
  // A failed read degrades to "no branch scope shown" rather than failing the
  // Settings page — the same fail-closed direction getCurrentProfile() takes.
  const branches = branchesResult.status === "ok" ? branchesResult.branches : [];
  const memberships: BranchMembership[] =
    membershipsResult.status === "ok" ? membershipsResult.memberships : [];

  // MILESTONE 25C-3 — ACTIVE staff per branch. Counting every membership row
  // would inflate the figure with deactivated employees who are still
  // historically attached, and an administrator reads this number to decide
  // whether a branch is staffed TODAY. Computed from the directory already
  // loaded above — no extra query, no stored counter column.
  const activeProfileIds = new Set(
    (profilesResult.status === "ok" ? profilesResult.users : [])
      .filter((user) => user.active)
      .map((user) => user.id)
  );
  const staffCountByBranchId: Record<string, number> = {};
  for (const membership of memberships) {
    if (!activeProfileIds.has(membership.profileId)) continue;
    staffCountByBranchId[membership.branchId] =
      (staffCountByBranchId[membership.branchId] ?? 0) + 1;
  }

  // MILESTONE 25C-3 — rule A2 mirrored for the UI only; the database re-checks
  // it on every call. See src/lib/auth/assignable-roles.ts.
  const assignableRoles = assignableRolesFor(profile?.role ?? "consulta");
  const assignableBranches =
    assignableBranchesResult.status === "ok" ? assignableBranchesResult.branches : [];

  const productsResult = await getAllProducts();

  return (
    <div>
      <PageHeader title={t("settings.title")} description={t("settings.description")} />

      <Tabs defaultValue="perfil">
        <TabsList className="flex-wrap">
          <TabsTrigger value="perfil">{t("settings.tabs.profile")}</TabsTrigger>
          <TabsTrigger value="usuarios">{t("settings.tabs.users")}</TabsTrigger>
          <TabsTrigger value="sucursales">{t("settings.tabs.branches")}</TabsTrigger>
          <TabsTrigger value="productos">{t("settings.tabs.products")}</TabsTrigger>
          <TabsTrigger value="estados">{t("settings.tabs.applicationStatuses")}</TabsTrigger>
          <TabsTrigger value="documentos">{t("settings.tabs.documentTypes")}</TabsTrigger>
        </TabsList>

        <TabsContent value="perfil" className="mt-4">
          <ProfileSection />
        </TabsContent>

        <TabsContent value="usuarios" className="mt-4">
          <UsersSection
            grantsByProfileId={grantsByProfileId}
            branchMemberships={memberships}
            users={profilesResult.status === "ok" ? profilesResult.users : []}
            assignableRoles={assignableRoles}
            assignableBranches={assignableBranches}
            hasError={profilesResult.status === "error"}
          />
        </TabsContent>

        <TabsContent value="sucursales" className="mt-4">
          <BranchesSection
            branches={branches}
            staffCountByBranchId={staffCountByBranchId}
            hasError={branchesResult.status === "error"}
          />
        </TabsContent>

        <TabsContent value="productos" className="mt-4">
          <ProductsSection
            products={productsResult.status === "ok" ? productsResult.products : []}
            hasError={productsResult.status === "error"}
          />
        </TabsContent>

        <TabsContent value="estados" className="mt-4">
          <CatalogSection
            title={t("settings.applicationStatuses.title")}
            description={t("settings.applicationStatuses.description")}
            items={APPLICATION_STATUS_ORDER.map((status) => ({
              label: t(`statuses.applicationStatus.${status}`),
              badgeClass: APPLICATION_STATUS_BADGE_CLASS[status],
            }))}
          />
        </TabsContent>

        <TabsContent value="documentos" className="mt-4">
          <CatalogSection
            title={t("settings.documentTypes.title")}
            description={t("settings.documentTypes.description")}
            items={DOCUMENT_TYPE_ORDER.map((type) => ({
              label: t(`statuses.documentType.${type}`),
              description: t(`statuses.documentType.${type}_description`),
            }))}
          />
        </TabsContent>

      </Tabs>
    </div>
  );
}
