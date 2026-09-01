import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getReportingSnapshot } from "@/lib/services/reporting";
import { monthHasEnded } from "@/lib/reporting/closures/period";
import { validateClosurePayload } from "@/lib/reporting/closures/validate";
import {
  CLOSURE_SCHEMA_VERSION,
  CURRENT_STATE_FIELDS,
} from "@/lib/reporting/closures/types";
import type { MonthlyPeriod } from "@/lib/reporting/closures/period";
import type {
  MonthlyClosure,
  MonthlyClosurePayload,
  MonthlyClosureResult,
  MonthlyClosureSummary,
} from "@/lib/reporting/closures/types";

/**
 * ============================================================================
 * MILESTONE 26B-26G — GENERAR Y LEER CIERRES
 * ============================================================================
 *
 * `server-only`. La generación no es una operación que un navegador pueda
 * pedir: escribe un registro histórico permanente.
 *
 * ----------------------------------------------------------------------------
 * UNA SOLA FUENTE, LA OFICIAL
 * ----------------------------------------------------------------------------
 * El contenido sale de `getReportingSnapshot`, la MISMA función que alimenta el
 * Dashboard, el PDF y el Excel. Aquí no se cuenta, no se suma y no se promedia
 * nada: un segundo motor de métricas sería una segunda respuesta esperando a
 * discrepar con la primera, y encima congelada para siempre.
 *
 * Se llama UNA vez por cierre. Un cierre al mes: no hace falta ninguna vista
 * materializada, ninguna cola y ningún framework de lotes.
 *
 * ----------------------------------------------------------------------------
 * FALLA ENTERO O NO FALLA
 * ----------------------------------------------------------------------------
 * Si el reporting no responde, no se escribe nada. Un cierre a medias, con la
 * mitad de los bloques en cero porque una consulta se cayó, sería peor que no
 * tenerlo: es inmutable, se archiva y se cita igual — y ya no se puede
 * corregir.
 */

/** El nombre de la RPC, en un sitio: se usa en el generador y en las pruebas. */
const RECORD_RPC = "record_monthly_management_closure";

interface ClosureRow {
  period_key: string;
  period_start: string;
  period_end: string;
  business_time_zone: string;
  generated_at: string;
  generation_kind: string;
  generated_by_kind: string;
  generated_by_profile_id: string | null;
  reporting_schema_version: number;
  payload: MonthlyClosurePayload;
}

function toClosure(row: ClosureRow): MonthlyClosure {
  return {
    periodKey: row.period_key,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    businessTimeZone: row.business_time_zone,
    generatedAt: row.generated_at,
    generationKind: row.generation_kind as MonthlyClosure["generationKind"],
    generatedByKind: row.generated_by_kind as MonthlyClosure["generatedByKind"],
    generatedByProfileId: row.generated_by_profile_id,
    schemaVersion: row.reporting_schema_version,
    payload: row.payload,
  };
}

const CLOSURE_COLUMNS =
  "period_key, period_start, period_end, business_time_zone, generated_at, " +
  "generation_kind, generated_by_kind, generated_by_profile_id, " +
  "reporting_schema_version, payload";

/**
 * Crea el cierre de un mes, o devuelve el que ya existía.
 *
 * ----------------------------------------------------------------------------
 * IDEMPOTENTE, Y NO POR CORTESÍA
 * ----------------------------------------------------------------------------
 * La documentación de Vercel Cron dice dos cosas relevantes: que la entrega es
 * *best effort* y puede **no** ocurrir, y que puede invocar **dos veces** la
 * misma ejecución. Así que un reintento el día 3 tiene que poder crear el mes
 * que faltó, y una doble invocación el día 1 tiene que terminar con un solo
 * cierre.
 *
 * Lo garantiza la base con `on conflict do nothing` sobre la clave única del
 * período, dentro de la RPC. NO se hace `select` y luego `insert`: entre esas
 * dos sentencias caben las dos invocaciones simultáneas.
 *
 * Cuando ya existía, devuelve `already_closed` SIN tocar nada y sin escribir un
 * segundo evento de auditoría — un reintento no debe dejar constancia de una
 * acción humana que no ocurrió.
 */
export async function generateMonthlyClosure(input: {
  month: MonthlyPeriod;
  generationKind: "scheduled" | "bootstrap";
  /** Obligatorio en bootstrap, prohibido en scheduled. La RPC lo reexige. */
  actorProfileId?: string | null;
  now?: Date;
}): Promise<MonthlyClosureResult> {
  const { month, generationKind } = input;
  const now = input.now ?? new Date();

  // 1. UN MES EN CURSO NO SE CIERRA. Un «septiembre» creado el día 12 sería una
  //    fotografía a medias con nombre de mes completo, y nadie que la leyera
  //    después podría saberlo.
  if (!monthHasEnded(month, now)) {
    return { status: "failed", reason: "period_not_ended" };
  }

  // 2. Si ya está cerrado, ni siquiera se consulta el reporting. Ahorra el
  //    trabajo y, sobre todo, deja claro que un reintento no recalcula nada.
  const existing = await getMonthlyClosure(month.periodKey);
  if (existing) return { status: "already_closed", closure: existing };

  // 3. Las cifras oficiales. Una sola llamada.
  const snapshot = await getReportingSnapshot(month.period);
  if (snapshot.status !== "ok") {
    console.error("[monthly closure] reporting unavailable for", month.periodKey);
    return { status: "failed", reason: "reporting_unavailable" };
  }

  const payload: MonthlyClosurePayload = {
    snapshot: snapshot.data,
    metadata: {
      // El manifiesto viaja DENTRO del cierre, no en el código: dentro de tres
      // años quien lo lea sabrá qué campos eran estado actual aunque el
      // código haya cambiado diez veces.
      currentStateFields: [...CURRENT_STATE_FIELDS],
      capturedCurrentStateAt: now.toISOString(),
    },
  };

  // 4. Validar ANTES de escribir. Es la última oportunidad: después es
  //    inmutable.
  const validation = validateClosurePayload(payload);
  if (!validation.valid) {
    console.error("[monthly closure] payload rechazado:", validation.problems.join("; "));
    return { status: "failed", reason: "invalid_payload" };
  }

  const supabase = getSupabaseServerClient();
  const { data: recorded, error } = await supabase.rpc(RECORD_RPC, {
    p_period_key: month.periodKey,
    p_period_start: month.period.from.toISOString(),
    p_period_end: month.period.to.toISOString(),
    p_generation_kind: generationKind,
    p_generated_by_profile_id: input.actorProfileId ?? null,
    p_reporting_schema_version: CLOSURE_SCHEMA_VERSION,
    p_payload: payload,
  });

  if (error) {
    console.error("[monthly closure] write failed:", error.message);
    return { status: "failed", reason: "write_failed" };
  }

  // Se relee lo escrito en vez de devolver lo que se envió: lo que importa es
  // lo que quedó en la base, con su `generated_at` real.
  const stored = await getMonthlyClosure(month.periodKey);
  if (!stored) {
    console.error("[monthly closure] escrito pero no legible:", month.periodKey);
    return { status: "failed", reason: "write_failed" };
  }

  // `was_created` viene de la propia sentencia que insertó (o no), así que
  // distingue una creación de una carrera perdida sin depender de comparar
  // relojes. Si otra invocación del cron ganó entre el paso 2 y el 4 —cosa que
  // la documentación de Vercel advierte que puede pasar—, esto lo dice.
  const rows = (recorded ?? []) as { closure_id: string; was_created: boolean }[];
  const wasCreated = Array.isArray(rows) ? Boolean(rows[0]?.was_created) : false;

  return wasCreated
    ? { status: "created", closure: stored }
    : { status: "already_closed", closure: stored };
}

/** Un cierre por su clave de mes. `null` si ese mes no está cerrado. */
export async function getMonthlyClosure(periodKey: string): Promise<MonthlyClosure | null> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("monthly_management_closures")
    .select(CLOSURE_COLUMNS)
    .eq("period_key", periodKey)
    .maybeSingle();

  if (error) {
    console.error("[monthly closure] read failed:", error.message);
    return null;
  }
  return data ? toClosure(data as unknown as ClosureRow) : null;
}

/**
 * Los cierres existentes, del más reciente al más antiguo.
 *
 * SIN EL PAYLOAD. Una lista de meses no necesita arrastrar catorce bloques de
 * métricas por fila; quien quiera el contenido pide el cierre concreto.
 */
export async function listMonthlyClosures(): Promise<MonthlyClosureSummary[]> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("monthly_management_closures")
    .select(
      "period_key, period_start, period_end, generated_at, generation_kind, " +
        "generated_by_kind, reporting_schema_version"
    )
    .order("period_start", { ascending: false });

  if (error) {
    console.error("[monthly closure] list failed:", error.message);
    return [];
  }

  return (data ?? []).map((row) => {
    const typed = row as unknown as ClosureRow;
    return {
      periodKey: typed.period_key,
      periodStart: typed.period_start,
      periodEnd: typed.period_end,
      generatedAt: typed.generated_at,
      generationKind: typed.generation_kind as MonthlyClosureSummary["generationKind"],
      generatedByKind: typed.generated_by_kind as MonthlyClosureSummary["generatedByKind"],
      schemaVersion: typed.reporting_schema_version,
    };
  });
}
