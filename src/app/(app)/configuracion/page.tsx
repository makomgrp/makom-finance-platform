import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/shared/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProfileSection } from "@/components/settings/profile-section";
import { UsersSection } from "@/components/settings/users-section";
import { CatalogSection } from "@/components/settings/catalog-section";
import { ProductsSection } from "@/components/settings/products-section";
import { APPLICATION_STATUS_BADGE_CLASS, APPLICATION_STATUS_ORDER } from "@/lib/config/application";
import { DOCUMENT_TYPE_ORDER } from "@/lib/config/document";
import { getProfiles } from "@/lib/services/profiles";
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
  const profilesResult = await getProfiles();
  const productsResult = await getAllProducts();

  return (
    <div>
      <PageHeader title={t("settings.title")} description={t("settings.description")} />

      <Tabs defaultValue="perfil">
        <TabsList className="flex-wrap">
          <TabsTrigger value="perfil">{t("settings.tabs.profile")}</TabsTrigger>
          <TabsTrigger value="usuarios">{t("settings.tabs.users")}</TabsTrigger>
          <TabsTrigger value="productos">{t("settings.tabs.products")}</TabsTrigger>
          <TabsTrigger value="estados">{t("settings.tabs.applicationStatuses")}</TabsTrigger>
          <TabsTrigger value="documentos">{t("settings.tabs.documentTypes")}</TabsTrigger>
        </TabsList>

        <TabsContent value="perfil" className="mt-4">
          <ProfileSection />
        </TabsContent>

        <TabsContent value="usuarios" className="mt-4">
          <UsersSection
            users={profilesResult.status === "ok" ? profilesResult.users : []}
            hasError={profilesResult.status === "error"}
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
