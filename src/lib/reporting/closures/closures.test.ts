import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  monthHasEnded,
  monthlyPeriod,
  monthlyPeriodKey,
  panamaMonthPeriod,
  parseMonthlyPeriodKey,
  previousPanamaMonth,
} from "./period.ts";
import { validateClosurePayload, OFFICIAL_PRODUCT_CODES } from "./validate.ts";
import { compareMonthlyClosures, isComparablePath, COMPARABLE_PATHS } from "./compare.ts";
import { CLOSURE_SCHEMA_VERSION, CURRENT_STATE_FIELDS } from "./types.ts";
import type { MonthlyClosure, MonthlyClosurePayload } from "./types.ts";
import { ROLE_CAPABILITIES } from "../../auth/capabilities.ts";

/**
 * ============================================================================
 * MILESTONE 26B-26G — LO QUE UN CIERRE INMUTABLE NO PERDONA
 * ============================================================================
 *
 * Un cierre se escribe una vez y se cita durante años. No hay segunda
 * oportunidad: si entra mal, entra mal para siempre.
 *
 * Estas pruebas defienden las cuatro cosas que no se ven mirando la fila:
 * que el mes sea el mes correcto, que dentro no haya datos personales, que una
 * métrica de estado actual no se disfrace de historia, y que un reintento no
 * duplique nada.
 *
 * Las garantías de la BASE —inmutabilidad, unicidad, idempotencia y que solo el
 * bootstrap audite— se verificaron contra la migración real de Production
 * dentro de una transacción revertida, porque un trigger no se puede probar
 * leyendo TypeScript. Aquí se comprueba que la migración las declara.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const MIGRATION = read(
  "../../../../supabase/migrations/20260901010000_milestone_26b26g_monthly_management_closures.sql"
);

// ---------------------------------------------------------------------------
// 1. EL MES DE PANAMÁ
// ---------------------------------------------------------------------------

const iso = (d: Date) => d.toISOString();

test("un mes va de medianoche de Panamá a medianoche de Panamá, fin exclusivo", () => {
  const agosto = panamaMonthPeriod(2026, 8);
  // Panamá es UTC-5: la medianoche del día 1 son las 05:00Z.
  assert.equal(iso(agosto.from), "2026-08-01T05:00:00.000Z");
  assert.equal(iso(agosto.to), "2026-09-01T05:00:00.000Z");
  assert.equal(agosto.timeZone, "America/Panama");
  assert.equal(agosto.isPartial, false);
});

test("diciembre desborda al año siguiente sin aritmética propia", () => {
  const diciembre = panamaMonthPeriod(2026, 12);
  assert.equal(iso(diciembre.from), "2026-12-01T05:00:00.000Z");
  assert.equal(iso(diciembre.to), "2027-01-01T05:00:00.000Z");
});

test("febrero bisiesto tiene 29 días y el no bisiesto 28", () => {
  const dias = (year: number) => {
    const f = panamaMonthPeriod(year, 2);
    return (f.to.getTime() - f.from.getTime()) / 86_400_000;
  };
  assert.equal(dias(2028), 29, "2028 es bisiesto");
  assert.equal(dias(2026), 28);
  assert.equal(dias(2100), 28, "2100 NO es bisiesto pese a ser divisible por 4");
});

test("cada mes dura exactamente lo que dice el calendario", () => {
  const largos: Record<number, number> = {
    1: 31, 3: 31, 4: 30, 5: 31, 6: 30, 7: 31, 8: 31, 9: 30, 10: 31, 11: 30, 12: 31,
  };
  for (const [month, dias] of Object.entries(largos)) {
    const p = panamaMonthPeriod(2026, Number(month));
    assert.equal((p.to.getTime() - p.from.getTime()) / 86_400_000, dias, `mes ${month}`);
  }
});

test("la clave es YYYY-MM y no depende del idioma", () => {
  assert.equal(monthlyPeriodKey(2026, 8), "2026-08");
  assert.equal(monthlyPeriodKey(2026, 12), "2026-12");
  assert.equal(monthlyPeriodKey(2027, 1), "2027-01");
});

// ---------------------------------------------------------------------------
// 2. EL MES ANTERIOR — lo que resuelve el cron
// ---------------------------------------------------------------------------

test("el cron del 1 de octubre cierra septiembre", () => {
  // 06:00 UTC = 01:00 en Panamá del día 1.
  assert.equal(previousPanamaMonth(new Date("2026-10-01T06:00:00Z")).periodKey, "2026-09");
});

test("el cron del 1 de enero cierra diciembre del año anterior", () => {
  assert.equal(previousPanamaMonth(new Date("2027-01-01T06:00:00Z")).periodKey, "2026-12");
});

test("el mes se resuelve en Panamá, no con el reloj del servidor", () => {
  // 2026-09-01T02:00Z son todavía las 21:00 del 31 de AGOSTO en Panamá. Un
  // servidor en UTC creería que estamos en septiembre y cerraría julio.
  assert.equal(previousPanamaMonth(new Date("2026-09-01T02:00:00Z")).periodKey, "2026-07");
  // Cuatro horas después ya es septiembre en Panamá y toca cerrar agosto.
  assert.equal(previousPanamaMonth(new Date("2026-09-01T06:00:00Z")).periodKey, "2026-08");
});

test("un reintento tardío sigue cerrando el mismo mes", () => {
  // La entrega de Vercel Cron es best effort: si el día 1 falla, el día 3
  // tiene que cerrar septiembre igualmente, no el mes que toque ese día.
  for (const cuando of ["2026-10-01T06:00:00Z", "2026-10-03T14:00:00Z", "2026-10-28T23:00:00Z"]) {
    assert.equal(previousPanamaMonth(new Date(cuando)).periodKey, "2026-09", cuando);
  }
});

test("un mes en curso no se puede cerrar", () => {
  const septiembre = monthlyPeriod(2026, 9);
  assert.equal(monthHasEnded(septiembre, new Date("2026-09-12T15:00:00Z")), false);
  // Un instante antes de la medianoche panameña del 1 de octubre: aún no.
  assert.equal(monthHasEnded(septiembre, new Date("2026-10-01T04:59:59Z")), false);
  assert.equal(monthHasEnded(septiembre, new Date("2026-10-01T05:00:00Z")), true);
});

test("una clave malformada se rechaza en vez de generar un mes inventado", () => {
  for (const malo of ["2026-13", "2026-00", "26-08", "2026/08", "agosto", "", "1999-08", "3000-01"]) {
    assert.equal(parseMonthlyPeriodKey(malo), null, malo);
  }
  assert.equal(parseMonthlyPeriodKey("2026-08")?.periodKey, "2026-08");
  assert.equal(parseMonthlyPeriodKey("  2026-08  ")?.periodKey, "2026-08");
});

// ---------------------------------------------------------------------------
// 3. VALIDACIÓN — la última puerta antes de algo irreversible
// ---------------------------------------------------------------------------

/** Un snapshot mínimo pero estructuralmente completo. */
function snapshotBase(): Record<string, unknown> {
  return {
    coverage: {
      funnelTrackingStartedAt: "2026-08-31T18:38:57.939Z",
      attributionTrackingStartedAt: "2026-08-31T19:09:22.732Z",
      auditEventsStartedAt: "2026-08-01T00:00:00.000Z",
      historicalFunnelAvailable: false,
      attributionAvailable: false,
      whatsappMetricsAvailable: false,
      complianceMetricsAvailable: false,
    },
    leads: { leads: 16, converted: 4, activeNow: 12, stalledNow: 0, abandonedNow: 0 },
    newClients: { total: 11 },
    applications: { created: 15, formalized: 4, decisions: 0, approvalRate: null, openAtPeriodEnd: 15 },
    financial: { requestedTotal: 720000, approvedCount: 0, approvedTotal: 0 },
    products: OFFICIAL_PRODUCT_CODES.map((productCode) => ({ productCode, created: 0 })),
    funnel: [],
    documents: { uploadedInPeriod: 43, slotsPendingNow: 34 },
    processDurations: [],
    team: [{ profileId: "11111111-2222-3333-4444-555555555555", role: "administrador" }],
    followUps: { createdInPeriod: 0, openNow: 0 },
    attribution: [],
    attributionCoverage: { unmeasured: 16, measuredWithUtm: 0 },
    communications: { emailsSent: 6, emailsReceived: 0 },
  };
}

function payloadBase(): MonthlyClosurePayload {
  return {
    snapshot: snapshotBase() as unknown as MonthlyClosurePayload["snapshot"],
    metadata: {
      currentStateFields: [...CURRENT_STATE_FIELDS],
      capturedCurrentStateAt: "2026-09-01T06:00:00.000Z",
    },
  };
}

test("un payload completo pasa", () => {
  assert.deepEqual(validateClosurePayload(payloadBase()), { valid: true });
});

test("faltar un bloque del contrato impide el cierre", () => {
  const payload = payloadBase();
  delete (payload.snapshot as unknown as Record<string, unknown>).financial;
  const result = validateClosurePayload(payload);
  assert.equal(result.valid, false);
  assert.ok(result.valid === false && result.problems.some((p) => p.includes("financial")));
});

test("sin cobertura no hay cierre: es lo único que separa cero de no medido", () => {
  const payload = payloadBase();
  delete (payload.snapshot as unknown as Record<string, unknown>).coverage;
  assert.equal(validateClosurePayload(payload).valid, false);
});

test("los cuatro productos oficiales deben estar, aunque su mes fuera cero", () => {
  const payload = payloadBase();
  // Un producto que desaparece porque no tuvo actividad se lee como un producto
  // que ODL dejó de ofrecer.
  (payload.snapshot as unknown as { products: unknown[] }).products = [
    { productCode: "payroll_deduction", created: 3 },
  ];
  const result = validateClosurePayload(payload);
  assert.equal(result.valid, false);
  assert.ok(result.valid === false && result.problems.length >= 3);
  assert.equal(OFFICIAL_PRODUCT_CODES.length, 4);
});

test("NaN e Infinity nunca se persisten", () => {
  for (const veneno of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    const payload = payloadBase();
    (payload.snapshot as unknown as { financial: Record<string, unknown> }).financial.requestedTotal =
      veneno;
    const result = validateClosurePayload(payload);
    assert.equal(result.valid, false, String(veneno));
    assert.ok(result.valid === false && result.problems.some((p) => p.includes("no finito")));
  }
});

test("un null legítimo SÍ pasa: «no se sabe» es parte del contrato", () => {
  const payload = payloadBase();
  (payload.snapshot as unknown as { applications: Record<string, unknown> }).applications.approvalRate =
    null;
  assert.equal(validateClosurePayload(payload).valid, true);
});

// ---------------------------------------------------------------------------
// 4. SIN DATOS PERSONALES
// ---------------------------------------------------------------------------

test("cualquier campo de datos personales bloquea el cierre", () => {
  const camposPII = [
    "fullName",
    "firstName",
    "lastName",
    "identificationNumber",
    "email",
    "phone",
    "address",
    "note",
    "employerName",
    "monthlySalary",
    "storagePath",
    "signedUrl",
    "token",
    "applicationNumber",
    "clientId",
  ];
  for (const campo of camposPII) {
    const payload = payloadBase();
    (payload.snapshot as unknown as Record<string, Record<string, unknown>>).leads[campo] = "x";
    const result = validateClosurePayload(payload);
    assert.equal(result.valid, false, `${campo} deberia bloquear el cierre`);
    assert.ok(result.valid === false && result.problems.some((p) => p.includes("prohibido")));
  }
});

test("«emailsSent» NO es un falso positivo: es un recuento, no una dirección", () => {
  // La razón por la que el validador compara claves COMPLETAS y no subcadenas.
  const payload = payloadBase();
  assert.equal(validateClosurePayload(payload).valid, true);
  assert.ok("emailsSent" in (payload.snapshot as unknown as { communications: object }).communications);
});

test("un UUID de cliente o de solicitud bloquea el cierre", () => {
  for (const bloque of ["leads", "applications", "financial"]) {
    const payload = payloadBase();
    (payload.snapshot as unknown as Record<string, Record<string, unknown>>)[bloque].algo =
      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const result = validateClosurePayload(payload);
    assert.equal(result.valid, false, bloque);
    assert.ok(result.valid === false && result.problems.some((p) => p.includes("identificador interno")));
  }
});

test("el ÚNICO uuid admitido es team[].profileId, y solo ahí", () => {
  // Es la clave técnica de un miembro del PERSONAL —el único identificador de
  // persona del contrato agregado— y las tres superficies la resuelven a nombre
  // antes de pintar. La prohibición de PII protege datos de clientes.
  assert.equal(validateClosurePayload(payloadBase()).valid, true);

  const payload = payloadBase();
  (payload.snapshot as unknown as { team: Record<string, unknown>[] }).team[0].otroId =
    "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  assert.equal(validateClosurePayload(payload).valid, false, "otro uuid en team tambien se rechaza");
});

test("sin manifiesto de estado actual no se escribe nada", () => {
  const sinManifiesto = payloadBase();
  sinManifiesto.metadata = { currentStateFields: [], capturedCurrentStateAt: "2026-09-01T06:00:00Z" };
  assert.equal(validateClosurePayload(sinManifiesto).valid, false);

  const sinFecha = payloadBase();
  sinFecha.metadata = { currentStateFields: [...CURRENT_STATE_FIELDS], capturedCurrentStateAt: "ayer" };
  assert.equal(validateClosurePayload(sinFecha).valid, false);
});

// ---------------------------------------------------------------------------
// 5. ESTADO ACTUAL vs HISTORIA
// ---------------------------------------------------------------------------

test("las métricas «now» están declaradas y quedan fuera de los deltas", () => {
  for (const campo of [
    "leads.activeNow",
    "leads.stalledNow",
    "leads.abandonedNow",
    "documents.slotsPendingNow",
    "followUps.openNow",
    "followUps.overdueNow",
    "team[].assignedOpenNow",
  ]) {
    assert.ok(
      (CURRENT_STATE_FIELDS as readonly string[]).includes(campo),
      `${campo} deberia estar en el manifiesto`
    );
    assert.equal(isComparablePath(campo), false, `${campo} no puede entrar en un delta oficial`);
  }
});

test("openAtPeriodEnd SÍ es histórica: se mide al final del período", () => {
  // Su nombre no miente y el SQL lo confirma. Excluirla por parecerse a las
  // demas la habria sacado de los deltas sin motivo.
  assert.ok(!(CURRENT_STATE_FIELDS as readonly string[]).includes("applications.openAtPeriodEnd"));
  assert.ok(isComparablePath("applications.openAtPeriodEnd"));
});

test("ninguna ruta comparable es a la vez de estado actual", () => {
  for (const path of COMPARABLE_PATHS) {
    assert.equal(
      (CURRENT_STATE_FIELDS as readonly string[]).includes(path),
      false,
      `${path} esta en los dos sitios`
    );
  }
});

// ---------------------------------------------------------------------------
// 6. COMPARACIÓN HISTÓRICA
// ---------------------------------------------------------------------------

function closure(periodKey: string, snapshot: Record<string, unknown>): MonthlyClosure {
  return {
    periodKey,
    periodStart: `${periodKey}-01T05:00:00.000Z`,
    periodEnd: `${periodKey}-28T05:00:00.000Z`,
    businessTimeZone: "America/Panama",
    generatedAt: "2026-10-01T06:00:00.000Z",
    generationKind: "scheduled",
    generatedByKind: "system",
    generatedByProfileId: null,
    schemaVersion: CLOSURE_SCHEMA_VERSION,
    payload: {
      snapshot: snapshot as unknown as MonthlyClosurePayload["snapshot"],
      metadata: {
        currentStateFields: [...CURRENT_STATE_FIELDS],
        capturedCurrentStateAt: "2026-10-01T06:00:00.000Z",
      },
    },
  };
}

const metric = (comparison: ReturnType<typeof compareMonthlyClosures>, path: string) =>
  comparison.metrics.find((m) => m.path === path)!;

test("comparar dos cierres es restar payloads, no volver a consultar", () => {
  const anterior = snapshotBase();
  const actual = snapshotBase();
  (actual.applications as Record<string, unknown>).created = 20;

  const c = compareMonthlyClosures(closure("2026-09", actual), closure("2026-08", anterior));
  const created = metric(c, "applications.created");

  assert.equal(created.current, 20);
  assert.equal(created.previous, 15);
  assert.equal(created.comparison?.deltaAbsolute, 5);
  assert.ok(typeof created.comparison?.deltaPercent === "number");

  // El módulo no consulta nada. Se examina el CÓDIGO y no los comentarios: la
  // cabecera del fichero EXPLICA que no llama a getReportingComparison, y una
  // búsqueda a secas encontraría justo esa explicación.
  const source = read("./compare.ts")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
  for (const prohibido of ["supabase", "getReportingComparison", "getReportingSnapshot", ".rpc("]) {
    assert.ok(!source.includes(prohibido), `compare.ts no debe usar ${prohibido}`);
  }
});

test("un mes anterior en cero no produce un porcentaje inventado", () => {
  const anterior = snapshotBase();
  (anterior.applications as Record<string, unknown>).created = 0;
  const actual = snapshotBase();

  const created = metric(
    compareMonthlyClosures(closure("2026-09", actual), closure("2026-08", anterior)),
    "applications.created"
  );
  assert.equal(created.current, 15);
  assert.equal(created.previous, 0);
  assert.equal(created.comparison?.deltaAbsolute, 15);
  assert.equal(created.comparison?.deltaPercent, null, "pasar de 0 a 15 no es +1500%");
});

test("una métrica desconocida no se compara contra un cero fabricado", () => {
  const anterior = snapshotBase();
  (anterior.applications as Record<string, unknown>).approvalRate = null;
  const actual = snapshotBase();
  (actual.applications as Record<string, unknown>).approvalRate = 40;

  const rate = metric(
    compareMonthlyClosures(closure("2026-09", actual), closure("2026-08", anterior)),
    "applications.approvalRate"
  );
  assert.equal(rate.current, 40);
  assert.equal(rate.previous, null);
  assert.equal(rate.comparison, null, "no hay delta contra lo que no se sabe");
});

test("ninguna comparación produce NaN ni Infinity", () => {
  const c = compareMonthlyClosures(closure("2026-09", snapshotBase()), closure("2026-08", snapshotBase()));
  for (const m of c.metrics) {
    for (const value of [m.current, m.previous, m.comparison?.deltaAbsolute, m.comparison?.deltaPercent]) {
      assert.ok(
        value === null || value === undefined || Number.isFinite(value),
        `${m.path} produjo ${value}`
      );
    }
  }
  assert.ok(c.excludedCurrentStateFields.length > 0);
});

// ---------------------------------------------------------------------------
// 7. LA MIGRACIÓN DECLARA LAS GARANTÍAS DE LA BASE
// ---------------------------------------------------------------------------

test("un cierre es único por mes e inmutable", () => {
  assert.ok(MIGRATION.includes("period_key text not null unique"));
  assert.ok(MIGRATION.includes("before update on public.monthly_management_closures"));
  assert.ok(MIGRATION.includes("before delete on public.monthly_management_closures"));
  assert.ok(MIGRATION.includes("monthly_closures_reject_mutation"));
});

test("la idempotencia la decide la base en una sola sentencia", () => {
  // Un `select` y luego un `insert` perderia la carrera entre dos invocaciones
  // simultaneas del cron, algo que la documentacion de Vercel advierte.
  assert.ok(MIGRATION.includes("on conflict (period_key) do nothing"));
});

test("nadie escribe la tabla directamente: ni anon, ni authenticated, ni el servidor", () => {
  assert.ok(MIGRATION.includes("enable row level security"));
  for (const rol of ["anon", "authenticated"]) {
    assert.ok(
      MIGRATION.includes(`revoke all on table public.monthly_management_closures from ${rol}`),
      rol
    );
  }
  // A service_role solo se le concede SELECT: la escritura pasa por la RPC.
  assert.ok(MIGRATION.includes("grant select on table public.monthly_management_closures to service_role"));
  assert.ok(!/grant insert on table public\.monthly_management_closures/.test(MIGRATION));
});

test("la RPC es SECURITY DEFINER con search_path fijo y solo para el servidor", () => {
  assert.ok(MIGRATION.includes("security definer"));
  assert.ok(MIGRATION.includes("set search_path = public, pg_temp"));
  assert.ok(/grant execute on function public\.record_monthly_management_closure[^;]*to service_role/.test(MIGRATION));
  for (const rol of ["anon", "authenticated", "public"]) {
    assert.ok(
      new RegExp(`revoke all on function public\\.record_monthly_management_closure[^;]*from ${rol}`).test(
        MIGRATION
      ),
      rol
    );
  }
});

test("el vocabulario de canales NO se tocó — la decisión de 26B-26G.1", () => {
  // `source` es {crm_manual, website_form, whatsapp, email, ai} y esta
  // replicado en ocho tablas. Un cron no entro por ninguno de esos canales, y
  // escribir `crm_manual` sobre el habria falsificado el historial.
  assert.ok(!MIGRATION.includes("crm_events_source_check"), "no debe redefinirse el vocabulario de source");
  assert.ok(!MIGRATION.includes("system_scheduler"), "no debe inventarse un canal nuevo");

  // La procedencia vive en columnas propias de la tabla de cierres.
  assert.ok(MIGRATION.includes("generated_by_kind"));
  assert.ok(MIGRATION.includes("monthly_closures_scheduled_is_system"));
});

test("solo el bootstrap humano escribe en crm_events", () => {
  assert.ok(MIGRATION.includes("'monthly_management_closure_created'"));
  assert.ok(MIGRATION.includes("'monthly_closure'"));
  // La insercion del evento esta dentro de la rama del actor humano.
  const rpc = MIGRATION.slice(MIGRATION.indexOf("create function public.record_monthly_management_closure"));
  const guard = rpc.indexOf("if p_generated_by_profile_id is not null then");
  const eventInsert = rpc.indexOf("insert into public.crm_events");
  assert.ok(guard > 0 && eventInsert > guard, "el evento debe estar bajo la guarda de actor humano");
});

test("el evento de auditoría no lleva el snapshot entero ni datos personales", () => {
  const rpc = MIGRATION.slice(MIGRATION.indexOf("insert into public.crm_events"));
  const evento = rpc.slice(0, rpc.indexOf("end if;"));
  assert.ok(evento.includes("'period_key'"));
  assert.ok(evento.includes("'generation_kind'"));
  assert.ok(!evento.includes("'snapshot', p_payload"), "no debe duplicar el informe");
  for (const prohibido of ["full_name", "email", "phone", "identification"]) {
    assert.ok(!evento.includes(prohibido), prohibido);
  }
});

// ---------------------------------------------------------------------------
// 8. EL CRON Y SU PUERTA
// ---------------------------------------------------------------------------

const CRON_ROUTE = read("../../../app/api/cierres-mensuales/route.ts");

test("sin CRON_SECRET el endpoint no se abre: falla cerrado", () => {
  // No hay modo permisivo «mientras se configura»: esa ventana es justo por
  // donde cualquiera podria disparar una escritura historica permanente.
  assert.ok(CRON_ROUTE.includes("if (!cronSecret || authorization !== `Bearer ${cronSecret}`)"));
  assert.ok(CRON_ROUTE.includes("status: 401"));
  assert.ok(!/process\.env\.NODE_ENV/.test(CRON_ROUTE), "sin puertas traseras por entorno");
});

test("el cron resuelve el mes anterior en vez de fiarse de la fecha de invocación", () => {
  assert.ok(CRON_ROUTE.includes("previousPanamaMonth()"));
});

test("el cron nunca crea un cierre con actor humano", () => {
  assert.ok(CRON_ROUTE.includes('generationKind: "scheduled"'));
  assert.ok(CRON_ROUTE.includes("actorProfileId: null"));
});

test("vercel.json programa el día 1 a las 06:00 UTC, que es la 01:00 de Panamá", () => {
  const vercel = JSON.parse(read("../../../../vercel.json"));
  const cron = vercel.crons.find(
    (c: { path: string }) => c.path === "/api/cierres-mensuales"
  );
  assert.ok(cron, "falta la entrada de cron");
  assert.equal(cron.schedule, "0 6 1 * *");

  // Vercel evalua las expresiones en UTC. Se comprueba con Intl, no de memoria,
  // y en tres meses distintos porque Panama no aplica horario de verano.
  for (const mes of ["2026-10-01", "2027-01-01", "2027-07-01"]) {
    const enPanama = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Panama",
      hour: "2-digit",
      hour12: false,
    }).format(new Date(`${mes}T06:00:00Z`));
    assert.equal(Number(enPanama), 1, `${mes} deberia ser la 01:00 en Panama`);
  }
});

// ---------------------------------------------------------------------------
// 9. QUIÉN PUEDE LEER LOS CIERRES
// ---------------------------------------------------------------------------

test("los cierres los leen administrador y gerente, y solo ellos", () => {
  // Se reutiliza `analytics:view`: son cifras agregadas de gestion, la misma
  // pregunta que ya protege esa capacidad. No se amplia nada.
  const holders = (Object.keys(ROLE_CAPABILITIES) as (keyof typeof ROLE_CAPABILITIES)[]).filter(
    (role) => (ROLE_CAPABILITIES[role] as readonly string[]).includes("analytics:view")
  );
  assert.deepEqual(holders.sort(), ["administrador", "gerente"]);

  for (const role of ["asesor", "compliance", "consulta"] as const) {
    assert.ok(!(ROLE_CAPABILITIES[role] as readonly string[]).includes("analytics:view"), role);
  }
});

test("el servicio de cierres es server-only y no recalcula ninguna métrica", () => {
  const service = read("../../services/monthly-closures.ts");
  assert.ok(service.startsWith('import "server-only";'));
  assert.ok(service.includes("getReportingSnapshot"), "la fuente es la capa oficial");
  for (const prohibido of ["COUNT(", "SUM(", ".reduce(", "select count"]) {
    assert.ok(!service.includes(prohibido), `el servicio no debe agregar: ${prohibido}`);
  }
});

test("un mes en curso no llega ni a consultarse", () => {
  const service = read("../../services/monthly-closures.ts");
  const body = service.slice(service.indexOf("export async function generateMonthlyClosure"));
  const guard = body.indexOf("monthHasEnded");
  const fetch = body.indexOf("getReportingSnapshot(");
  assert.ok(guard > 0 && fetch > guard, "la guarda de mes terminado debe ir antes de leer");
});

test("si el reporting falla no se escribe un cierre de ceros", () => {
  const service = read("../../services/monthly-closures.ts");
  const body = service.slice(service.indexOf("export async function generateMonthlyClosure"));
  const fail = body.indexOf('"reporting_unavailable"');
  const write = body.indexOf("supabase.rpc(RECORD_RPC");
  assert.ok(fail > 0 && fail < write, "el fallo debe cortar ANTES de escribir");

  // Y la validacion tambien va antes: despues ya es inmutable.
  const validate = body.indexOf("validateClosurePayload(");
  assert.ok(validate > 0 && validate < write);
});

// ---------------------------------------------------------------------------
// 10. LA RUTA DE CIERRE MANUAL — bootstrap y reintento
// ---------------------------------------------------------------------------

const BOOTSTRAP_ROUTE = read("../../../app/api/cierres-mensuales/bootstrap/route.ts");

test("el cierre manual exige capacidad en el servidor, antes de leer el período", () => {
  assert.ok(BOOTSTRAP_ROUTE.includes('requireCapability("analytics:view")'));
  const authAt = BOOTSTRAP_ROUTE.indexOf("requireCapability");
  const parseAt = BOOTSTRAP_ROUTE.indexOf("parseMonthlyPeriodKey(");
  assert.ok(authAt > 0 && parseAt > authAt, "autorizar primero, validar despues");
});

test("es POST: escribir historia no puede dispararse pegando una URL", () => {
  assert.ok(BOOTSTRAP_ROUTE.includes("export async function POST"));
  assert.ok(!BOOTSTRAP_ROUTE.includes("export async function GET"));
});

test("el cierre manual se atribuye a la persona real que lo ejecuta", () => {
  assert.ok(BOOTSTRAP_ROUTE.includes('generationKind: "bootstrap"'));
  assert.ok(BOOTSTRAP_ROUTE.includes("actorProfileId: auth.profile.id"));
});

test("el mes se pide explícito: no se adivina por la fecha en que se pulse", () => {
  assert.ok(BOOTSTRAP_ROUTE.includes('searchParams.get("periodo")'));
  assert.ok(BOOTSTRAP_ROUTE.includes('"INVALID_PERIOD"'));
  // Y no hay forma de saltarse la guarda de mes terminado desde la ruta.
  assert.ok(!BOOTSTRAP_ROUTE.includes("now:"), "la ruta no debe poder inyectar un reloj propio");
});

test("ninguna ruta puede sobrescribir un cierre existente", () => {
  for (const route of [BOOTSTRAP_ROUTE, CRON_ROUTE]) {
    for (const prohibido of ["upsert", "update", "delete", "force"]) {
      assert.ok(!route.toLowerCase().includes(prohibido), prohibido);
    }
  }
});
