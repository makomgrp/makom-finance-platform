import { getAllProducts } from "@/lib/services/products";
import { StepOneForm, type StepOneInitialValues } from "./step-one-form";

/**
 * ============================================================================
 * PORTAL ENTRY — STEP 1 (26B-1)
 * ============================================================================
 *
 * The general "Solicitar un préstamo" destination: a customer with no lead yet
 * and, usually, no product chosen.
 *
 * ----------------------------------------------------------------------------
 * `?producto=N` — WHY A QUERY PARAMETER IS CORRECT *HERE*
 * ----------------------------------------------------------------------------
 * PII must never travel in a URL, and none does: this parameter carries a
 * single letter from a four-value public catalog. It identifies a PRODUCT, not
 * a person, and it is exactly as sensitive as the product page the customer
 * just clicked from. Nothing about who they are can be inferred from it.
 *
 * It exists so the ODL website's product-specific "Solicite hoy" buttons can
 * link straight here without any integration work at all — a plain `<a href>`
 * is enough. The richer path (website POSTs the customer's details and
 * redirects with an opaque reference) is /solicitud/continuar/<token>, and both
 * land on this same Step 1.
 *
 * AN UNKNOWN CODE PRESELECTS NOTHING. It is validated against the live catalog
 * here and, independently, again on submit. A junk value simply leaves the
 * customer choosing for themselves — it never weakens validation and never
 * becomes a silent "no product".
 */
export default async function PortalStepOnePage({
  searchParams,
}: PageProps<"/solicitud">) {
  const params = await searchParams;

  const productsResult = await getAllProducts();
  const products =
    productsResult.status === "ok"
      ? productsResult.products
          .filter((product) => product.status === "active")
          // Only what the customer needs to choose. displayOrder,
          // statusChangedBy*, createdAt and every other internal field stay on
          // the server — the same discipline the 15C page established.
          // Only products carrying an official N/D/V/E code are offerable:
          // that letter is the application number's suffix and the public
          // identifier the website links with.
          .filter((product) => Boolean(product.applicationCode))
          .map((product) => ({
            id: product.id,
            applicationCode: product.applicationCode!,
            name: product.name,
            shortDescription: product.shortDescription,
          }))
      : [];

  // Normalised to upper case so ?producto=n works as well as ?producto=N — a
  // website developer should not have to get the casing right for a customer's
  // application to open on the correct product.
  const requestedProduct =
    typeof params.producto === "string" ? params.producto.trim().toUpperCase() : "";
  const preselectedCode = products.some((p) => p.applicationCode === requestedProduct)
    ? requestedProduct
    : "";

  const initialValues: StepOneInitialValues = {
    firstName: "",
    lastName: "",
    phone: "",
    email: "",
    identificationType: "cedula",
    identificationNumber: "",
    productCode: preselectedCode,
    requestedAmount: "",
    requestedTermMonths: "",
  };

  return (
    <StepOneForm
      products={products}
      initialValues={initialValues}
      // A preselected product is not "prefilled personal data" — the banner
      // that explains "we already have some of your details" would be a lie
      // here, because we have none.
      hasPrefill={false}
    />
  );
}
