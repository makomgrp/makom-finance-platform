import Link from "next/link";
import { after } from "next/server";
import { getTranslations } from "next-intl/server";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getAllProducts } from "@/lib/services/products";
import { resolveContinuationToken } from "@/lib/services/continuation-tokens";
import { getApplicationIntakeById } from "@/lib/services/application-intakes";
import { redirectIfSubmitted } from "@/lib/services/portal-submitted-guard";
import { redirectIfUnderReview } from "@/lib/services/portal-review-guard";
import { recordStepReached } from "@/lib/services/portal-funnel-events";
import { StepOneForm, type StepOneInitialValues } from "../../step-one-form";

/**
 * ============================================================================
 * RESUMING AN APPLICATION (26B-1)
 * ============================================================================
 *
 * The destination for two journeys that look identical from here:
 *
 *   1. The ODL website collected the customer's basic details, POSTed them to
 *      /api/public/application-intake, received an opaque reference, and sent
 *      the customer here. Step 1 opens ALREADY FILLED — the customer types
 *      nothing twice, which is the whole point of the integration.
 *   2. The customer left mid-application days ago and came back through their
 *      continuation link.
 *
 * ----------------------------------------------------------------------------
 * WHY THE TOKEN IS SAFE IN THIS URL
 * ----------------------------------------------------------------------------
 * It is 256 bits of opaque randomness and encodes NOTHING — not a name, not an
 * email, not a cédula, not an intake id, not an ODL application number. A URL
 * carrying it can sit in a browser history, a referrer header or a chat preview
 * without disclosing anything about the person, or even that a person exists.
 * That is precisely why the design puts a token here and PII nowhere near a
 * query string.
 *
 * The token is resolved SERVER-SIDE here, and is handed to the form only so
 * that the form can send it BACK when the customer saves — which is what lets
 * the server identify the lead itself instead of trusting a row id from the
 * browser. It is never rendered as text and never logged. The intake id, by
 * contrast, never leaves the server.
 *
 * ----------------------------------------------------------------------------
 * FAILURE IS EXPLAINED, NOT JUST REFUSED
 * ----------------------------------------------------------------------------
 * Expired and revoked are distinguished from invalid because a customer holding
 * a real-but-old link needs different advice from someone who mistyped a URL.
 * That distinction leaks nothing: reaching it at all requires already
 * possessing a valid 256-bit token, which is the hard part. A guessed token
 * always lands on "not found".
 */
export default async function PortalContinuePage({
  params,
}: PageProps<"/solicitud/continuar/[token]">) {
  const { token } = await params;

  // Already sent? Then this is a receipt, not a form. See the guard's header.
  await redirectIfSubmitted(token);

  // 26B-18 — a lead the engine parked for a human has no application to
  // walk into. Checked on every step, not only after Step 1, because a
  // bookmark or a Back button never passes through Step 1 at all.
  await redirectIfUnderReview(token);

  const resolved = await resolveContinuationToken(token);

  if (resolved.status !== "ok") {
    const reason = resolved.status === "invalid" ? resolved.reason : "not_found";
    return <ContinuationProblem reason={reason} />;
  }

  const [productsResult, intakeResult] = await Promise.all([
    getAllProducts(),
    getApplicationIntakeById(resolved.resolved.intakeId),
  ]);

  if (intakeResult.status !== "ok") {
    return <ContinuationProblem reason="not_found" />;
  }

  const intake = intakeResult.intake;

  // MILESTONE 26B-26B — DOS PASOS, UNA SOLA PANTALLA.
  //
  // El Paso 1 visible contiene la identidad Y la elección de producto, así que
  // `applicant_data` y `loan_selection` se alcanzan en el mismo instante: quien
  // ve esta pantalla ve las dos secciones. Registrar solo uno dejaría un hueco
  // artificial en el embudo, y fingir que son dos pantallas sería inventar un
  // paso que el solicitante nunca vio por separado.
  //
  // El par reached/completed sigue diciendo cosas distintas para cada uno:
  // `applicant_data` se completa con la identidad, y `loan_selection` solo
  // cuando la Application existe de verdad (ver isStep1Complete).
  //
  // ⚠️ ESTO NO MIDE "SE ABRIÓ EL FORMULARIO". El evento cuelga de un intake, y
  // en /solicitud —sin token— todavía no hay ninguno. Quien abre el formulario y
  // se va sin enviar el Paso 1 no deja rastro, y no se le inventa uno: medirlo
  // exigiría seguimiento anónimo, que es una decisión aparte. El denominador de
  // este embudo son los intakes creados, nunca las visitas.
  after(async () => {
    await recordStepReached(intake.id, "applicant_data");
    await recordStepReached(intake.id, "loan_selection");
  });

  const products =
    productsResult.status === "ok"
      ? productsResult.products
          .filter((product) => product.status === "active")
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

  // Only a product still in the active catalog is preselected. A lead created
  // against a product ODL has since retired must not silently keep it.
  // The intake stores the internal product SLUG (the vocabulary the 15B engine
  // has always used); the portal works in the public N/D/V/E code. Resolved
  // here rather than by storing both, so there is only ever one stored answer.
  const storedProduct =
    productsResult.status === "ok"
      ? productsResult.products.find((p) => p.code === intake.requestedProductCode)
      : undefined;
  const productCode =
    storedProduct?.applicationCode && products.some((p) => p.applicationCode === storedProduct.applicationCode)
      ? storedProduct.applicationCode
      : "";

  const initialValues: StepOneInitialValues = {
    // The stored name is shown exactly as stored. 26B-1A collapsed Step 1 to a
    // single name field, which also removed the lossy join-on-save /
    // guess-apart-on-load round trip the two-field version needed.
    fullName: intake.applicantFullName ?? "",
    phone: intake.applicantPhone ?? "",
    email: intake.applicantEmail ?? "",
    identificationType: intake.applicantIdentificationType ?? "cedula",
    identificationNumber: intake.applicantIdentificationNumber ?? "",
    productCode,
    requestedAmount: intake.requestedAmount != null ? String(intake.requestedAmount) : "",
    // 26B-1B: a term captured by any earlier channel is shown so the customer
    // confirms or changes it rather than silently re-submitting a value they
    // cannot see. Blank when nobody has chosen one.
    requestedTermMonths:
      intake.requestedTermMonths != null ? String(intake.requestedTermMonths) : "",
  };

  // The banner is shown only when the customer's OWN details actually arrived.
  // A bare lead with nothing but a product would make "we already have some of
  // your details" untrue.
  const hasPrefill = Boolean(
    intake.applicantFullName || intake.applicantEmail || intake.applicantPhone
  );

  return (
    <StepOneForm
      products={products}
      initialValues={initialValues}
      continuationToken={token}
      hasPrefill={hasPrefill}
    />
  );
}

async function ContinuationProblem({ reason }: { reason: "not_found" | "expired" | "revoked" }) {
  const t = await getTranslations("portal.resume");
  const copy = {
    not_found: { title: t("notFoundTitle"), body: t("notFoundBody") },
    expired: { title: t("expiredTitle"), body: t("expiredBody") },
    revoked: { title: t("revokedTitle"), body: t("revokedBody") },
  }[reason];

  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card px-6 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-warning/10 text-warning">
        <AlertCircle className="size-6" aria-hidden="true" />
      </span>
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{copy.title}</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">{copy.body}</p>
      </div>
      {/* base-ui composes via `render`, not Radix's `asChild`. `nativeButton`
          must be false when the rendered element is an anchor — otherwise
          base-ui applies button semantics to a link, which it warns about and
          which would mislead assistive technology about what this control does
          (it navigates; it does not submit). */}
      <Button className="mt-2 h-11 px-6" nativeButton={false} render={<Link href="/solicitud" />}>
        {t("startOver")}
      </Button>
    </div>
  );
}
