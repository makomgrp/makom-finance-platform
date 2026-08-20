import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { getAllProducts } from "@/lib/services/products";
import { PublicApplicationIntakeForm } from "./application-intake-form";

/**
 * MILESTONE 26B-1 — MOVED, NOT CHANGED.
 *
 * This is the Milestone 15C long public form, relocated from /solicitud to
 * /solicitud-clasico so the new customer portal could take the primary route.
 * Its behaviour is untouched: same fields, same POST to
 * /api/public/application-intake, same honeypot, same idempotency.
 *
 * WHY IT WAS KEPT RATHER THAN DELETED: it is the only public surface that
 * currently collects a complete applicant record in one pass — birth date,
 * nationality, address, position and salary — which is exactly what the intake
 * engine needs to create a Client. The portal cannot do that yet, because Step
 * 2 has not been built. Deleting this form today would remove working public
 * capability and replace it with a flow that stops at a development boundary.
 *
 * IT IS EXPECTED TO BE RETIRED once the portal covers Steps 2 and 3. That is
 * ODL's call to make, not a silent side effect of this milestone.
 *
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
