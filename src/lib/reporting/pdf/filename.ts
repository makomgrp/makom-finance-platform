import { BUSINESS_TIME_ZONE } from "../../config/business-time.ts";
import type { Locale } from "../../../i18n/config.ts";

/**
 * ============================================================================
 * MILESTONE 26B-26E — EL NOMBRE DEL ARCHIVO
 * ============================================================================
 *
 * En su propio módulo, sin `server-only` ni pdfkit, por dos razones:
 *
 *   1. ES UNA FRONTERA DE SEGURIDAD. Este valor viaja dentro de una cabecera
 *      `Content-Disposition`, donde una comilla o un salto de línea son una
 *      inyección de cabecera. Merece pruebas propias, y para probarlo hay que
 *      poder importarlo sin arrastrar un generador de PDF.
 *   2. Es una función pura sobre fechas. No tiene por qué vivir dentro del
 *      módulo que dibuja.
 *
 * Imports relativos y con extensión, como el resto de módulos que se ejercitan
 * con `node --test`.
 */

/**
 * Nombre seguro y profesional para el informe descargado.
 *
 * SIN NOMBRES DE PERSONAS. Ni de quien lo genera ni de ningún cliente: el
 * archivo se reenvía y se archiva, y su nombre no debe cargar con nada que no
 * sea el período que cubre.
 *
 * LAS FECHAS SE RESUELVEN EN HORA DE PANAMÁ, no en la del servidor. Vercel
 * corre en UTC: un informe de agosto generado a las nueve de la noche del 31 se
 * llamaría «septiembre» si el nombre se calculara con el reloj del runtime.
 *
 * El saneado final no es decorativo — es lo que hace imposible que un carácter
 * de control llegue a la cabecera HTTP.
 */
export function executiveReportFilename(
  from: Date,
  /** Fin EXCLUSIVO, tal como lo guarda el modelo de período. */
  to: Date,
  locale: Locale,
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
  // Se resta un instante porque el fin es exclusivo: el archivo se nombra por
  // el último día que el informe cubre de verdad.
  const end = iso(new Date(to.getTime() - 1));
  const stem = locale === "en" ? "ODL-Executive-Report" : "ODL-Informe-Ejecutivo";
  const range = start === end ? start : `${start}_${end}`;

  return `${stem}-${range}.pdf`.replace(/[^A-Za-z0-9._-]/g, "");
}
