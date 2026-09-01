import { safeDownloadName } from "../filename.ts";
import type { Locale } from "../../../i18n/config.ts";

/**
 * ============================================================================
 * MILESTONE 26B-27A — EL NOMBRE DEL EXPEDIENTE DESCARGADO
 * ============================================================================
 *
 * Comparte `safeDownloadName` con el informe ejecutivo y el Excel: es la misma
 * frontera de cabecera `Content-Disposition`, donde una comilla o un salto de
 * línea son una inyección, y no debe existir tres veces.
 *
 * ----------------------------------------------------------------------------
 * SIN UN SOLO DATO PERSONAL
 * ----------------------------------------------------------------------------
 * Ni nombre, ni cédula, ni teléfono, ni correo. El nombre de un archivo
 * sobrevive al archivo: aparece en la carpeta de descargas, en el adjunto de un
 * correo, en la lista de impresión y en la copia de seguridad del portátil de
 * quien lo bajó. Un expediente llamado `Solicitud-Juan-Perez-8-123-456.pdf`
 * filtra a su titular sin que nadie llegue a abrirlo.
 *
 * Lo que sí lleva es el NÚMERO DE SOLICITUD, que es el identificador que ODL ya
 * usa en voz alta —en un comité, en un correo interno, al teléfono— y que no
 * identifica a una persona por sí solo.
 *
 * ----------------------------------------------------------------------------
 * UN BORRADOR NO TIENE NÚMERO, Y NO SE LE INVENTA UNO
 * ----------------------------------------------------------------------------
 * `applications.application_number` es NULL hasta que la solicitud se
 * formaliza, y una restricción de la tabla lo garantiza. Para esos casos el
 * nombre lleva la palabra «Borrador» y un fragmento corto del identificador
 * técnico —lo justo para no sobrescribir el archivo anterior al bajar dos
 * borradores seguidos—, nunca un número con formato oficial.
 */
export function applicationDossierFilename(
  input: {
    applicationNumber?: string;
    /** El uuid interno. Solo se usa un fragmento, y solo si no hay número. */
    applicationId: string;
  },
  locale: Locale
): string {
  const stem = locale === "en" ? "ODL-Application" : "ODL-Solicitud";

  if (input.applicationNumber) {
    return safeDownloadName(`${stem}-${input.applicationNumber}.pdf`);
  }

  // Ocho caracteres bastan para distinguir dos borradores en la misma carpeta y
  // no reconstruyen el identificador completo.
  const shortId = input.applicationId.replace(/-/g, "").slice(0, 8);
  const draft = locale === "en" ? "Draft" : "Borrador";
  return safeDownloadName(`${stem}-${draft}-${shortId}.pdf`);
}
