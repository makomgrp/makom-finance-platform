import { NextResponse, type NextRequest } from "next/server";
import { getLocale } from "next-intl/server";
import { requireCapability } from "@/lib/auth/authorize";
import { getReportingComparison } from "@/lib/services/reporting";
import {
  getDetailedExportData,
  recordSensitiveExportEvent,
} from "@/lib/services/reporting-export";
import { getProfiles } from "@/lib/services/profiles";
import { resolvePeriodFromParams } from "@/lib/reporting/period-params";
import { exportRowCounts } from "@/lib/reporting/export-types";
import { renderDetailedExport } from "@/lib/reporting/excel/workbook";
import { detailedExportFilename } from "@/lib/reporting/excel/filename";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/config";

/**
 * ============================================================================
 * MILESTONE 26B-26F — LA DESCARGA DEL EXTRACTO DETALLADO
 * ============================================================================
 *
 * El archivo más sensible que ODL produce: nombres, cédulas, teléfonos, correos,
 * empresas y salarios de personas reales, en un formato pensado para copiarse.
 *
 * ----------------------------------------------------------------------------
 * SU PROPIA PUERTA, NO LA DEL DASHBOARD
 * ----------------------------------------------------------------------------
 * `requireCapability("reports:export_sensitive")` — NO `analytics:view`. Ver la
 * capacidad en `lib/auth/capabilities.ts`: «cuántas solicitudes hubo» y «dame
 * los datos de cada solicitante» son dos preguntas distintas, y la diferencia
 * entre ellas es toda la PII de la empresa. Hoy las tienen los mismos dos roles;
 * mañana no tienen por qué, y con una sola capacidad eso sería un rediseño.
 *
 * Es LO PRIMERO que ocurre, antes de leer un parámetro. Ocultar el botón no
 * protege nada: esta URL se puede pegar en la barra de direcciones.
 *
 * ----------------------------------------------------------------------------
 * SIN AUDITORÍA NO HAY DESCARGA
 * ----------------------------------------------------------------------------
 * El evento se escribe ANTES de entregar los bytes, y si falla la respuesta es
 * 503 y el archivo no sale.
 *
 * Podría haberse hecho al revés —entregar y registrar después con `after()`—, y
 * habría sido más cómodo. Se descartó a propósito: la trazabilidad ES el control
 * de esta capacidad. Un extracto de PII que sale sin dejar rastro, porque el
 * registro falló en segundo plano, es exactamente el caso que nadie descubre
 * hasta que hace falta responder «¿quién se llevó esto?». Un fallo de auditoría
 * es un fallo de la exportación.
 *
 * ----------------------------------------------------------------------------
 * EL CLIENTE NO APORTA NI UN DATO
 * ----------------------------------------------------------------------------
 * Los únicos parámetros que se leen son los del período, validados con
 * `resolvePeriodFromParams` —el MISMO analizador del Dashboard y del PDF, no una
 * copia—. Todo lo demás se resuelve en el servidor. Nada de la PII pasa por el
 * navegador: el libro se arma aquí y se entrega hecho.
 *
 * ----------------------------------------------------------------------------
 * NO SE PERSISTE NADA
 * ----------------------------------------------------------------------------
 * Bajo demanda y a memoria. Sin Storage, sin tabla de exportaciones, sin copia
 * en disco. Guardar el archivo sería crear el depósito de datos personales que
 * todo lo anterior se ocupa de no crear.
 */
export async function GET(request: NextRequest) {
  // 1. AUTORIZAR. Antes de leer parámetros, antes de tocar la base.
  const auth = await requireCapability("reports:export_sensitive");
  if (auth.status === "denied") {
    // Sin detalle de qué capacidad falta ni de quién la tiene: un fallo de
    // autorización no puede convertirse en un canal de información.
    return NextResponse.json(
      { error: auth.code },
      { status: auth.code === "UNAUTHENTICATED" ? 401 : 403 }
    );
  }

  // 2. VALIDAR EL PERÍODO con el analizador compartido.
  const params = request.nextUrl.searchParams;
  const selection = resolvePeriodFromParams({
    periodo: params.get("periodo") ?? undefined,
    desde: params.get("desde") ?? undefined,
    hasta: params.get("hasta") ?? undefined,
  });

  const resolvedLocale = await getLocale();
  const locale = isLocale(resolvedLocale) ? resolvedLocale : DEFAULT_LOCALE;

  // 3. LEER. Agregados y detalle en paralelo, cada uno de su capa: los totales
  //    de la misma función que pinta el Dashboard, las filas de la capa de
  //    detalle. Ninguna de las dos recalcula lo de la otra.
  const [reporting, detail, profiles] = await Promise.all([
    getReportingComparison(selection.period),
    getDetailedExportData(selection.period),
    getProfiles(),
  ]);

  if (reporting.status !== "ok" || detail.status !== "ok") {
    // UN LIBRO INCOMPLETO SERÍA PEOR QUE NINGUNO. Un Excel con la hoja de
    // solicitudes vacía porque una consulta se cayó es indistinguible de un mes
    // sin solicitudes, y se archiva y se cita igual.
    return NextResponse.json({ error: "EXPORT_UNAVAILABLE" }, { status: 503 });
  }

  const nameByProfileId: Record<string, string> = {};
  if (profiles.status === "ok") {
    for (const user of profiles.users) nameByProfileId[user.id] = user.fullName;
  }

  // 4. AUDITAR. Antes de entregar nada. Ver la nota de cabecera.
  const audited = await recordSensitiveExportEvent({
    actorProfileId: auth.profile.id,
    format: "xlsx",
    periodKind: selection.period.kind,
    periodFrom: selection.period.from,
    periodTo: selection.period.to,
    rowCounts: exportRowCounts(detail.data),
  });

  if (!audited) {
    return NextResponse.json({ error: "EXPORT_AUDIT_FAILED" }, { status: 503 });
  }

  try {
    const workbook = await renderDetailedExport({
      reporting: reporting.data,
      detail: detail.data,
      locale,
      nameByProfileId,
    });

    const filename = detailedExportFilename(
      selection.period.from,
      selection.period.to,
      locale
    );

    return new NextResponse(new Uint8Array(workbook), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        // `filename` ya viene saneado a `[A-Za-z0-9._-]`, así que no puede
        // romper la cabecera con una comilla ni un salto de línea.
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(workbook.byteLength),
        // Datos personales no se cachean en ningún sitio: ni en el navegador,
        // ni en un proxy, ni en el CDN. Una copia intermedia de este archivo
        // sería una filtración con fecha de caducidad.
        "Cache-Control": "no-store, must-revalidate",
      },
    });
  } catch (error) {
    // Nada del error llega al cliente: una traza puede contener rutas del
    // servidor y detalles internos. Al registro sí, para poder arreglarlo.
    console.error(
      "[detailed export] workbook generation failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json({ error: "EXPORT_RENDER_FAILED" }, { status: 500 });
  }
}
