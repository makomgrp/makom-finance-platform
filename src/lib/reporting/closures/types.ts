import type { ReportingSnapshot } from "../types.ts";

/**
 * ============================================================================
 * MILESTONE 26B-26G — EL CONTRATO DEL CIERRE MENSUAL
 * ============================================================================
 *
 * Un cierre gerencial es una FOTOGRAFÍA HISTÓRICA E INMUTABLE de las cifras
 * oficiales de ODL al terminar un mes de Panamá. Una vez creado no se recalcula,
 * no se sobrescribe y no cambia porque alguien edite un expediente en octubre.
 *
 * Ese es justamente su valor: dentro de un año, «agosto» seguirá diciendo lo
 * que decía. Una consulta en vivo sobre agosto podrá dar otro número —porque
 * los datos operativos siguen vivos— y las dos cosas serán ciertas a la vez.
 * El modelo NO borra esa diferencia; la nombra.
 *
 * ----------------------------------------------------------------------------
 * NO ES UNA CACHÉ
 * ----------------------------------------------------------------------------
 * El Dashboard, el PDF y el Excel siguen leyendo la capa VIVA. Nada de esto los
 * sustituye. Un cierre responde a otra pregunta: «¿qué sabíamos al cerrar el
 * mes?», no «¿qué sabemos ahora de aquel mes?».
 *
 * ----------------------------------------------------------------------------
 * SIN DATOS PERSONALES, Y SIN FILAS
 * ----------------------------------------------------------------------------
 * El contenido es exactamente el `ReportingSnapshot` oficial, que por
 * construcción es agregado: no tiene un solo campo de nombre, cédula, correo,
 * teléfono ni dirección, ni una sola fila individual de cliente, solicitud,
 * documento o correo. Se persiste TAL CUAL, sin añadirle nada.
 */

/** Versión del contrato persistido. Ver la nota de `MonthlyClosure`. */
export const CLOSURE_SCHEMA_VERSION = 1;

/**
 * Cómo nació un cierre.
 *
 *   scheduled  lo creó el automatismo el día 1 del mes siguiente.
 *   bootstrap  se creó a mano para recuperar un mes ya pasado, porque el
 *              sistema de cierres no existía cuando ese mes terminó.
 *
 * Se distinguen porque `generated_at` significa cosas distintas en cada caso, y
 * porque un cierre reconstruido a posteriori merece leerse como lo que es. El
 * cierre de agosto de 2026 es `bootstrap` y NO debe etiquetarse `scheduled`:
 * fingir que un proceso automático lo capturó a medianoche sería falsificar la
 * procedencia del primer registro histórico de ODL.
 */
export type MonthlyClosureGenerationKind = "scheduled" | "bootstrap";

/**
 * Quién generó el cierre, sin pedirle prestado el vocabulario a nadie.
 *
 * MILESTONE 26B-26G.1. La auditoría descubrió que `crm_events.source`
 * —{crm_manual, website_form, whatsapp, email, ai}— es el vocabulario de
 * CANALES OPERATIVOS de ODL, replicado en ocho tablas. Un proceso programado
 * interno no entró por ninguno de esos canales, y escribir `crm_manual` sobre
 * un cron habría falsificado el propio historial que sirve para responder
 * «¿quién hizo esto?».
 *
 * Por eso la procedencia vive AQUÍ, en la tabla de cierres, con su propio
 * vocabulario de dos valores. No se bifurcó ningún vocabulario compartido.
 */
export type MonthlyClosureActorKind = "human" | "system";

/**
 * ============================================================================
 * MÉTRICAS DE ESTADO ACTUAL — LA DISTINCIÓN QUE NO SE PUEDE PERDER
 * ============================================================================
 *
 * Auditado en 26B-26G sobre el SQL de 26B-26C: varias métricas del snapshot
 * NO son «as-of» del final del período. Se calculan contra `p_now` —el momento
 * en que corre la consulta— sobre la población que entró en el período.
 *
 * `reporting_lead_metrics` lo hace explícito: `active_now`, `stalled_now` y
 * `abandoned_now` comparan `p_now - last_activity_at` contra los umbrales. El
 * propio Dashboard lo avisa: «Situación actual de los leads que entraron en el
 * período. No indica cuándo se abandonaron.»
 *
 * Persistirlas sin más las convertiría en historia, y no lo son. Se eligió la
 * OPCIÓN A del brief —guardarlas, marcadas— en vez de excluirlas:
 *
 *   * excluirlas habría obligado a recortar el `ReportingSnapshot` oficial
 *     antes de guardarlo, es decir, a mantener una segunda forma del contrato;
 *   * el dato tiene valor real —«así estaban las oportunidades de agosto el día
 *     que cerramos agosto»— y borrarlo no lo hace más honesto;
 *   * lo que hacía falta no era quitarlas, sino que nadie pueda confundirlas.
 *
 * Por eso el snapshot se guarda ÍNTEGRO y aparte va este manifiesto: las rutas
 * exactas de los campos que son estado actual, y el instante en que se
 * capturaron. La capa de comparación histórica los excluye del diff apoyándose
 * en esta lista, no en una convención de nombres.
 */
export const CURRENT_STATE_FIELDS = [
  "leads.activeNow",
  "leads.stalledNow",
  "leads.abandonedNow",
  "documents.slotsPendingNow",
  "documents.slotsSubmittedNow",
  "documents.slotsUnderReviewNow",
  "documents.slotsSatisfiedNow",
  "documents.slotsRejectedNow",
  "documents.slotsWaivedNow",
  "documents.slotsMissingNow",
  "documents.documentsAwaitingReviewNow",
  "followUps.openNow",
  "followUps.overdueNow",
  "team[].assignedOpenNow",
  "team[].followUpsOpenNow",
] as const;

/**
 * `applications.openAtPeriodEnd` NO está en esta lista, y es deliberado.
 *
 * Su nombre no miente: se calcula al FINAL DEL PERÍODO, no contra `now()`. Es
 * genuinamente as-of, así que sí puede compararse entre meses como serie
 * histórica. Incluirla por parecerse a las demás la habría excluido de los
 * deltas oficiales sin motivo.
 */

export type CurrentStateField = (typeof CURRENT_STATE_FIELDS)[number];

/**
 * Lo que acompaña al snapshot y no forma parte de él.
 *
 * `capturedCurrentStateAt` es el momento real en que se leyeron las métricas de
 * arriba. En un cierre `scheduled` será el día 1 a la hora del automatismo; en
 * el `bootstrap` de agosto será la fecha real en que se ejecutó, semanas
 * después del período. Guardarlo es lo que permite responder «¿de cuándo es
 * este 12?» sin adivinar.
 */
export interface MonthlyClosureMetadata {
  currentStateFields: readonly string[];
  capturedCurrentStateAt: string;
}

/**
 * El contenido persistido de un cierre.
 *
 * `snapshot` es el `ReportingSnapshot` oficial VERBATIM. No se recorta, no se
 * reordena y no se le añaden campos: cualquier cirugía aquí sería una segunda
 * forma del contrato esperando a discrepar con la primera. La cobertura
 * (`snapshot.coverage`) viaja dentro, con sus fechas de inicio de medición
 * intactas — es lo único que permite distinguir «midieron cero» de «no se
 * estaba midiendo».
 */
export interface MonthlyClosurePayload {
  snapshot: ReportingSnapshot;
  metadata: MonthlyClosureMetadata;
}

/** Un cierre tal como vuelve de la base. */
export interface MonthlyClosure {
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  businessTimeZone: string;
  generatedAt: string;
  generationKind: MonthlyClosureGenerationKind;
  /** `system` en los programados; `human` en un bootstrap que alguien ejecutó. */
  generatedByKind: MonthlyClosureActorKind;
  /**
   * El perfil que lo ejecutó, solo en el caso humano.
   *
   * Es una CLAVE TÉCNICA de auditoría que vive FUERA del payload: la
   * prohibición de PII protege el contenido del cierre y las superficies que lo
   * muestran, no el rastro de quién lo creó. Nunca se pinta en pantalla — se
   * resuelve a nombre antes, como en el resto del proyecto.
   */
  generatedByProfileId: string | null;
  /**
   * La versión del contrato con la que se escribió ESTE cierre.
   *
   * Existe para poder evolucionar `ReportingSnapshot` sin volver ambiguos los
   * cierres antiguos. Un cambio de versión NO recalcula ni migra lo ya
   * guardado: un cierre de 2026 seguirá siendo un cierre de 2026, leído con las
   * reglas de 2026. Migrar en silencio sería reescribir la historia.
   */
  schemaVersion: number;
  payload: MonthlyClosurePayload;
}

/** Fila de la lista, sin arrastrar el payload entero. */
export interface MonthlyClosureSummary {
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  generationKind: MonthlyClosureGenerationKind;
  generatedByKind: MonthlyClosureActorKind;
  schemaVersion: number;
}

/**
 * El resultado de intentar generar un cierre.
 *
 * `already_closed` NO es un error: es la respuesta correcta a un reintento, y
 * la que hace que el automatismo pueda relanzarse el día 3 si el día 1 falló
 * sin duplicar nada ni tocar lo ya escrito.
 */
export type MonthlyClosureResult =
  | { status: "created"; closure: MonthlyClosure }
  | { status: "already_closed"; closure: MonthlyClosure }
  | { status: "failed"; reason: MonthlyClosureFailure };

/**
 * Por qué no se creó un cierre. Cada motivo es un `STOP`, nunca un cierre a
 * medias: un mes guardado con la mitad de los bloques en cero es peor que un
 * mes sin guardar, porque se archiva y se cita igual.
 */
export type MonthlyClosureFailure =
  /** La capa de reporting no pudo responder. Sin cifras no hay fotografía. */
  | "reporting_unavailable"
  /** El payload no pasó la validación previa a escribir. */
  | "invalid_payload"
  /** El mes todavía no ha terminado en Panamá. */
  | "period_not_ended"
  /** La clave de período no es un `YYYY-MM` válido. */
  | "invalid_period"
  /** La escritura falló en la base. */
  | "write_failed";
