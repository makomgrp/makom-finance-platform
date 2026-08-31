import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { evaluatePortalProgress } from "@/lib/services/portal-progress";
import { getApplicationIntakeById } from "@/lib/services/application-intakes";
import type { PortalStep } from "@/types";

/**
 * ============================================================================
 * MILESTONE 26B-26B — ESCRIBIR EL RECORRIDO MIENTRAS OCURRE
 * ============================================================================
 *
 * 26B-26A dejó el problema en una frase: `current_step` se sobrescribe, así que
 * el CRM sabe dónde está cada solicitante y no sabe por dónde pasó. Y eso no se
 * arregla más tarde — un dato que nunca se guardó no se reconstruye.
 *
 * ----------------------------------------------------------------------------
 * NADA DE LO QUE HAY AQUÍ PUEDE ROMPER EL FORMULARIO
 * ----------------------------------------------------------------------------
 * Todas estas llamadas son telemetría. Un fallo al registrar que alguien llegó
 * al Paso 3 no puede impedirle llegar al Paso 3. Por eso cada función devuelve
 * void, registra el error en el servidor y sigue; y por eso los llamadores las
 * invocan dentro de `after()`, después de que la respuesta ya salió. La medición
 * observa el proceso, no participa en él.
 *
 * ----------------------------------------------------------------------------
 * LA IDEMPOTENCIA NO ESTÁ EN ESTE ARCHIVO
 * ----------------------------------------------------------------------------
 * Vive en un índice único parcial y en `on conflict do nothing`, dentro de la
 * base. Aquí no hay ningún "¿ya existe?" antes de insertar, a propósito: esa
 * comprobación deja pasar duplicados en cuanto dos peticiones llegan a la vez,
 * que es justo lo que hace un doble clic o un reintento de red.
 *
 * La consecuencia práctica es que estas funciones pueden llamarse de más sin
 * pensarlo. `recordCompletedSteps` no compara con el estado anterior: manda
 * TODOS los pasos completos ahora mismo y deja que el índice se quede con la
 * primera vez de cada uno. El evento acaba fechado en la primera escritura tras
 * la cual el paso estaba completo, que es exactamente lo que significa.
 */

/**
 * "Esta persona llegó a la pantalla de este paso."
 *
 * Se llama desde el RENDER de la página del paso, no desde la escritura, y esa
 * es toda la diferencia entre `reached` y `completed`. Si solo se registrara al
 * guardar, no habría manera de saber que cinco personas vieron el Paso 3 y solo
 * dos lo terminaron — que es precisamente la métrica de abandono que ODL pidió.
 *
 * Registrar desde un render es seguro aquí por dos motivos concretos, ambos
 * verificados: las páginas del portal ya escriben en la base al renderizar
 * (`redeem_public_application_token` actualiza `last_used_at`), y la navegación
 * entre pasos es `router.push` y `<a href>` — nunca `<Link>` —, así que Next.js
 * no prefetchea ninguna ruta de paso y nadie queda registrado en una pantalla
 * que no visitó.
 */
export async function recordStepReached(intakeId: string, step: PortalStep): Promise<void> {
  await recordFunnelEvent(intakeId, "portal_step_reached", step);
}

/**
 * "Las reglas de este paso quedaron satisfechas."
 *
 * NO reimplementa qué significa completo. Llama a `evaluatePortalProgress`, el
 * mismo evaluador que decide a qué paso mandar a un solicitante que vuelve y
 * que dibuja su barra de progreso. Una segunda definición de "completo" acabaría
 * discrepando de la primera, y el informe diría una cosa mientras la pantalla
 * dice otra.
 *
 * DOS CONSECUENCIAS QUE HAY QUE CONOCER AL LEER ESTOS DATOS:
 *
 *   * `documents` incluye las declaraciones (PEP, origen de fondos,
 *     consentimiento), porque `isStep3Complete` siempre las exigió. Es una
 *     particularidad heredada, no algo que este milestone haya introducido, y se
 *     respeta en vez de corregirse por la puerta de atrás: cambiarla movería a
 *     dónde se envía a los solicitantes que ahora mismo están a medias.
 *
 *   * El evento es un HITO, no un estado. Si un paso se completa y luego deja de
 *     estarlo — se retira un fiador, se sustituye un documento — el evento sigue
 *     ahí, porque el hecho ocurrió. Para saber cómo está algo AHORA se pregunta
 *     a `evaluatePortalProgress`, nunca a esta tabla.
 */
export async function recordCompletedSteps(intakeId: string): Promise<void> {
  try {
    const intakeResult = await getApplicationIntakeById(intakeId);
    if (intakeResult.status !== "ok") return;

    const progress = await evaluatePortalProgress(intakeResult.intake);
    if (progress.status !== "ok") return;

    for (const step of progress.progress.completedSteps) {
      await recordFunnelEvent(intakeId, "portal_step_completed", step);
    }
  } catch (error) {
    console.error(
      "[portal-funnel-events service] Failed to record completed steps:",
      error instanceof Error ? error.message : "unknown error"
    );
  }
}

/**
 * El único punto de escritura. `record_portal_funnel_event` rechaza
 * `portal_resumed` a propósito: una reanudación no se observa, se deduce del
 * hueco de inactividad, y solo puede deducirla `record_portal_activity`, que
 * tiene la fila del intake bloqueada. Esta función no puede fabricar una.
 */
async function recordFunnelEvent(
  intakeId: string,
  eventType: "portal_step_reached" | "portal_step_completed",
  step: PortalStep
): Promise<void> {
  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.rpc("record_portal_funnel_event", {
      p_intake_id: intakeId,
      p_event_type: eventType,
      p_step: step,
    });
    if (error) {
      console.error("[portal-funnel-events service] Failed to record event:", error.message);
    }
  } catch (error) {
    console.error(
      "[portal-funnel-events service] Unexpected failure recording event:",
      error instanceof Error ? error.message : "unknown error"
    );
  }
}
