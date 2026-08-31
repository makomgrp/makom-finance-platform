import { headers } from "next/headers";
import { getAllProducts } from "@/lib/services/products";
import { extractAttribution } from "@/lib/validation/attribution";
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

  // ---------------------------------------------------------------------------
  // MILESTONE 26B-26B.1 — DE DÓNDE VIENE ESTA PERSONA
  //
  // Se lee AQUÍ porque aquí es el único sitio donde existe. La campaña está en
  // la URL cuando alguien abre el formulario; el lead nace cuando lo envía, en
  // otra petición que ya no tiene esa URL. Sin capturarlo en el render, se
  // pierde — y una URL de llegada no se reconstruye después.
  //
  // NO SE ESCRIBE NADA TODAVÍA. Abrir la página no crea ninguna fila, así que
  // un bot rastreando el sitio o alguien que mira y se va no inflan ningún
  // recuento de leads. La atribución solo se persiste si esta persona llega a
  // enviar el Paso 1.
  //
  // EL REFERENTE SALE DE LA CABECERA, no de `document.referrer`: así funciona
  // sin JavaScript, y es lo que el navegador declaró al servidor en esta misma
  // navegación. Se le pasa el host de ODL para que navegar dentro del propio
  // sitio no se cuente como una fuente externa — sin eso, el portal aparecería
  // como su propio mayor canal de captación.
  //
  // `extractAttribution` deja esto en host y ruta: ni query, ni fragmento, ni
  // URL completa. Y la Server Action lo vuelve a sanear al recibirlo, porque
  // vuelve por el navegador.
  const requestHeaders = await headers();
  const attribution = extractAttribution({
    searchParams: params,
    referrer: requestHeaders.get("referer"),
    landingPath: "/solicitud",
    selfHost: requestHeaders.get("host"),
  });

  const initialValues: StepOneInitialValues = {
    fullName: "",
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
      attribution={attribution}
    />
  );
}
