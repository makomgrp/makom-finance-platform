import { NextResponse, type NextRequest } from "next/server";
import { requireCapability } from "@/lib/auth/authorize";
import { generateMonthlyClosure } from "@/lib/services/monthly-closures";
import { parseMonthlyPeriodKey } from "@/lib/reporting/closures/period";

/**
 * ============================================================================
 * MILESTONE 26B-26G — CERRAR UN MES QUE EL AUTOMATISMO NO CERRÓ
 * ============================================================================
 *
 * Dos usos, y son el mismo acto:
 *
 *   * el CIERRE INICIAL de agosto de 2026, el mes que terminó antes de que este
 *     sistema existiera;
 *   * el REINTENTO cuando el cron del día 1 no llegue a ejecutarse — la propia
 *     documentación de Vercel avisa de que la entrega es *best effort* y de que
 *     no hay reintento automático.
 *
 * ----------------------------------------------------------------------------
 * NO ES UNA REEMISIÓN
 * ----------------------------------------------------------------------------
 * No puede sobrescribir nada. Si el mes ya está cerrado devuelve
 * `already_closed` y no toca la fila, no la recalcula y no escribe un segundo
 * evento de auditoría. Un cierre existente es historia, y la historia no se
 * reemite. Rehacer un cierre mal generado sería una decisión de negocio con su
 * propio rastro, y no existe en este milestone.
 *
 * ----------------------------------------------------------------------------
 * POR QUÉ NO HAY BOTÓN
 * ----------------------------------------------------------------------------
 * Es una operación de excepción, no de uso diario: lo normal es que el
 * automatismo funcione y nadie tenga que entrar aquí. Un control permanente en
 * pantalla invitaría a pulsarlo «por si acaso» sobre meses ya cerrados.
 *
 * ----------------------------------------------------------------------------
 * ACTOR HUMANO, DE VERDAD
 * ----------------------------------------------------------------------------
 * Lo ejecuta una persona, así que el cierre se marca `bootstrap` con su perfil
 * y se registra en `crm_events` como acción humana. Es la otra mitad de la
 * decisión de 26B-26G.1: el cron no finge ser una persona, y una persona no se
 * esconde detrás del sistema.
 *
 * POST y no GET: escribe un registro histórico permanente, y eso no debe poder
 * dispararse desde una URL pegada en la barra de direcciones ni precargarse.
 */
export async function POST(request: NextRequest) {
  // 1. AUTORIZAR primero. Misma puerta que los informes de gestión: es la
  //    población que puede ver estas cifras. No se amplía ninguna capacidad.
  const auth = await requireCapability("analytics:view");
  if (auth.status === "denied") {
    return NextResponse.json(
      { error: auth.code },
      { status: auth.code === "UNAUTHENTICATED" ? 401 : 403 }
    );
  }

  // 2. El mes, explícito. Aquí no se adivina: quien cierra un mes a mano tiene
  //    que decir cuál, para que no dependa de la fecha en que lo pulse.
  const requested = request.nextUrl.searchParams.get("periodo") ?? "";
  const month = parseMonthlyPeriodKey(requested);
  if (!month) {
    return NextResponse.json({ error: "INVALID_PERIOD" }, { status: 400 });
  }

  const result = await generateMonthlyClosure({
    month,
    generationKind: "bootstrap",
    actorProfileId: auth.profile.id,
  });

  if (result.status === "failed") {
    console.error("[monthly closure bootstrap]", month.periodKey, "-", result.reason);
    // 409 para un mes que aún no ha terminado —es un error de quien pide, no
    // del servidor— y 503 cuando la capa de reporting no pudo responder.
    const status = result.reason === "period_not_ended" || result.reason === "invalid_period" ? 409 : 503;
    return NextResponse.json(
      { status: "failed", periodKey: month.periodKey, reason: result.reason },
      { status }
    );
  }

  return NextResponse.json(
    {
      status: result.status,
      periodKey: result.closure.periodKey,
      periodStart: result.closure.periodStart,
      periodEnd: result.closure.periodEnd,
      generatedAt: result.closure.generatedAt,
      generationKind: result.closure.generationKind,
      generatedByKind: result.closure.generatedByKind,
      schemaVersion: result.closure.schemaVersion,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
