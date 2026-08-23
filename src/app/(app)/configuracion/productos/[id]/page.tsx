import Link from "next/link";
import { getTranslations, getLocale } from "next-intl/server";
import { AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { RequirementsSection } from "@/components/settings/requirements-section";
import { PRODUCT_STATUS_BADGE_CLASS } from "@/lib/config/product";
import { getProductById } from "@/lib/services/products";
import { getRequirementTemplatesByProductId } from "@/lib/services/requirement-templates";
import type { Locale } from "@/i18n/config";

interface ProductDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ProductDetailPage({ params }: ProductDetailPageProps) {
  const { id } = await params;
  const t = await getTranslations();
  const locale = (await getLocale()) as Locale;

  const [productResult, requirementsResult] = await Promise.all([
    getProductById(id),
    getRequirementTemplatesByProductId(id),
  ]);

  if (productResult.status !== "ok") {
    return (
      <div>
        <Link
          href="/configuracion"
          className="text-sm text-primary underline underline-offset-4"
        >
          {t("settings.productDetail.backToProducts")}
        </Link>
        <div className="mt-4 rounded-xl border border-border bg-card p-4">
          <EmptyState
            icon={AlertTriangle}
            title={t("settings.productDetail.loadErrorTitle")}
            description={t("settings.productDetail.loadErrorDescription")}
          />
        </div>
      </div>
    );
  }

  const product = productResult.product;

  return (
    <div>
      <Link
        href="/configuracion"
        className="text-sm text-primary underline underline-offset-4"
      >
        {t("settings.productDetail.backToProducts")}
      </Link>

      <div className="mt-3">
        <PageHeader
          title={product.name[locale]}
          description={product.shortDescription?.[locale]}
        />
      </div>

      <div className="-mt-4 mb-6 flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {t("settings.productDetail.status")}:
          <StatusBadge
            label={t(`statuses.productStatus.${product.status}`)}
            className={PRODUCT_STATUS_BADGE_CLASS[product.status]}
          />
        </span>
      </div>

      <RequirementsSection
        productId={product.id}
        requirementTemplates={requirementsResult.status === "ok" ? requirementsResult.requirementTemplates : []}
        hasError={requirementsResult.status === "error"}
      />
    </div>
  );
}
