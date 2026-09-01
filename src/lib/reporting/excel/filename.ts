import { BUSINESS_TIME_ZONE } from "../../config/business-time.ts";
import { reportDateRange, safeDownloadName } from "../filename.ts";
import type { Locale } from "../../../i18n/config.ts";

/**
 * ============================================================================
 * MILESTONE 26B-26F — EL NOMBRE DEL EXTRACTO
 * ============================================================================
 *
 * Comparte con el PDF el cálculo del rango y el saneado (`../filename.ts`),
 * porque es la misma frontera de cabecera HTTP y no debe existir dos veces.
 *
 * LO QUE SÍ ES PROPIO DE ESTE ARCHIVO: la palabra «Detalle». El nombre avisa de
 * lo que lleva dentro antes de que nadie lo abra, y eso importa más aquí que en
 * el informe ejecutivo — un fichero llamado `ODL-Detalle-2026-08.xlsx` en una
 * carpeta compartida se reconoce como lo que es: datos personales de clientes
 * de ODL. Uno llamado `export.xlsx` no.
 *
 * SIN NOMBRES DE PERSONAS, igual que el PDF. Ni el de quien exporta ni el de
 * ningún cliente: el nombre de un archivo sobrevive al archivo.
 */
export function detailedExportFilename(
  from: Date,
  /** Fin EXCLUSIVO, tal como lo guarda el modelo de período. */
  to: Date,
  locale: Locale,
  timeZone: string = BUSINESS_TIME_ZONE
): string {
  const stem = locale === "en" ? "ODL-Detailed-Report" : "ODL-Informe-Detallado";
  return safeDownloadName(`${stem}-${reportDateRange(from, to, timeZone)}.xlsx`);
}
