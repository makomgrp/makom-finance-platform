import { NextResponse, type NextRequest } from "next/server";
import { getLocale } from "next-intl/server";
import { requireCapability } from "@/lib/auth/authorize";
import { getReportingComparison } from "@/lib/services/reporting";
import { getProfiles } from "@/lib/services/profiles";
import { resolvePeriodFromParams } from "@/lib/reporting/period-params";
import {
  executiveReportFilename,
  renderExecutiveReport,
} from "@/lib/reporting/pdf/executive-report";
import { DEFAULT_LOCALE, isLocale } from "@/i18n/config";

/**
 * ============================================================================
 * MILESTONE 26B-26E — LA DESCARGA DEL INFORME EJECUTIVO
 * ============================================================================
 *
 * Un Route Handler y no una Server Action, por una razón mecánica: el navegador
 * tiene que recibir BYTES con `Content-Disposition` para que el archivo se
 * descargue. Una Server Action devuelve datos a React, no un fichero.
 *
 * ----------------------------------------------------------------------------
 * LA MISMA PUERTA QUE EL DASHBOARD, NO UNA PARECIDA
 * ----------------------------------------------------------------------------
 * `requireCapability("analytics:view")` es lo primero que ocurre, antes de leer
 * un solo parámetro. Ocultar el botón no protege nada: esta URL se puede pegar
 * en la barra de direcciones, y quien no tenga la capacidad recibe un 403 sin
 * haber tocado la base de datos.
 *
 * ORDEN DELIBERADO — autorizar primero, validar después. Es la misma regla que
 * siguen todas las Server Actions de este proyecto: validar antes permitiría a
 * un no autorizado distinguir un período mal formado de uno correcto y sondear
 * el comportamiento del sistema.
 *
 * ----------------------------------------------------------------------------
 * EL CLIENTE NO ENVÍA NI UNA CIFRA
 * ----------------------------------------------------------------------------
 * Los únicos parámetros que se leen son el período — y se validan con
 * `resolvePeriodFromParams`, el MISMO analizador que usa el Dashboard, no una
 * copia. Ningún monto, recuento ni tasa viaja en la petición: todo se resuelve
 * en el servidor con `getReportingComparison`.
 *
 * Eso es lo que hace que el mismo período dé el mismo número en SQL, en
 * pantalla y en papel. Si el navegador pudiera aportar una cifra, el PDF
 * dejaría de ser evidencia de nada.
 *
 * ----------------------------------------------------------------------------
 * NO SE PERSISTE NADA
 * ----------------------------------------------------------------------------
 * Se genera bajo demanda y se entrega. Sin Storage, sin tabla de informes, sin
 * copia en disco. Guardar versiones es 26B-26G y merece su propia decisión
 * sobre retención; adelantarla aquí dejaría copias de datos de negocio en un
 * sitio que nadie eligió.
 */
export async function GET(request: NextRequest) {
  // 1. AUTORIZAR. Antes de leer parámetros, antes de tocar la base.
  const auth = await requireCapability("analytics:view");
  if (auth.status === "denied") {
    // Sin detalle de qué capacidad falta ni de quién la tiene: un fallo de
    // autorización no puede convertirse en un canal de información.
    return NextResponse.json(
      { error: auth.code },
      { status: auth.code === "UNAUTHENTICATED" ? 401 : 403 }
    );
  }

  // 2. VALIDAR EL PERÍODO con el analizador compartido. Un parámetro hostil o
  //    ilegible cae al mes en curso en lugar de romper la descarga.
  const params = request.nextUrl.searchParams;
  const selection = resolvePeriodFromParams({
    periodo: params.get("periodo") ?? undefined,
    desde: params.get("desde") ?? undefined,
    hasta: params.get("hasta") ?? undefined,
  });

  const resolvedLocale = await getLocale();
  const locale = isLocale(resolvedLocale) ? resolvedLocale : DEFAULT_LOCALE;

  // 3. LEER LAS MÉTRICAS. La misma función que alimenta el Dashboard.
  const [reporting, profiles] = await Promise.all([
    getReportingComparison(selection.period),
    getProfiles(),
  ]);

  if (reporting.status !== "ok") {
    // UN INFORME DE CEROS SERÍA PEOR QUE NINGÚN INFORME. Un PDF que dice «0
    // solicitudes» porque la consulta falló es indistinguible de un mes malo, y
    // se archiva y se cita igual.
    return NextResponse.json({ error: "REPORT_UNAVAILABLE" }, { status: 503 });
  }

  const nameByProfileId: Record<string, string> = {};
  if (profiles.status === "ok") {
    for (const user of profiles.users) nameByProfileId[user.id] = user.fullName;
  }

  try {
    const pdf = await renderExecutiveReport({
      data: reporting.data,
      locale,
      nameByProfileId,
    });

    const filename = executiveReportFilename(
      selection.period.from,
      selection.period.to,
      locale
    );

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        // `filename` ya viene saneado a `[A-Za-z0-9._-]`, así que no puede
        // romper la cabecera con una comilla ni un salto de línea.
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(pdf.byteLength),
        // Un informe de gestión no se cachea: los datos cambian y una copia
        // intermedia serviría cifras viejas con aspecto de recién generadas.
        "Cache-Control": "no-store, must-revalidate",
      },
    });
  } catch (error) {
    // Nada del error llega al cliente: una traza puede contener rutas del
    // servidor y detalles internos. Al registro sí, para poder arreglarlo.
    console.error(
      "[executive report] PDF generation failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json({ error: "REPORT_RENDER_FAILED" }, { status: 500 });
  }
}
