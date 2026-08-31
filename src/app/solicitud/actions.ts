"use server";

import { getAllProducts } from "@/lib/services/products";
import { ensureContinuationToken, savePortalStepOne } from "@/lib/services/portal-step-one";
import { authorizePortalWrite } from "@/lib/services/portal-snapshot";
import { getLocale } from "next-intl/server";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@/i18n/config";
import { sanitizeAttribution } from "@/lib/validation/attribution";
import {
  validatePortalStepOne,
  type PortalStepOneField,
  type PortalStepOneFieldErrorCode,
} from "@/lib/validation/portal-step-one";

/**
 * ============================================================================
 * THE PORTAL'S ONLY WRITE (26B-1)
 * ============================================================================
 *
 * A Server Action rather than a Route Handler, on purpose:
 *
 *   * Next.js gives Server Actions built-in Origin checking, which is exactly
 *     the protection the 15C route had to implement by hand. Using the
 *     framework's own mechanism is stronger than re-deriving it.
 *   * The action runs on the server, so no Supabase key — publishable or
 *     secret — is ever part of the client bundle. The browser posts a plain
 *     object and gets a plain result.
 *
 * THE CLIENT DOES NOT NAME TABLES OR COLUMNS. The payload is a fixed set of
 * Step 1 fields, read key by key by the validator and handed to one named
 * service function. There is no path from this input to an arbitrary mutation.
 *
 * ----------------------------------------------------------------------------
 * THE CLIENT ALSO DOES NOT NAME THE ROW IT WRITES TO
 * ----------------------------------------------------------------------------
 * An earlier draft of this action accepted an `intakeId` straight from the
 * browser and updated that lead. That was wrong, and a security test during
 * 26B-1 caught it: anyone who guessed or obtained an intake UUID could have
 * overwritten another applicant's name, email, phone, product and amount.
 *
 * The row is now identified ONLY by resolving the continuation token
 * server-side through `authorizePortalWrite` (26A-4), which returns the intake
 * that token owns and nothing else. A caller cannot aim this action at a lead
 * they do not hold a token for, because the id never travels inbound.
 *
 * Sending the token itself from the browser adds no exposure: it is already in
 * the address bar of the page the customer is looking at.
 *
 * WHAT IS NOT REPEATED HERE: no Client matching, no Application creation, no
 * numbering, no product catalog. This is an adapter — validate, delegate,
 * translate the result — exactly the discipline the 15C public route follows.
 */

export type PortalStepOneActionResult =
  // No intake id comes back — the browser has no use for one, and a value that
  // is never sent cannot be replayed, logged or shared.
  //
  // The continuation TOKEN does come back, because Step 2 lives under it
  // (/solicitud/continuar/<token>/paso-2) and the browser has to be able to go
  // there. It is the same credential the address bar already holds on a resume.
  | {
      status: "ok";
      outcome: "saved_lead" | "application_created" | "needs_review";
      continuationToken?: string;
    }
  | { status: "invalid"; fieldErrors: Partial<Record<PortalStepOneField, PortalStepOneFieldErrorCode>> }
  | { status: "error"; code: "PRODUCT_LOCKED" | "INTAKE_NOT_FOUND" | "SAVE_FAILED" };

export interface PortalStepOnePayload {
  fullName: string;
  phone: string;
  email: string;
  identificationType: string;
  identificationNumber: string;
  productCode: string;
  requestedAmount: string;
  /** Optional (26B-1B). Empty string means "not chosen yet". */
  requestedTermMonths: string;
  /** Stable per form instance — the double-click guard. */
  submissionId: string;
  /**
   * Present only when the customer arrived through a continuation link. The
   * SERVER resolves this to an intake; the browser never names one.
   */
  continuationToken?: string;
  /** Honeypot. A real customer never sees or fills this. */
  website?: string;
  /**
   * MILESTONE 26B-26B.1 — la atribución que el servidor leyó al renderizar la
   * página, devuelta con el envío.
   *
   * VIAJA POR EL NAVEGADOR PORQUE NO HAY OTRO SITIO DONDE PONERLA. La campaña
   * está en la URL cuando la persona ABRE el formulario; el intake nace cuando
   * lo ENVÍA, en otra petición que ya no tiene esa URL. Las alternativas eran
   * peores: una cookie de marketing plantea una decisión de consentimiento que
   * ODL no ha tomado, y crear una fila al abrir la página convertiría cada bot
   * y cada visita en un lead.
   *
   * Que el navegador pueda alterar su propia atribución no es una debilidad que
   * esto introduzca: la atribución ES la URL con la que esa persona llegó, y
   * cualquiera puede escribir la URL que quiera. Lo que el sistema sí garantiza
   * es que nadie toque la atribución de OTRO solicitante — se escribe solo al
   * crear el lead, y la base la vuelve inmutable a partir de ahí.
   *
   * Se vuelve a sanear abajo. `unknown` a propósito: nada tipado debe sugerir
   * que lo que llega aquí ya está limpio.
   */
  attribution?: unknown;
}

export async function submitPortalStepOne(
  payload: PortalStepOnePayload
): Promise<PortalStepOneActionResult> {
  // HONEYPOT, preserved from the 15C endpoint. Answer exactly like a success
  // and touch nothing — never tell a bot what tripped it. The returned id is a
  // throwaway; no lead exists behind it.
  if (typeof payload?.website === "string" && payload.website.trim() !== "") {
    return { status: "ok", outcome: "saved_lead" };
  }

  const productsResult = await getAllProducts();
  if (productsResult.status !== "ok") {
    // A genuine infrastructure failure. Nothing was written, so nothing may be
    // reported as saved.
    console.error("[portal step-one action] Failed to load products for validation");
    return { status: "error", code: "SAVE_FAILED" };
  }

  // THE AUTHORITATIVE CATALOG, not a copy. Only currently-active products with
  // an official N/D/V/E code are acceptable, so a stale code from an old
  // website link cannot open an application against a retired product.
  const offerable = productsResult.products.filter(
    (p) => p.status === "active" && p.applicationCode
  );
  const activeProductCodes = new Set(offerable.map((p) => p.applicationCode!));

  const validation = validatePortalStepOne(payload, activeProductCodes);
  if (validation.status === "error") {
    return { status: "invalid", fieldErrors: validation.fieldErrors };
  }

  // TWO VOCABULARIES, ONE TRANSLATION POINT.
  //
  // Customers, the ODL website and this portal speak N/D/V/E. The intake table
  // and the 15B engine have always stored the internal product SLUG
  // ("payroll_deduction"). Rather than changing the engine's vocabulary — which
  // would touch every existing intake row — the mapping happens here, once, on
  // the way in. The letter never reaches the database and the slug never
  // reaches the browser.
  const product = offerable.find((p) => p.applicationCode === validation.value.productCode);
  if (!product) {
    // Only reachable if the catalog changed between the validation above and
    // this lookup. Reported as a field error so the customer simply picks
    // again, rather than as a failure of their whole submission.
    return { status: "invalid", fieldErrors: { productCode: "INVALID_PRODUCT" } };
  }

  // Resolve the lead the caller is ENTITLED to write to. No token means this
  // is a fresh application and savePortalStepOne creates a new lead.
  let intakeId: string | undefined;
  if (payload.continuationToken) {
    const authorized = await authorizePortalWrite(payload.continuationToken);
    if (authorized.status !== "ok") {
      // Expired, revoked, unknown, or already submitted. All report the same
      // thing to the customer: this link can no longer be edited.
      return { status: "error", code: "INTAKE_NOT_FOUND" };
    }
    intakeId = authorized.intakeId;
  }

  // MILESTONE 26B-17 — capture the language, once, on the server.
  //
  // Read here rather than accepted from the payload: the browser must not get
  // to choose what language ODL writes to this person in, and next-intl already
  // resolves the same cookie the rest of the request rendered from. Persisted
  // by savePortalStepOne so a resend days later — when no cookie exists — still
  // knows the answer.
  const locale = (await getLocale()) as Locale;

  const saved = await savePortalStepOne({
    ...validation.value,
    productCode: product.code,
    submissionId: payload.submissionId,
    intakeId,
    locale: isLocale(locale) ? locale : DEFAULT_LOCALE,
    // MILESTONE 26B-26B.1 — SANEADO AQUÍ, que es donde importa.
    //
    // La página ya lo saneó al leerlo, para no escribir nunca un valor sucio en
    // el HTML. Esta segunda pasada es la que de verdad protege la base: lo que
    // llega en el payload viene del navegador y podría ser cualquier cosa —una
    // URL entera con un token, una ruta con un correo—, y de aquí sale
    // recortado, en minúsculas y sin query ni fragmento.
    //
    // Solo se manda cuando NO hay `intakeId`. Con un lead ya existente esto es
    // una reanudación, y `savePortalStepOne` lo ignoraría de todos modos; no
    // enviarlo hace visible la intención en el punto de llamada en vez de
    // dejarla escondida dos archivos más abajo.
    attribution: intakeId ? undefined : sanitizeAttribution(payload.attribution),
  });

  if (saved.status === "error") {
    return { status: "error", code: saved.code };
  }

  // REUSE THE TOKEN THE CUSTOMER ARRIVED WITH. Issuing a fresh one on every
  // save would rotate — and therefore revoke — the link already sitting in
  // their email, breaking it a little more each time they edited a field.
  // A brand-new application gets its first token here.
  const continuationToken =
    payload.continuationToken ?? (await ensureContinuationToken(saved.intakeId));

  return { status: "ok", outcome: saved.status, continuationToken };
}
