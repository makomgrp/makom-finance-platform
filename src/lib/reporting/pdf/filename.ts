import { BUSINESS_TIME_ZONE } from "../../config/business-time.ts";
import { reportDateRange, safeDownloadName } from "../filename.ts";
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
 * 26B-26F: el cálculo del rango y el saneado se mudaron a
 * `src/lib/reporting/filename.ts` cuando el Excel necesitó lo mismo. Aquí queda
 * lo único que es propio del PDF —su prefijo y su extensión—; la frontera de
 * seguridad se comparte, que es donde tiene que estar.
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
 */
export function executiveReportFilename(
  from: Date,
  /** Fin EXCLUSIVO, tal como lo guarda el modelo de período. */
  to: Date,
  locale: Locale,
  timeZone: string = BUSINESS_TIME_ZONE
): string {
  const stem = locale === "en" ? "ODL-Executive-Report" : "ODL-Informe-Ejecutivo";
  return safeDownloadName(`${stem}-${reportDateRange(from, to, timeZone)}.pdf`);
}
