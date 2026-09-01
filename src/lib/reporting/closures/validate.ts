import { CLOSURE_SCHEMA_VERSION } from "./types.ts";
import type { MonthlyClosurePayload } from "./types.ts";

/**
 * ============================================================================
 * MILESTONE 26B-26G — LO QUE SE COMPRUEBA ANTES DE ESCRIBIR
 * ============================================================================
 *
 * Un cierre es INMUTABLE. No hay segunda oportunidad: lo que entra se queda, y
 * dentro de tres años alguien lo citará en una junta sin poder auditarlo contra
 * nada. Toda la validación tiene que ocurrir ANTES del `insert`.
 *
 * Se valida contra la ESTRUCTURA, no contra un `JSON.stringify` con una regex.
 * La diferencia importa: `emailsSent` contiene la palabra «email» y es un
 * recuento de correos, no una dirección; una comprobación ingenua lo marcaría y
 * acabaría relajándose hasta no comprobar nada. Aquí se recorren las claves
 * reales del objeto y se compara cada una con una lista cerrada.
 *
 * Módulo PURO: sin `server-only`, sin Supabase. Se puede ejercitar con
 * `node --test` sobre payloads construidos a mano, incluidos los hostiles.
 */

/**
 * Nombres de campo que NUNCA pueden aparecer en un cierre.
 *
 * La comparación es sobre la clave COMPLETA en minúsculas, no por subcadena,
 * exactamente para no chocar con `emailsSent`, `emailsReceived`,
 * `emailsLinked` ni `emailsUnlinked`, que son recuentos legítimos.
 */
const FORBIDDEN_KEYS = new Set(
  [
    "name",
    "fullName",
    "full_name",
    "firstName",
    "first_name",
    "lastName",
    "last_name",
    "applicantName",
    "applicantFullName",
    "clientName",
    "identification",
    "identificationNumber",
    "identification_number",
    "identificationType",
    "cedula",
    "email",
    "emailAddress",
    "applicantEmail",
    "phone",
    "phoneNumber",
    "applicantPhone",
    "address",
    "note",
    "notes",
    "observations",
    "employerName",
    "monthlySalary",
    "storagePath",
    "storage_path",
    "storageBucket",
    "fileName",
    "file_name",
    "fileSha256",
    "signedUrl",
    "url",
    "token",
    "accessToken",
    "apiKey",
    "password",
    "clientId",
    "client_id",
    "applicationId",
    "application_id",
    "applicationNumber",
    "intakeId",
    "slotId",
    "documentId",
  ].map((key) => key.toLowerCase())
);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El ÚNICO identificador con forma de UUID que puede vivir en un cierre.
 *
 * `team[].profileId` es la clave técnica de un miembro del PERSONAL, no de un
 * cliente ni de una solicitud. El contrato agregado de 26B-26C ya lo lleva —es
 * su único identificador de persona— y el Dashboard, el PDF y el Excel lo
 * resuelven a nombre antes de pintar, sin mostrarlo jamás.
 *
 * Se conserva por dos razones concretas: sin él las filas de equipo quedan
 * anónimas y no se pueden comparar entre meses, y quitarlo obligaría a recortar
 * el snapshot oficial antes de guardarlo, que es justo la cirugía que este
 * milestone evita. La prohibición de PII protege datos de CLIENTES; un FK de
 * personal en un registro de auditoría interna es otra cosa.
 *
 * Cualquier otro UUID en cualquier otra ruta es un fallo.
 */
const ALLOWED_UUID_PATH = /^snapshot\.team\.\d+\.profileId$/;

/** Los cuatro productos oficiales de ODL. Un cierre los lleva todos. */
export const OFFICIAL_PRODUCT_CODES = [
  "payroll_deduction",
  "bank_direct_debit",
  "vehicle_title_secured",
  "business_loan",
] as const;

export type ClosureValidation = { valid: true } | { valid: false; problems: string[] };

/** Recorre el grafo y devuelve cada `ruta → valor` hoja, sin perder el camino. */
function walk(
  value: unknown,
  path: string,
  visit: (path: string, key: string, value: unknown) => void
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, `${path}.${index}`, visit));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      const childPath = path ? `${path}.${key}` : key;
      visit(childPath, key, child);
      walk(child, childPath, visit);
    }
  }
}

/**
 * ¿Se puede escribir esto como cierre oficial?
 *
 * Devuelve TODOS los problemas, no el primero. Quien depure un fallo de
 * validación a las dos de la mañana del día 1 merece la lista completa.
 */
export function validateClosurePayload(payload: MonthlyClosurePayload): ClosureValidation {
  const problems: string[] = [];

  const snapshot = payload?.snapshot;
  if (!snapshot || typeof snapshot !== "object") {
    return { valid: false, problems: ["snapshot ausente o no es un objeto"] };
  }

  // 1. Todos los bloques del contrato. Un cierre al que le falta uno es un
  //    cierre incompleto, y un cierre incompleto no se guarda.
  const REQUIRED_BLOCKS = [
    "coverage",
    "leads",
    "newClients",
    "applications",
    "financial",
    "products",
    "funnel",
    "documents",
    "processDurations",
    "team",
    "followUps",
    "attribution",
    "attributionCoverage",
    "communications",
  ];
  for (const block of REQUIRED_BLOCKS) {
    if (!(block in snapshot)) problems.push(`falta el bloque "${block}"`);
  }

  // 2. La cobertura, que es lo único que distingue «midieron cero» de «no se
  //    estaba midiendo». Sin ella el cierre miente por omisión.
  // El validador inspecciona la ESTRUCTURA que llega, no el tipo que promete
  // el contrato: su trabajo es cazar el caso en que ese contrato no se cumpla.
  const coverage = snapshot.coverage as unknown as Record<string, unknown> | undefined;
  if (!coverage) {
    problems.push("falta coverage");
  } else {
    for (const field of [
      "funnelTrackingStartedAt",
      "attributionTrackingStartedAt",
      "auditEventsStartedAt",
      "historicalFunnelAvailable",
      "attributionAvailable",
    ]) {
      if (!(field in coverage)) problems.push(`coverage sin "${field}"`);
    }
  }

  // 3. Los cuatro productos, incluidos los que no tuvieron actividad. Un
  //    producto que desaparece de la hoja porque su mes fue cero se lee como un
  //    producto que ODL dejó de ofrecer.
  const products = snapshot.products;
  if (!Array.isArray(products)) {
    problems.push("products no es una lista");
  } else {
    const codes = new Set(products.map((row) => (row as { productCode?: string }).productCode));
    for (const code of OFFICIAL_PRODUCT_CODES) {
      if (!codes.has(code)) problems.push(`falta el producto oficial "${code}"`);
    }
  }

  // 4. Ni NaN ni Infinity en ninguna cifra. `null` sí: es «no se sabe», y es
  //    parte del contrato. Un Infinity persistido sobrevive para siempre.
  walk(snapshot, "snapshot", (path, key, value) => {
    if (typeof value === "number" && !Number.isFinite(value)) {
      problems.push(`valor no finito en ${path}`);
    }
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
      problems.push(`campo prohibido en ${path}`);
    }
    if (typeof value === "string" && UUID_RE.test(value) && !ALLOWED_UUID_PATH.test(path)) {
      problems.push(`identificador interno en ${path}`);
    }
  });

  // 5. El manifiesto de estado actual. Sin él, dentro de un año nadie sabrá que
  //    ese «12 activas» se midió el día del cierre y no al final de agosto.
  const metadata = payload.metadata;
  if (!metadata || !Array.isArray(metadata.currentStateFields) || metadata.currentStateFields.length === 0) {
    problems.push("falta el manifiesto de metricas de estado actual");
  }
  if (!metadata?.capturedCurrentStateAt || Number.isNaN(Date.parse(metadata.capturedCurrentStateAt))) {
    problems.push("capturedCurrentStateAt ausente o ilegible");
  }

  return problems.length === 0 ? { valid: true } : { valid: false, problems };
}

/** La versión con la que se escribe hoy. Aislada para que las pruebas la fijen. */
export function currentSchemaVersion(): number {
  return CLOSURE_SCHEMA_VERSION;
}
