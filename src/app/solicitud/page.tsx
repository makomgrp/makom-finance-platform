import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getAllProducts } from "@/lib/services/products";
import { PublicApplicationIntakeForm } from "./application-intake-form";

/**
 * Milestone 15C — the public website loan-application page. Genuinely
 * public: no getCurrentProfile() check, no CRM navigation, listed in
 * src/proxy.ts's PUBLIC_PATHS. Fetches active Products server-side via
 * the existing Product Engine (getAllProducts()) — no separate public
 * product catalog, no duplicated Product vocabulary. Only the fields the
 * public form actually needs (id, code, localized name) are passed down;
 * internal fields (displayOrder, statusChangedBy*, createdAt) are not.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("publicIntake.meta");
  return { title: t("title"), description: t("description") };
}

export default async function PublicApplicationIntakePage() {
  const productsResult = await getAllProducts();
  const products =
    productsResult.status === "ok"
      ? productsResult.products
          .filter((product) => product.status === "active")
          .map((product) => ({ id: product.id, code: product.code, name: product.name }))
      : [];

  return <PublicApplicationIntakeForm products={products} />;
}
