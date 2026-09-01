import { NextResponse } from "next/server";
import { getLocale } from "next-intl/server";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { EMPTY_BRANCH_SCOPE } from "@/lib/services/branch-scope-query";
import { getApplicationListItemById } from "@/lib/services/applications";
import { getApplicationStep2 } from "@/lib/services/application-step2";
import { getApplicationDeclarations } from "@/lib/services/application-declarations";
import { getRequirementSlotsByApplicationId } from "@/lib/services/requirement-slots";
import { getEvidenceByApplicationId } from "@/lib/services/document-evidence";
import { getClientById } from "@/lib/services/clients";
import { getApplicationReview } from "@/lib/services/application-review";
import { isStaffManageableApplication } from "@/types";
import { renderApplicationDossierPdf } from "@/lib/reporting/pdf/application-dossier";
import { applicationDossierFilename } from "@/lib/reporting/pdf/dossier-filename";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/config";

/**
 * ============================================================================
 * MILESTONE 26B-27A — LA DESCARGA DEL EXPEDIENTE
 * ============================================================================
 *
 * ----------------------------------------------------------------------------
 * LA MISMA PUERTA QUE LA PANTALLA, LITERALMENTE
 * ----------------------------------------------------------------------------
 * Esta ruta NO usa `requireCapability`, y no es un olvido: el expediente
 * tampoco. Su autorización es el ALCANCE DE SUCURSAL del perfil, y la decidió
 * 26B-5 así a propósito — quién puede ver un expediente no depende de una
 * capacidad sino de si ese caso pertenece a su sucursal.
 *
 * Inventar aquí una capacidad nueva habría creado dos reglas para la misma
 * pregunta: una persona podría abrir la pantalla y no poder imprimirla, o al
 * revés. Así que este handler repite los MISMOS TRES PASOS de
 * `solicitudes/[applicationId]/page.tsx`, en el mismo orden:
 *
 *   1. resolver el perfil y su alcance;
 *   2. `getApplicationListItemById(scope, id)` — fuera de alcance es NOT_FOUND;
 *   3. `isStaffManageableApplication` — un borrador del portal no es un
 *      expediente interno y sigue siendo invisible.
 *
 * Si un día cambia la regla de la pantalla, hay que cambiarla aquí también, y
 * hay una prueba que compara los dos ficheros para que no se olvide.
 *
 * ----------------------------------------------------------------------------
 * 404 PARA TODO LO QUE NO SE PUEDE VER
 * ----------------------------------------------------------------------------
 * Fuera de alcance, inexistente y borrador del portal devuelven lo mismo. Un
 * 403 distinguible convertiría esta URL en una forma de confirmar que cierto
 * expediente existe en una sucursal que quien pregunta no puede ver.
 *
 * ----------------------------------------------------------------------------
 * NO SE PERSISTE NADA
 * ----------------------------------------------------------------------------
 * Bajo demanda y a memoria. Sin Storage, sin tabla de PDFs, sin enlaces
 * firmados. Es una foto del expediente de hoy: mañana el mismo botón dará otro
 * documento, y esa es la intención.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ applicationId: string }> }
) {
  const { applicationId } = await params;

  // 1. IDENTIDAD Y ALCANCE. `getCurrentProfile` ya falla cerrado ante sesión
  //    ausente, perfil no vinculado y perfil desactivado.
  const profile = await getCurrentProfile();
  if (!profile) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }
  const scope = profile.branchScope ?? EMPTY_BRANCH_SCOPE;

  // 2. ¿PUEDE ESTA PERSONA VER ESTE EXPEDIENTE? Misma consulta con alcance que
  //    la página; un caso fuera de su sucursal ya vuelve como NOT_FOUND.
  const applicationResult = await getApplicationListItemById(scope, applicationId);
  if (applicationResult.status !== "ok") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }
  const application = applicationResult.application;

  // 3. Un borrador del portal —alguien a medio llenar el formulario público—
  //    no es un expediente interno y no se imprime.
  if (!isStaffManageableApplication(application)) {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const resolvedLocale = await getLocale();
  const locale = isLocale(resolvedLocale) ? resolvedLocale : DEFAULT_LOCALE;

  // 4. LOS MISMOS SEIS CARGADORES QUE LA PANTALLA, en paralelo. Ninguna consulta
  //    nueva: si el PDF mostrara algo que la pantalla no muestra, sería un
  //    segundo expediente con sus propias reglas.
  const [step2Result, declarationsResult, slotsResult, evidenceResult, clientResult, reviewResult] =
    await Promise.all([
      getApplicationStep2(scope, application.id),
      getApplicationDeclarations(application.id),
      getRequirementSlotsByApplicationId(scope, application.id),
      getEvidenceByApplicationId(scope, application.id),
      getClientById(scope, application.clientId),
      getApplicationReview(scope, application.id),
    ]);

  try {
    const pdf = await renderApplicationDossierPdf({
      application,
      client: clientResult.status === "ok" ? clientResult.client : undefined,
      step2: step2Result.status === "ok" ? step2Result.step2 : undefined,
      declarations:
        declarationsResult.status === "ok" ? declarationsResult.declarations : undefined,
      requirementSlots: slotsResult.status === "ok" ? slotsResult.requirementSlots : [],
      evidence: evidenceResult.status === "ok" ? evidenceResult.evidence : [],
      review: reviewResult.status === "ok" ? reviewResult.review : undefined,
      locale,
    });

    const filename = applicationDossierFilename(
      { applicationNumber: application.applicationNumber, applicationId: application.id },
      locale
    );

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        // `filename` viene saneado a `[A-Za-z0-9._-]` y sin un solo dato
        // personal: no puede romper la cabecera ni delatar al titular.
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(pdf.byteLength),
        // Un expediente con datos personales no se cachea en ningún sitio: ni
        // en el navegador, ni en un proxy, ni en el CDN.
        "Cache-Control": "private, no-store, must-revalidate",
      },
    });
  } catch (error) {
    // NI UN DATO DEL EXPEDIENTE EN EL REGISTRO. Solo el identificador técnico y
    // el mensaje del error: una traza puede arrastrar el contenido que se
    // estaba imprimiendo, que es justo lo que no debe acabar en los logs.
    console.error(
      "[application dossier pdf] generation failed for",
      applicationId,
      "-",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json({ error: "PDF_RENDER_FAILED" }, { status: 500 });
  }
}
