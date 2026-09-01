import { BUSINESS_TIME_ZONE } from "../config/business-time.ts";

/**
 * ============================================================================
 * MILESTONE 26B-26F — EL NOMBRE DE UN ARCHIVO DESCARGADO
 * ============================================================================
 *
 * Extraído de `pdf/filename.ts` cuando el Excel de 26B-26F necesitó exactamente
 * la misma lógica. Se comparte en vez de copiarse por lo que ESTE valor es: no
 * una etiqueta, sino contenido que viaja dentro de una cabecera HTTP
 * `Content-Disposition`, donde una comilla o un salto de línea son una
 * inyección de cabecera.
 *
 * Dos copias de una frontera de seguridad son dos sitios donde arreglarla, y
 * uno de los dos se olvida.
 */

/**
 * El rango de fechas de un informe, en hora de Panamá.
 *
 * `to` es el fin EXCLUSIVO del modelo de período, así que se resta un instante:
 * el archivo se nombra por el último día que el informe cubre de verdad, no por
 * el primero que ya no cubre.
 *
 * SE RESUELVE EN HORA DE PANAMÁ, no en la del servidor. Vercel corre en UTC: un
 * informe de agosto generado a las nueve de la noche del 31 se llamaría
 * «septiembre» si el nombre se calculara con el reloj del runtime.
 */
export function reportDateRange(
  from: Date,
  to: Date,
  timeZone: string = BUSINESS_TIME_ZONE
): string {
  const iso = (date: Date) =>
    new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone,
    }).format(date);

  const start = iso(from);
  const end = iso(new Date(to.getTime() - 1));
  return start === end ? start : `${start}_${end}`;
}

/**
 * Deja el nombre en caracteres que ninguna cabecera puede malinterpretar.
 *
 * No es decorativo: es lo único que hace imposible que una comilla, un punto y
 * coma o un carácter de control lleguen a `Content-Disposition`.
 */
export function safeDownloadName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "");
}
