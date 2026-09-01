import { NextResponse, type NextRequest } from "next/server";
import { generateMonthlyClosure } from "@/lib/services/monthly-closures";
import { previousPanamaMonth } from "@/lib/reporting/closures/period";

/**
 * ============================================================================
 * MILESTONE 26B-26G — EL CIERRE AUTOMÁTICO DEL DÍA 1
 * ============================================================================
 *
 * Lo invoca Vercel Cron el día 1 de cada mes a las 06:00 UTC, que son las 01:00
 * en Panamá. Ver `vercel.json`.
 *
 * ----------------------------------------------------------------------------
 * EL MES SE RESUELVE, NO SE LEE DEL CRON
 * ----------------------------------------------------------------------------
 * El handler pregunta «¿cuál fue el mes anterior en Panamá?» en vez de confiar
 * en la fecha textual de la invocación. Dos razones concretas:
 *
 *   * la entrega de Vercel Cron es *best effort* y puede fallar; un reintento
 *     manual el día 3 debe cerrar el mismo mes, no el que toque ese día;
 *   * en el plan Hobby, Vercel puede invocar en cualquier punto de la hora
 *     indicada, así que la hora exacta no es un dato del que dependa nada.
 *
 * `previousPanamaMonth` convierte a hora de Panamá ANTES de mirar el mes. Sin
 * eso, una ejecución a las 02:00 UTC del 1 de septiembre creería que estamos en
 * septiembre cuando en Panamá siguen siendo las 21:00 del 31 de agosto — y
 * cerraría julio.
 *
 * ----------------------------------------------------------------------------
 * FALLA CERRADO
 * ----------------------------------------------------------------------------
 * Sin `CRON_SECRET` configurado, este endpoint NO se abre: responde 401 igual
 * que ante un secreto incorrecto. No hay modo permisivo «mientras se
 * configura», porque esa es exactamente la ventana por la que cualquiera
 * podría disparar la escritura de un registro histórico permanente.
 *
 * Es el mecanismo oficial de Vercel: si la variable existe, la plataforma envía
 * su valor en la cabecera `Authorization` con prefijo `Bearer`.
 *
 * ----------------------------------------------------------------------------
 * IDEMPOTENTE
 * ----------------------------------------------------------------------------
 * Vercel puede invocar la misma ejecución más de una vez. Dos llamadas
 * simultáneas terminan con UN cierre: lo decide la clave única del período
 * dentro de la RPC, no este handler.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  // Comparación tras comprobar que el secreto EXISTE. Si faltara, `Bearer
  // undefined` podría llegar a coincidir con una cabecera fabricada.
  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    // Sin detalle de si falta el secreto o no coincide: un fallo de
    // autorización no puede convertirse en un canal de información.
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const month = previousPanamaMonth();

  const result = await generateMonthlyClosure({
    month,
    // SIEMPRE `scheduled`, SIEMPRE sin actor humano. La RPC rechaza la
    // combinación contraria: un cron no es una persona, y el registro no debe
    // poder decir que lo fue.
    generationKind: "scheduled",
    actorProfileId: null,
  });

  if (result.status === "failed") {
    // 500 y no 200: Vercel no reintenta, pero el fallo tiene que verse en los
    // registros del cron en vez de pasar por una ejecución correcta.
    console.error(
      "[monthly closure cron] no se pudo cerrar",
      month.periodKey,
      "-",
      result.reason
    );
    return NextResponse.json(
      { status: "failed", periodKey: month.periodKey, reason: result.reason },
      { status: 500 }
    );
  }

  // `already_closed` es un 200: es la respuesta CORRECTA a un reintento o a una
  // invocación duplicada, no un error.
  return NextResponse.json(
    {
      status: result.status,
      periodKey: result.closure.periodKey,
      generatedAt: result.closure.generatedAt,
      generationKind: result.closure.generationKind,
      schemaVersion: result.closure.schemaVersion,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
