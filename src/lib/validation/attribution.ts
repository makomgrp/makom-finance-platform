/**
 * ============================================================================
 * MILESTONE 26B-26B.1 — DE DÓNDE VINO ESTE SOLICITANTE
 * ============================================================================
 *
 * 26B-26A encontró que ODL no puede responder «¿qué campaña trajo este lead?»
 * porque nada de eso se guarda. Igual que con el embudo, no es un dato que se
 * pueda recuperar después: la URL con la que alguien llegó existe durante una
 * petición y desaparece.
 *
 * Este módulo es la frontera. Todo lo que entra aquí viene de la barra de
 * direcciones o de una cabecera HTTP — es decir, de un desconocido — y todo lo
 * que sale está recortado, normalizado y libre de lo que no debe guardarse.
 *
 * ----------------------------------------------------------------------------
 * LA REGLA QUE MANDA: LA MÍNIMA INFORMACIÓN QUE RESPONDE LA PREGUNTA
 * ----------------------------------------------------------------------------
 * Una URL de referencia completa es de las cosas más peligrosas que se pueden
 * guardar sin pensar. Estas son reales y llegan todos los días:
 *
 *   https://mail.google.com/mail/u/0/#inbox/FMfcgzGtwXyZ...
 *   https://algun-sitio.com/reset?token=8f3a...&email=persona@correo.com
 *
 * Guardarlas enteras metería tokens de sesión y correos de terceros en una
 * tabla de marketing. Y ninguna de las preguntas que ODL quiere responder
 * necesita más que el HOST: «vino de Instagram», «vino de Google», «vino de un
 * blog». Por eso se guarda SOLO el host — no origin, no ruta, no query, no
 * fragmento.
 *
 * Es una decisión deliberadamente más estrecha que «guardar la ruta cuando sea
 * seguro»: eso obligaría a juzgar dominio por dominio, para siempre, y basta
 * equivocarse una vez. Sin campo donde quepa una ruta, no hay juicio que hacer.
 *
 * Para la página de aterrizaje sí interesa la RUTA — es lo que dice qué página
 * inició la conversión — pero sin query ni fragmento: los UTM ya viajan en
 * columnas propias y estructuradas, así que la query no aportaría nada que no
 * esté ya, y sí podría aportar lo que no debe.
 */

/**
 * 200 caracteres por valor UTM.
 *
 * Las campañas reales rara vez pasan de 60; 200 deja sitio de sobra para
 * nombres largos con fecha y segmento sin permitir que alguien use la barra de
 * direcciones como almacenamiento. Se recorta en vez de rechazar: un
 * `utm_campaign` demasiado largo sigue siendo una atribución útil, y perder el
 * lead entero por eso sería el peor intercambio posible.
 */
export const ATTRIBUTION_VALUE_MAX_LENGTH = 200;

/** El máximo de un nombre DNS. Más que esto no es un host. */
export const ATTRIBUTION_HOST_MAX_LENGTH = 253;

/** Rutas de aterrizaje. Generoso; las de ODL son cortas. */
export const ATTRIBUTION_PATH_MAX_LENGTH = 512;

/** Los cinco parámetros UTM estándar, en el orden habitual. */
export const UTM_PARAM_NAMES = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
] as const;

export type UtmParamName = (typeof UTM_PARAM_NAMES)[number];

/**
 * Lo que se persiste. Todo opcional: llegar sin campaña es lo normal, no un
 * error, y `undefined` significa «no venía», nunca «vacío».
 */
export interface Attribution {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  utmTerm?: string;
  /** Solo el host. Nunca esquema, ruta, query ni fragmento. */
  referrerHost?: string;
  /** Solo la ruta. Nunca query ni fragmento. */
  landingPath?: string;
}

/**
 * Limpieza común a todo texto que venga de fuera.
 *
 * Quita los caracteres de control — incluidos saltos de línea y nulos, que son
 * lo que se usa para intentar partir una cadena en dos en algún consumidor de
 * más abajo — colapsa los espacios y recorta. Una cadena que se queda vacía
 * vuelve como `undefined`: «vacío» y «ausente» son el mismo hecho, y guardar
 * la cadena vacía obligaría a cada consulta futura a acordarse de tratarlos
 * igual.
 */
function cleanText(raw: unknown, maxLength: number): string | undefined {
  if (typeof raw !== "string") return undefined;

  const withoutControls = raw.replace(/[\u0000-\u001f\u007f]/g, " ");
  const collapsed = withoutControls.replace(/\s+/g, " ").trim();
  if (collapsed === "") return undefined;

  return collapsed.slice(0, maxLength);
}

/**
 * ¿Tiene esto forma de host, y solo de host?
 *
 * Rechaza barra, interrogación, almohadilla, arroba y espacios. La arroba es la
 * importante: bloquea a la vez `usuario:clave@host` y cualquier cosa con forma
 * de correo, que son las dos maneras de que algo que no es un host acabe
 * pareciéndolo.
 */
function looksLikeHost(value: string): boolean {
  if (value.length > ATTRIBUTION_HOST_MAX_LENGTH) return false;
  return /^[a-z0-9.-]+$/.test(value) || /^\[[0-9a-f:]+\]$/.test(value);
}

/**
 * Normaliza un valor UTM.
 *
 * SE GUARDA COMO TEXTO, NO COMO ENUM, y es una decisión consciente. El
 * marketing cambia de plataforma más deprisa que el software: convertir
 * `utm_source` en un catálogo cerrado significaría una migración cada vez que
 * ODL pruebe una red nueva, y mientras tanto los leads de esa red llegarían
 * como NULL o —peor— reasignados a otra cosa.
 *
 * Se pasa a minúsculas porque `Instagram`, `instagram` e `INSTAGRAM` son la
 * misma fuente, y sin normalizar aparecerían como tres filas en cualquier
 * informe. Es la única transformación semántica que se aplica: el valor que
 * ODL escribió en el enlace es el que se guarda.
 */
export function normalizeUtmValue(raw: unknown): string | undefined {
  const cleaned = cleanText(raw, ATTRIBUTION_VALUE_MAX_LENGTH);
  return cleaned?.toLowerCase();
}

/**
 * De una URL de referencia, únicamente el host.
 *
 * Devuelve `undefined` — que es «sin referencia conocida», no un error — para:
 *
 *   * cualquier cosa que no sea una URL http/https absoluta (`about:blank`,
 *     `android-app://`, basura). Un esquema que no es web no dice de dónde
 *     vino nadie;
 *   * la referencia desde el propio sitio de ODL. Alguien que navega dentro
 *     del portal no acaba de ser captado, y contarlo como referencia
 *     convertiría la navegación interna en la mayor «fuente» del informe.
 *
 * Se descarta explícitamente el userinfo (`https://usuario:clave@host/`), que
 * es la vía por la que una credencial podría colarse en algo que parece un
 * host. `URL.hostname` ya lo excluye; se documenta porque no es evidente al
 * leerlo.
 *
 * El `www.` inicial se quita: `www.google.com` y `google.com` son la misma
 * fuente y separarlas solo partiría los agregados en dos.
 */
export function sanitizeReferrerHost(raw: unknown, selfHost?: string): string | undefined {
  const cleaned = cleanText(raw, 2048);
  if (!cleaned) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(cleaned);
  } catch {
    return undefined;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;

  // `hostname` — NO `host` ni `href`. Excluye puerto, userinfo, ruta, query y
  // fragmento por construcción, que es exactamente la garantía que hace falta.
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (!looksLikeHost(host)) return undefined;

  if (selfHost) {
    const self = selfHost.toLowerCase().split(":")[0].replace(/^www\./, "");
    if (host === self) return undefined;
  }

  return host;
}

/**
 * De la página de aterrizaje, únicamente la ruta.
 *
 * Acepta tanto una ruta suelta (`/solicitud`) como una URL completa, y de las
 * dos se queda con `pathname`. Query y fragmento se descartan siempre: los UTM
 * ya viajan aparte y estructurados, así que la query no añadiría atribución —
 * solo la posibilidad de guardar algo que no debe.
 *
 * Devuelve `undefined` para cualquier cosa que no acabe siendo una ruta
 * absoluta, en vez de intentar arreglarla.
 */
export function sanitizeLandingPath(raw: unknown): string | undefined {
  const cleaned = cleanText(raw, ATTRIBUTION_PATH_MAX_LENGTH * 4);
  if (!cleaned) return undefined;

  let pathname: string;
  if (cleaned.startsWith("/")) {
    // Base ficticia: solo se usa para que el parser resuelva una ruta
    // relativa, y nunca aparece en la salida.
    try {
      pathname = new URL(cleaned, "https://placeholder.invalid").pathname;
    } catch {
      return undefined;
    }
  } else {
    try {
      const parsed = new URL(cleaned);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
      pathname = parsed.pathname;
    } catch {
      return undefined;
    }
  }

  if (!pathname.startsWith("/")) return undefined;
  return pathname.slice(0, ATTRIBUTION_PATH_MAX_LENGTH);
}

/**
 * Cómo llegan los parámetros de búsqueda en un Server Component de Next.js:
 * un valor repetido (`?utm_source=a&utm_source=b`) llega como array.
 */
export type SearchParamValue = string | string[] | undefined;

export interface ExtractAttributionInput {
  searchParams?: Record<string, SearchParamValue>;
  /** La cabecera `referer` tal cual. Nunca la URL entera se persiste. */
  referrer?: string | null;
  /** La ruta en la que aterrizó, o la URL completa. */
  landingPath?: string | null;
  /** El host de ODL, para no contar la navegación interna como captación. */
  selfHost?: string | null;
}

/**
 * Reúne la atribución de una llegada.
 *
 * Ante un parámetro repetido se queda con el PRIMERO. Es first-touch aplicado
 * al nivel más pequeño posible, y coincide con lo que hace un navegador cuando
 * alguien pega dos veces el mismo parámetro.
 *
 * Puede devolver un objeto entero de `undefined`, y eso es un resultado válido
 * y frecuente: es una visita directa. Quien guarde esto debe distinguir «se
 * miró y no había campaña» de «nunca se miró» — para eso existe
 * `attribution_captured_at` en la base, no para que este módulo invente un
 * canal que los datos no soportan.
 */
export function extractAttribution(input: ExtractAttributionInput): Attribution {
  const first = (name: string): string | undefined => {
    const value = input.searchParams?.[name];
    if (Array.isArray(value)) return value[0];
    return value;
  };

  return {
    utmSource: normalizeUtmValue(first("utm_source")),
    utmMedium: normalizeUtmValue(first("utm_medium")),
    utmCampaign: normalizeUtmValue(first("utm_campaign")),
    utmContent: normalizeUtmValue(first("utm_content")),
    utmTerm: normalizeUtmValue(first("utm_term")),
    referrerHost: sanitizeReferrerHost(input.referrer, input.selfHost ?? undefined),
    landingPath: sanitizeLandingPath(input.landingPath),
  };
}

/**
 * Vuelve a limpiar lo que llega del navegador.
 *
 * La atribución la recoge el servidor al renderizar y viaja al Paso 1 dentro
 * del formulario, así que en el envío llega desde el cliente y podría traer
 * cualquier cosa. Esta pasada es la AUTORITATIVA: la de la página existe para
 * no escribir nunca un valor sucio en el HTML, esta para no guardarlo jamás.
 *
 * Que el navegador pueda influir en su propia atribución no es una debilidad
 * que este diseño introduzca: la atribución ES la URL con la que esa persona
 * llegó, y cualquiera puede escribir la URL que quiera. Lo que sí garantiza el
 * sistema es que nadie pueda tocar la atribución de OTRO solicitante — se
 * escribe solo al crear el intake y la base la vuelve inmutable después.
 */
export function sanitizeAttribution(raw: unknown): Attribution {
  const input = (raw ?? {}) as Record<string, unknown>;
  return {
    utmSource: normalizeUtmValue(input.utmSource),
    utmMedium: normalizeUtmValue(input.utmMedium),
    utmCampaign: normalizeUtmValue(input.utmCampaign),
    utmContent: normalizeUtmValue(input.utmContent),
    utmTerm: normalizeUtmValue(input.utmTerm),
    // Sin `selfHost`: aquí ya llega un host limpio de la pasada del servidor, y
    // volver a pasarlo por el parser de URL lo descartaría por no ser absoluto.
    referrerHost: reclean(input.referrerHost),
    landingPath: sanitizeLandingPath(input.landingPath),
  };
}

/**
 * Re-limpia un host que ya pasó por la primera vuelta.
 *
 * No lo vuelve a pasar por el parser de URL: a estas alturas es un host suelto,
 * y `new URL("google.com")` no es una URL absoluta, así que lo descartaría. Se
 * comprueba la FORMA, que es lo que de verdad hay que garantizar antes de
 * guardarlo.
 */
function reclean(raw: unknown): string | undefined {
  const cleaned = cleanText(raw, ATTRIBUTION_HOST_MAX_LENGTH);
  if (!cleaned) return undefined;
  const host = cleaned.toLowerCase().replace(/^www\./, "");
  return looksLikeHost(host) ? host : undefined;
}

/** ¿Trae esta atribución algún hecho, o fue una llegada directa? */
export function hasAnyAttribution(attribution: Attribution): boolean {
  return Object.values(attribution).some((value) => value !== undefined);
}
