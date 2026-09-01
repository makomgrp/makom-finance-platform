import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { classifyPortalFunnelState } from "@/lib/config/portal-funnel";
import type { ReportingPeriod } from "@/lib/reporting/period";
import type { ApplicationSource } from "@/types/application";
import type {
  ApplicationExportRow,
  DetailedExportData,
  DocumentExportRow,
  FollowUpExportRow,
  LeadExportRow,
  LocalizedCell,
} from "@/lib/reporting/export-types";

/**
 * ============================================================================
 * MILESTONE 26B-26F — LA CAPA DE DETALLE, EN EL SERVIDOR Y SOLO AHÍ
 * ============================================================================
 *
 * `import "server-only"`: si alguien importa este módulo desde un componente de
 * cliente, la compilación falla. No es una convención, es la barrera que impide
 * que la cartera de clientes de ODL acabe en un bundle del navegador.
 *
 * ----------------------------------------------------------------------------
 * POR QUÉ ES UNA CAPA APARTE Y NO UNA AMPLIACIÓN DE `reporting.ts`
 * ----------------------------------------------------------------------------
 * Porque responden preguntas distintas y deben poder romperse por separado.
 * `reporting.ts` devuelve CIFRAS y es la única fuente de los totales; este
 * módulo devuelve FILAS con datos personales. Mezclarlos habría significado que
 * la función que alimenta el Dashboard —una pantalla que ve más gente— empezara
 * a arrastrar nombres y cédulas por si acaso.
 *
 * NO RECALCULA NI UN TOTAL. Los agregados del libro salen enteros de
 * `getReportingComparison`, la misma función que pinta el Dashboard e imprime
 * el PDF. Aquí no hay una segunda aritmética esperando a discrepar con ella:
 * hay filas, y las filas se listan, no se suman.
 *
 * ----------------------------------------------------------------------------
 * SIN N+1, POR DISEÑO
 * ----------------------------------------------------------------------------
 * Ocho consultas fijas, independientemente de cuántas solicitudes tenga el
 * período. Se lee primero la población, se recogen los identificadores y se
 * resuelven las tablas relacionadas en lote. Un bucle que consultara el cliente
 * de cada solicitud funcionaría con las 15 de hoy y tumbaría la petición el mes
 * que ODL tenga mil.
 *
 * ----------------------------------------------------------------------------
 * SOLO LECTURA
 * ----------------------------------------------------------------------------
 * Ni un `insert`, ni un `update`, ni un `delete`. Exportar es mirar. La única
 * escritura de todo el milestone es el evento de auditoría, que ocurre en la
 * ruta y a través de su propia RPC.
 */

/** Las dos poblaciones del libro se definen por fechas distintas, y se dice. */
type Period = ReportingPeriod;

function rangeArgs(period: Period) {
  return { from: period.from.toISOString(), to: period.to.toISOString() };
}

/** `null` cuando el número no existe; nunca 0 por descarte. */
function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function localized(value: unknown): LocalizedCell | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as LocalizedCell)
    : null;
}

/** Índice id → fila, para cruzar en memoria en vez de una consulta por fila. */
function indexById<T extends { id: string }>(rows: T[] | null | undefined): Map<string, T> {
  return new Map((rows ?? []).map((row) => [row.id, row]));
}

/** Los ids no nulos y sin repetir de una columna — la entrada de cada `.in()`. */
function collectIds(rows: Record<string, unknown>[], key: string): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    const value = row[key];
    if (typeof value === "string" && value.length > 0) ids.add(value);
  }
  return [...ids];
}

export type DetailedExportResult =
  | { status: "ok"; data: DetailedExportData }
  | { status: "error" };

/**
 * Todo el detalle de un período, listo para volcarse en un libro.
 *
 * FALLA ENTERO O NO FALLA. Si cualquiera de las consultas devuelve error, el
 * resultado es `{ status: "error" }` y la ruta responde 503. Un Excel al que le
 * falta media hoja porque una consulta se cayó es peor que ningún Excel: se ve
 * completo, se archiva y se cita.
 */
export async function getDetailedExportData(period: Period): Promise<DetailedExportResult> {
  const supabase = getSupabaseServerClient();
  const { from, to } = rangeArgs(period);

  try {
    // ---------------------------------------------------------------------
    // 1. Las dos poblaciones, y los seguimientos del período
    // ---------------------------------------------------------------------
    const [applicationsRes, intakesRes, followUpsRes] = await Promise.all([
      supabase
        .from("applications")
        .select(
          "id, application_number, created_at, created_source, status, status_changed_at, " +
            "product_id, requested_amount, approved_amount, requested_term_months, " +
            "client_id, assigned_advisor_profile_id, created_by_profile_id, branch_id"
        )
        .gte("created_at", from)
        .lt("created_at", to)
        .order("created_at", { ascending: true }),

      supabase
        .from("application_intakes")
        .select(
          "id, channel, status, applicant_full_name, applicant_identification_type, " +
            "applicant_identification_number, applicant_email, applicant_phone, " +
            "employer_name, monthly_salary, requested_product_code, requested_amount, " +
            "requested_term_months, locale, current_step, last_activity_at, submitted_at, " +
            "received_at, matched_client_id, created_application_id, " +
            "attribution_utm_source, attribution_utm_medium, attribution_utm_campaign, " +
            "attribution_utm_content, attribution_utm_term, attribution_referrer_host, " +
            "attribution_landing_path"
        )
        .gte("received_at", from)
        .lt("received_at", to)
        .order("received_at", { ascending: true }),

      supabase
        .from("application_follow_ups")
        // `note` NO se selecciona. Ver el contrato: es texto libre interno.
        .select(
          "id, application_id, author_profile_id, contacted_at, contact_method, outcome, " +
            "next_action, next_action_at, completed_at, completed_by_profile_id"
        )
        .gte("contacted_at", from)
        .lt("contacted_at", to)
        .order("contacted_at", { ascending: true }),
    ]);

    if (applicationsRes.error || intakesRes.error || followUpsRes.error) {
      console.error(
        "[detailed export] population query failed:",
        applicationsRes.error?.message ??
          intakesRes.error?.message ??
          followUpsRes.error?.message
      );
      return { status: "error" };
    }

    // El cliente de Supabase tipa `data` como una unión que incluye su propia
    // forma de error. El `error` ya se comprobó justo arriba, así que pasar por
    // `unknown` es la conversión honesta: reconoce que se está descartando una
    // rama imposible en lugar de fingir que los dos tipos se solapan.
    const applications = (applicationsRes.data ?? []) as unknown as Record<string, unknown>[];
    const intakes = (intakesRes.data ?? []) as unknown as Record<string, unknown>[];
    const followUps = (followUpsRes.data ?? []) as unknown as Record<string, unknown>[];

    // ---------------------------------------------------------------------
    // 2. Lo relacionado, en lote
    // ---------------------------------------------------------------------
    // Los seguimientos pueden apuntar a solicitudes ANTERIORES al período: un
    // contacto de agosto sobre un expediente de julio es un seguimiento de
    // agosto. Sus solicitudes se piden aparte en vez de asumir que ya están.
    const applicationIds = collectIds(applications, "id");
    const followUpApplicationIds = collectIds(followUps, "application_id").filter(
      (id) => !applicationIds.includes(id)
    );
    const clientIds = collectIds(applications, "client_id");

    const [
      extraApplicationsRes,
      clientsRes,
      productsRes,
      profilesRes,
      branchesRes,
      slotsRes,
    ] = await Promise.all([
      followUpApplicationIds.length > 0
        ? supabase
            .from("applications")
            .select("id, application_number, client_id")
            .in("id", followUpApplicationIds)
        : Promise.resolve({ data: [], error: null }),

      clientIds.length > 0
        ? supabase
            .from("clients")
            .select(
              "id, full_name, identification_type, identification_number, phone, email, " +
                "employer_name, monthly_salary, status"
            )
            .in("id", clientIds)
        : Promise.resolve({ data: [], error: null }),

      // Catálogos pequeños y acotados: se traen enteros en una consulta en vez
      // de filtrarlos por los ids del período, que costaría lo mismo.
      supabase.from("products").select("id, name"),
      supabase.from("profiles").select("id, full_name"),
      supabase.from("branches").select("id, name"),

      applicationIds.length > 0
        ? supabase
            .from("requirement_slots")
            // Ni `storage_path`, ni `file_sha256`, ni `metadata`: no se piden.
            .select(
              "id, application_id, code, name, requirement_kind, required, " +
                "applicant_visible, status, status_changed_at"
            )
            .in("application_id", applicationIds)
            .order("display_order", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (
      extraApplicationsRes.error ||
      clientsRes.error ||
      productsRes.error ||
      profilesRes.error ||
      branchesRes.error ||
      slotsRes.error
    ) {
      console.error(
        "[detailed export] lookup query failed:",
        extraApplicationsRes.error?.message ??
          clientsRes.error?.message ??
          productsRes.error?.message ??
          profilesRes.error?.message ??
          branchesRes.error?.message ??
          slotsRes.error?.message
      );
      return { status: "error" };
    }

    const slots = (slotsRes.data ?? []) as Record<string, unknown>[];
    const slotIds = collectIds(slots, "id");

    // Las evidencias se resumen a recuento y fechas. El binario, el nombre del
    // archivo y la ruta de almacenamiento no se leen siquiera.
    const documentsRes =
      slotIds.length > 0
        ? await supabase
            .from("dossier_documents")
            .select("id, requirement_slot_id, uploaded_at, reviewed_at, reviewed_by_profile_id")
            .in("requirement_slot_id", slotIds)
        : { data: [], error: null };

    if (documentsRes.error) {
      console.error("[detailed export] evidence query failed:", documentsRes.error.message);
      return { status: "error" };
    }

    // ---------------------------------------------------------------------
    // 3. Cruce en memoria
    // ---------------------------------------------------------------------
    const clientById = indexById(clientsRes.data as { id: string }[] | null);
    const productById = indexById(productsRes.data as { id: string }[] | null);
    const profileById = indexById(profilesRes.data as { id: string }[] | null);
    const branchById = indexById(branchesRes.data as { id: string }[] | null);

    const nameOf = (id: unknown): string | null => {
      if (typeof id !== "string") return null;
      const profile = profileById.get(id) as { full_name?: string } | undefined;
      return profile?.full_name ?? null;
    };

    const applicationRows: ApplicationExportRow[] = applications.map((row) => {
      const client = clientById.get(String(row.client_id ?? "")) as
        | Record<string, unknown>
        | undefined;
      const product = productById.get(String(row.product_id ?? "")) as
        | Record<string, unknown>
        | undefined;
      const branch = branchById.get(String(row.branch_id ?? "")) as
        | Record<string, unknown>
        | undefined;

      return {
        applicationNumber: String(row.application_number ?? ""),
        createdAt: String(row.created_at),
        createdSource: String(row.created_source ?? ""),
        status: String(row.status ?? ""),
        statusChangedAt: (row.status_changed_at as string | null) ?? null,
        productName: localized(product?.name),
        requestedAmount: numberOrNull(row.requested_amount),
        approvedAmount: numberOrNull(row.approved_amount),
        requestedTermMonths: numberOrNull(row.requested_term_months),
        clientFullName: (client?.full_name as string | null) ?? null,
        clientIdentificationType: (client?.identification_type as string | null) ?? null,
        clientIdentificationNumber: (client?.identification_number as string | null) ?? null,
        clientPhone: (client?.phone as string | null) ?? null,
        clientEmail: (client?.email as string | null) ?? null,
        clientEmployerName: (client?.employer_name as string | null) ?? null,
        clientMonthlySalary: numberOrNull(client?.monthly_salary),
        clientStatus: (client?.status as string | null) ?? null,
        advisorName: nameOf(row.assigned_advisor_profile_id),
        createdByName: nameOf(row.created_by_profile_id),
        branchName: (branch?.name as string | null) ?? null,
      };
    });

    const leadRows: LeadExportRow[] = intakes.map((row) => ({
      receivedAt: String(row.received_at),
      status: String(row.status ?? ""),
      channel: String(row.channel ?? ""),
      applicantFullName: (row.applicant_full_name as string | null) ?? null,
      applicantIdentificationType: (row.applicant_identification_type as string | null) ?? null,
      applicantIdentificationNumber:
        (row.applicant_identification_number as string | null) ?? null,
      applicantEmail: (row.applicant_email as string | null) ?? null,
      applicantPhone: (row.applicant_phone as string | null) ?? null,
      employerName: (row.employer_name as string | null) ?? null,
      monthlySalary: numberOrNull(row.monthly_salary),
      requestedProductCode: (row.requested_product_code as string | null) ?? null,
      requestedAmount: numberOrNull(row.requested_amount),
      requestedTermMonths: numberOrNull(row.requested_term_months),
      locale: (row.locale as string | null) ?? null,
      currentStep: numberOrNull(row.current_step),
      lastActivityAt: (row.last_activity_at as string | null) ?? null,
      submittedAt: (row.submitted_at as string | null) ?? null,
      matchedExistingClient: Boolean(row.matched_client_id),
      becameApplication: Boolean(row.created_application_id),
      // EL MISMO CLASIFICADOR QUE EL EMBUDO. Los umbrales de estancamiento y
      // abandono viven en `config/portal-funnel.ts` y esta hoja los consulta
      // ahí, no los reimplementa: una segunda definición de «abandonado» haría
      // que el Excel y el Dashboard discreparan sin que nadie lo notara.
      portalState: classifyPortalFunnelState({
        // `application_intakes.channel` y `ApplicationSource` son el mismo
        // vocabulario cerrado (application_intakes_channel_check), así que el
        // valor pasa tal cual en vez de traducirse: cualquier reescritura aquí
        // sería una segunda opinión sobre qué cuenta como portal.
        createdSource: String(row.channel ?? "crm_manual") as ApplicationSource,
        submittedAt: (row.submitted_at as string | null) ?? null,
        lastActivityAt: String(row.last_activity_at ?? row.received_at),
      }),
      attributionUtmSource: (row.attribution_utm_source as string | null) ?? null,
      attributionUtmMedium: (row.attribution_utm_medium as string | null) ?? null,
      attributionUtmCampaign: (row.attribution_utm_campaign as string | null) ?? null,
      attributionUtmContent: (row.attribution_utm_content as string | null) ?? null,
      attributionUtmTerm: (row.attribution_utm_term as string | null) ?? null,
      attributionReferrerHost: (row.attribution_referrer_host as string | null) ?? null,
      attributionLandingPath: (row.attribution_landing_path as string | null) ?? null,
    }));

    // Evidencias agrupadas por requisito: recuento y fechas extremas.
    const evidenceBySlot = new Map<
      string,
      { count: number; lastUploadedAt: string | null; lastReviewedAt: string | null; reviewerId: string | null }
    >();
    for (const doc of (documentsRes.data ?? []) as Record<string, unknown>[]) {
      const slotId = String(doc.requirement_slot_id ?? "");
      if (!slotId) continue;
      const current =
        evidenceBySlot.get(slotId) ??
        { count: 0, lastUploadedAt: null, lastReviewedAt: null, reviewerId: null };
      current.count += 1;

      const uploadedAt = (doc.uploaded_at as string | null) ?? null;
      if (uploadedAt && (!current.lastUploadedAt || uploadedAt > current.lastUploadedAt)) {
        current.lastUploadedAt = uploadedAt;
      }
      const reviewedAt = (doc.reviewed_at as string | null) ?? null;
      if (reviewedAt && (!current.lastReviewedAt || reviewedAt > current.lastReviewedAt)) {
        current.lastReviewedAt = reviewedAt;
        current.reviewerId = (doc.reviewed_by_profile_id as string | null) ?? null;
      }
      evidenceBySlot.set(slotId, current);
    }

    const applicationByIdRow = new Map(
      applications.map((row) => [String(row.id), row] as const)
    );
    for (const row of (extraApplicationsRes.data ?? []) as Record<string, unknown>[]) {
      applicationByIdRow.set(String(row.id), row);
    }

    const documentRows: DocumentExportRow[] = slots.map((slot) => {
      const application = applicationByIdRow.get(String(slot.application_id ?? ""));
      const client = clientById.get(String(application?.client_id ?? "")) as
        | Record<string, unknown>
        | undefined;
      const evidence = evidenceBySlot.get(String(slot.id));

      return {
        applicationNumber: String(application?.application_number ?? ""),
        clientFullName: (client?.full_name as string | null) ?? null,
        code: String(slot.code ?? ""),
        name: localized(slot.name),
        requirementKind: String(slot.requirement_kind ?? ""),
        required: Boolean(slot.required),
        applicantVisible: Boolean(slot.applicant_visible),
        status: String(slot.status ?? ""),
        statusChangedAt: (slot.status_changed_at as string | null) ?? null,
        fileCount: evidence?.count ?? 0,
        lastUploadedAt: evidence?.lastUploadedAt ?? null,
        lastReviewedAt: evidence?.lastReviewedAt ?? null,
        reviewerName: nameOf(evidence?.reviewerId),
      };
    });

    const followUpRows: FollowUpExportRow[] = followUps.map((row) => {
      const application = applicationByIdRow.get(String(row.application_id ?? ""));
      const client = clientById.get(String(application?.client_id ?? "")) as
        | Record<string, unknown>
        | undefined;

      return {
        contactedAt: String(row.contacted_at),
        applicationNumber: (application?.application_number as string | null) ?? null,
        clientFullName: (client?.full_name as string | null) ?? null,
        contactMethod: String(row.contact_method ?? ""),
        outcome: String(row.outcome ?? ""),
        nextAction: (row.next_action as string | null) ?? null,
        nextActionAt: (row.next_action_at as string | null) ?? null,
        completedAt: (row.completed_at as string | null) ?? null,
        authorName: nameOf(row.author_profile_id),
        completedByName: nameOf(row.completed_by_profile_id),
      };
    });

    return {
      status: "ok",
      data: {
        applications: applicationRows,
        leads: leadRows,
        documents: documentRows,
        followUps: followUpRows,
      },
    };
  } catch (error) {
    console.error(
      "[detailed export] unexpected failure:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

/**
 * ============================================================================
 * EL EVENTO DE AUDITORÍA
 * ============================================================================
 *
 * La única escritura de todo el milestone. Va por la RPC
 * `record_sensitive_export_event` porque `crm_events` tiene RLS sin políticas y
 * a `service_role` solo le concede SELECT: ni el servidor puede insertar
 * directamente. Es la misma arquitectura que usan todas las escrituras
 * auditadas del proyecto.
 *
 * NO GUARDA NADA DE LO EXPORTADO. Quién, cuándo, qué período, qué formato y
 * cuántas filas. Meter un solo nombre aquí sería duplicar la PII dentro de la
 * tabla que existe precisamente para vigilarla.
 *
 * Devuelve un booleano en vez de lanzar: quien llama decide qué significa que
 * la auditoría falle. En la ruta significa que la descarga NO sale.
 */
export async function recordSensitiveExportEvent(input: {
  actorProfileId: string;
  format: string;
  periodKind: string;
  periodFrom: Date;
  periodTo: Date;
  rowCounts: Record<string, number>;
}): Promise<boolean> {
  const supabase = getSupabaseServerClient();

  const { error } = await supabase.rpc("record_sensitive_export_event", {
    p_actor_profile_id: input.actorProfileId,
    p_format: input.format,
    p_period_kind: input.periodKind,
    p_period_from: input.periodFrom.toISOString(),
    p_period_to: input.periodTo.toISOString(),
    p_row_counts: input.rowCounts,
  });

  if (error) {
    console.error("[detailed export] audit event failed:", error.message);
    return false;
  }
  return true;
}
