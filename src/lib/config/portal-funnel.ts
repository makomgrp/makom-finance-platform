import type { ApplicationSource } from "@/types";

/**
 * ============================================================================
 * MILESTONE 26B-26B — LOS DOS NÚMEROS QUE DECIDEN SI UNA SOLICITUD SE PERDIÓ
 * ============================================================================
 *
 * ODL fijó los umbrales; este archivo es el único sitio donde están escritos.
 * No es orden por el orden: "estancado" aparece en el embudo, en la bandeja de
 * seguimiento, en el informe gerencial y en cualquier recordatorio futuro, y
 * dos copias del mismo número son dos definiciones libres de separarse. La
 * primera vez que ODL suba el umbral a cinco días, la copia olvidada seguiría
 * llamando abandonada a gente que no lo está.
 *
 * SE PASAN A SQL COMO PARÁMETRO, NO SE REESCRIBEN ALLÍ. `record_portal_activity`
 * recibe el hueco de reanudación como argumento precisamente para que la
 * constante siga viviendo aquí y no exista una segunda versión en la base.
 */

/**
 * 72 HORAS SIN ACTIVIDAD — decisión de ODL.
 *
 * Todavía recuperable: quien lleva tres días sin tocar el formulario suele
 * estar reuniendo papeles, no rendido. Es el momento de llamar, no de dar por
 * perdido.
 */
export const PORTAL_STALLED_AFTER_MS = 72 * 60 * 60 * 1000;

/**
 * 7 DÍAS SIN ACTIVIDAD — decisión de ODL.
 *
 * A partir de aquí la solicitud cuenta como abandonada a efectos de informe.
 * Sigue siendo reversible en la vida real, y por eso `converted` gana siempre:
 * quien vuelve y envía deja de ser un abandono retroactivamente.
 */
export const PORTAL_ABANDONED_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * El hueco de inactividad a partir del cual volver a mover una solicitud es una
 * REANUDACIÓN y no la continuación de lo que se estaba haciendo.
 *
 * Es el umbral de estancamiento, deliberadamente, y no un número propio. Así
 * `portal_resumed` significa exactamente "una solicitud que el informe contaba
 * como estancada volvió a moverse" — la pregunta que ODL va a hacerse — en vez
 * de una medida de sesiones de navegador que nadie pidió y que obligaría a
 * decidir un umbral más.
 */
export const PORTAL_RESUME_GAP_MS = PORTAL_STALLED_AFTER_MS;

/** El mismo hueco, en la unidad que espera la función de base de datos. */
export const PORTAL_RESUME_GAP_SECONDS = Math.round(PORTAL_RESUME_GAP_MS / 1000);

/**
 * Dónde está una solicitud respecto del embudo público.
 *
 * `not_portal` NO es un caso de error ni un sinónimo de "activa": es la
 * respuesta correcta para algo que nunca estuvo en el embudo. Existe como valor
 * propio para que ningún llamador pueda meter por descuido un expediente que
 * Randol creó a mano en una cifra de abandono del formulario web — el
 * compilador le obliga a decidir qué hacer con él.
 */
export type PortalFunnelState = "not_portal" | "converted" | "active" | "stalled" | "abandoned";

export interface PortalFunnelInput {
  /** `applications.created_source`, o `application_intakes.channel`. */
  createdSource: ApplicationSource;
  /** `application_intakes.submitted_at`. Presente = la solicitud llegó a ODL. */
  submittedAt?: string | null;
  /** `application_intakes.last_activity_at`. Solo lo mueven las ESCRITURAS. */
  lastActivityAt: string;
}

/**
 * El orden de las comprobaciones es la definición, no una optimización.
 *
 *   1. ORIGEN PRIMERO. Un expediente creado en el CRM no puede clasificarse
 *      como abandono del portal por ninguna vía, ni siquiera si lleva un mes
 *      quieto: nunca hubo un solicitante rellenando un formulario que
 *      abandonar. Que sea la primera línea lo hace estructural en vez de una
 *      regla que cada llamador deba recordar.
 *
 *   2. CONVERTIDA GANA A LA EDAD. Una solicitud enviada hace ocho meses está
 *      convertida, no abandonada. El abandono es un estado de algo INACABADO, y
 *      preguntar por la antigüedad de algo terminado es preguntar otra cosa.
 *
 *   3. ABANDONADA ANTES QUE ESTANCADA, porque los rangos se solapan por
 *      definición: siete días también son más de setenta y dos.
 *
 * `now` es un parámetro con valor por defecto para que las pruebas de frontera
 * puedan fijar el instante. Un clasificador que solo sabe leer el reloj real no
 * se puede probar en el borde exacto, que es el único sitio donde se equivoca.
 */
export function classifyPortalFunnelState(
  input: PortalFunnelInput,
  now: Date = new Date()
): PortalFunnelState {
  if (input.createdSource !== "website_form") return "not_portal";
  if (input.submittedAt) return "converted";

  const elapsedMs = now.getTime() - new Date(input.lastActivityAt).getTime();

  // Una fecha ilegible o futura no puede probar inactividad. `active` es el
  // fallo seguro: llamar abandonado a alguien por un dato que no se entiende
  // sería inventar una pérdida.
  if (!Number.isFinite(elapsedMs)) return "active";

  if (elapsedMs >= PORTAL_ABANDONED_AFTER_MS) return "abandoned";
  if (elapsedMs >= PORTAL_STALLED_AFTER_MS) return "stalled";
  return "active";
}
