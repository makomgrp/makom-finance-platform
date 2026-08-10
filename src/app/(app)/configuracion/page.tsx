import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/shared/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ProfileSection } from "@/components/settings/profile-section";
import { UsersSection } from "@/components/settings/users-section";
import { CatalogSection } from "@/components/settings/catalog-section";
import { CompaniesSection } from "@/components/settings/companies-section";
import { NotificationsSection } from "@/components/settings/notifications-section";
import { SecuritySection } from "@/components/settings/security-section";
import { ProductsSection } from "@/components/settings/products-section";
import { APPLICATION_STATUS_BADGE_CLASS, APPLICATION_STATUS_ORDER } from "@/lib/config/application";
import { DOCUMENT_TYPE_ORDER } from "@/lib/config/document";
import { getProfiles } from "@/lib/services/profiles";
import { getAllProducts } from "@/lib/services/products";

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
          <TabsTrigger value="empresas">{t("settings.tabs.companies")}</TabsTrigger>
          <TabsTrigger value="notificaciones">{t("settings.tabs.notifications")}</TabsTrigger>
          <TabsTrigger value="seguridad">{t("settings.tabs.security")}</TabsTrigger>
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

        <TabsContent value="empresas" className="mt-4">
          <CompaniesSection />
        </TabsContent>

        <TabsContent value="notificaciones" className="mt-4">
          <NotificationsSection />
        </TabsContent>

        <TabsContent value="seguridad" className="mt-4">
          <SecuritySection />
        </TabsContent>
      </Tabs>
    </div>
  );
}
