import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { createRequirementSlotsForApplication } from "@/lib/services/requirement-slots";
import { APPLICATION_STATUS_TRANSITIONS } from "@/lib/config/application";
import type { Application, ApplicationListItem, ApplicationSource, ApplicationStatus, LocalizedText } from "@/types";

/**
 * Server-only service for the Application Engine's identity + lifecycle
 * table (Milestone 11 — see the Milestone 11 architecture review and its
 * critical-review follow-up on requested_amount/requested_term_months).
 * Uses the Admin Client, same posture as every other service in this app:
 * RLS is enabled on `applications` with zero policies, so this is the
 * only way to read or write it until a real permissions model exists.
 *
 * Deliberately minimal: create (with slot snapshot), read (single + list),
 * status transition, advisor assignment. No updateApplicationDetails —
 * every immutable field (applicationNumber, clientId, productId,
 * requestedAmount, requestedTermMonths, createdAt, createdByProfileId,
 * createdSource) has no update path anywhere in this file. No delete.
 *
 * No Server Actions wrap this in Milestone 11 — see the implementation
 * report's UI Scope section for why the existing Solicitudes/Dossier UI
 * is not migrated onto this table in this milestone. Callers (dev/
 * verification scripts today, a future UI migration's own Server Actions)
 * invoke this service directly, exactly like requirement-slots.ts was
 * before its own Server Actions existed.
 */

interface ApplicationRow {
  id: string;
  application_number: string;
  client_id: string;
  product_id: string;
  requested_amount: number;
  requested_term_months: number;
  created_at: string;
  created_by_profile_id: string | null;
  created_source: string;
  status: string;
  status_changed_at: string | null;
  status_changed_by_profile_id: string | null;
  status_changed_source: string | null;
  assigned_advisor_profile_id: string | null;
}

const APPLICATION_SELECT =
  "id, application_number, client_id, product_id, requested_amount, requested_term_months, created_at, created_by_profile_id, created_source, status, status_changed_at, status_changed_by_profile_id, status_changed_source, assigned_advisor_profile_id";

function toApplication(row: ApplicationRow): Application {
  return {
    id: row.id,
    applicationNumber: row.application_number,
    clientId: row.client_id,
    productId: row.product_id,
    requestedAmount: row.requested_amount,
    requestedTermMonths: row.requested_term_months,
    createdAt: row.created_at,
    createdByProfileId: row.created_by_profile_id ?? undefined,
    createdSource: row.created_source as ApplicationSource,
    status: row.status as ApplicationStatus,
    statusChangedAt: row.status_changed_at ?? undefined,
    statusChangedByProfileId: row.status_changed_by_profile_id ?? undefined,
    statusChangedSource: (row.status_changed_source as ApplicationSource | null) ?? undefined,
    assignedAdvisorProfileId: row.assigned_advisor_profile_id ?? undefined,
  };
}

/**
 * getApplications()-only row shape (Milestone 13B) — ApplicationRow plus
 * the two embeds the future Solicitudes list/kanban needs to render
 * without doing its own demo-data-style lookups. Not used by any other
 * function in this file: getApplicationById/getApplicationByLegacyId/
 * createApplication/setApplicationStatus/assignApplicationAdvisor stay on
 * the bare APPLICATION_SELECT, since none of them are display reads (see
 * the Milestone 13A architecture review's "Application Workspace"
 * question — extending the existing list read, not introducing a second
 * read model, and not paying a join cost anywhere it isn't needed).
 */
interface ApplicationListRow extends ApplicationRow {
  product: { code: string; name: Record<string, string> } | null;
  advisor: { full_name: string } | null;
  client: { full_name: string } | null;
  created_by: { full_name: string } | null;
  status_changed_by: { full_name: string } | null;
}

// Same !constraint embed-hint pattern already used throughout this app
// (document-evidence.ts, requirement-slots.ts, document-workspace.ts).
// product_id and client_id are both `not null` at the schema level, so
// the product and client embeds are always resolved; assigned_advisor_
// profile_id is independently nullable, so the advisor embed is not.
// Resolving the client's name here (Milestone 14E) is what lets
// Solicitudes/the Clientes application count/Document Workspace display a
// client name and route to its real Dossier without their own
// browser-side lookup or a second query — see the Milestone 14E
// implementation report's Solicitudes section.
const APPLICATION_LIST_SELECT =
  `${APPLICATION_SELECT}, ` +
  "product:products!applications_product_id_fkey(code, name), " +
  "advisor:profiles!applications_assigned_advisor_profile_id_fkey(full_name), " +
  "client:clients!applications_client_id_fkey(full_name), " +
  // Milestone 19: two further profile embeds so the Dossier's Activity
  // feed can name who created an application and who performed its most
  // recent status change WITHOUT issuing a query of its own. Purely
  // additive — same !constraint embed idiom as the three above, and both
  // FKs are independently nullable, so both embeds resolve to null for
  // automated (non-CRM) writes rather than failing.
  "created_by:profiles!applications_created_by_profile_id_fkey(full_name), " +
  "status_changed_by:profiles!applications_status_changed_by_profile_id_fkey(full_name)";

function toApplicationListItem(row: ApplicationListRow): ApplicationListItem {
  return {
    ...toApplication(row),
    productCode: row.product?.code ?? "",
    productName: (row.product?.name as LocalizedText | undefined) ?? ({} as LocalizedText),
    assignedAdvisorFullName: row.advisor?.full_name ?? undefined,
    clientFullName: row.client?.full_name ?? "",
    createdByFullName: row.created_by?.full_name ?? undefined,
    statusChangedByFullName: row.status_changed_by?.full_name ?? undefined,
  };
}

export type GetApplicationByIdResult =
  | { status: "ok"; application: Application }
  | { status: "error"; code: "NOT_FOUND" | "QUERY_FAILED" };

/** Loads a single application by id. No fallback to demo data on failure —
 * there is no demo data backing this table (see the implementation
 * report's UI Scope section: the existing demo Solicitudes/Dossier views
 * are not wired to this table in this milestone). */
export async function getApplicationById(applicationId: string): Promise<GetApplicationByIdResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("applications")
      .select(APPLICATION_SELECT)
      .eq("id", applicationId)
      .maybeSingle<ApplicationRow>();

    if (error) {
      console.error("[applications service] Failed to load application:", error.message);
      return { status: "error", code: "QUERY_FAILED" };
    }
    if (!data) {
      return { status: "error", code: "NOT_FOUND" };
    }

    return { status: "ok", application: toApplication(data) };
  } catch (error) {
    console.error(
      "[applications service] Unexpected failure loading application:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error", code: "QUERY_FAILED" };
  }
}

/**
 * Loads a single application by its temporary demo-data bridge id
 * (applications.legacy_id — see the Milestone 11 architecture review).
 * Added in Milestone 12C so the Dossier can resolve which real Application
 * (if any) corresponds to the demo LoanApplication currently on screen,
 * without the Dossier ever needing to know a real UUID up front. Returns
 * NOT_FOUND — never invents or guesses — when no application has this
 * legacy_id, which is the expected, common case for every demo
 * application except ap-001 today; callers must treat that as "not yet
 * migrated," not as an error to alarm on.
 */
export async function getApplicationByLegacyId(legacyId: string): Promise<GetApplicationByIdResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("applications")
      .select(APPLICATION_SELECT)
      .eq("legacy_id", legacyId)
      .maybeSingle<ApplicationRow>();

    if (error) {
      console.error("[applications service] Failed to load application by legacy id:", error.message);
      return { status: "error", code: "QUERY_FAILED" };
    }
    if (!data) {
      return { status: "error", code: "NOT_FOUND" };
    }

    return { status: "ok", application: toApplication(data) };
  } catch (error) {
    console.error(
      "[applications service] Unexpected failure loading application by legacy id:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error", code: "QUERY_FAILED" };
  }
}

export type GetApplicationsResult = { status: "ok"; applications: ApplicationListItem[] } | { status: "error" };

/**
 * Loads every application, newest first, with its Product code/name and
 * assigned advisor's name resolved via embedded joins — everything the
 * future Solicitudes list/kanban needs to render a row without its own
 * demo-data-style lookups (Milestone 13B foundation layer; see the
 * Milestone 13A architecture review and its final validation). No UI
 * calls this yet — this milestone is additive only.
 *
 * Deliberately no filter parameters yet (by client, product, status,
 * advisor) — no consumer needs one until a real UI is migrated onto this
 * table; adding filters later is purely additive, not a redesign.
 */
export async function getApplications(): Promise<GetApplicationsResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("applications")
      .select(APPLICATION_LIST_SELECT)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[applications service] Failed to load applications:", error.message);
      return { status: "error" };
    }

    const rows = (data ?? []) as unknown as ApplicationListRow[];
    return { status: "ok", applications: rows.map(toApplicationListItem) };
  } catch (error) {
    console.error(
      "[applications service] Unexpected failure loading applications:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

export interface CreateApplicationInput {
  clientId: string;
  productId: string;
  requestedAmount: number;
  requestedTermMonths: number;
  source: ApplicationSource;
  /** Only valid (and only used) when source === "crm_manual" — see
   * applications_created_by_source_check. */
  actorProfileId: string | null;
}

export type CreateApplicationResult =
  | { status: "ok"; application: Application }
  | { status: "partial"; application: Application; code: "SLOT_SNAPSHOT_FAILED" }
  | { status: "error"; code: "INVALID_INPUT" | "INVALID_ACTOR" | "INSERT_FAILED" };

/**
 * Creates an application, then immediately snapshots Requirement Slots
 * for it via the existing, unmodified Slot mechanism (requirement-slots.ts
 * #createRequirementSlotsForApplication) — see the Milestone 11
 * architecture review's "Requirement Slot Relationship" section for why
 * this must happen as one immediate operation, not lazily.
 *
 * Failure-safety, given the Supabase JS client offers no true
 * multi-statement transaction spanning both inserts (an already-accepted
 * limitation carried forward from the Milestone 10B architecture review's
 * Risks section): the application row is written first. If the slot
 * snapshot step then fails, this function does NOT delete the just-created
 * application (this schema never hard-deletes anything) and does NOT
 * silently report full success — it returns a distinct "partial" result
 * carrying the created application and a SLOT_SNAPSHOT_FAILED code, so the
 * caller knows exactly what happened. The concrete mitigation: retrying
 * is always safe. createRequirementSlotsForApplication's own upsert is
 * idempotent (ignoreDuplicates on unique(application_id,
 * requirement_template_id)), so calling it again — with this same
 * application's id — for as many attempts as needed will never create
 * duplicate or conflicting slots, whether the first attempt snapshotted
 * zero, some, or all of the active templates before failing.
 */
export async function createApplication(input: CreateApplicationInput): Promise<CreateApplicationResult> {
  if (input.actorProfileId !== null && input.source !== "crm_manual") {
    return { status: "error", code: "INVALID_ACTOR" };
  }
  if (!(input.requestedAmount > 0) || !(input.requestedTermMonths > 0 && input.requestedTermMonths <= 360)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const supabase = getSupabaseServerClient();

  const { data: inserted, error: insertError } = await supabase
    .from("applications")
    .insert({
      client_id: input.clientId,
      product_id: input.productId,
      requested_amount: input.requestedAmount,
      requested_term_months: input.requestedTermMonths,
      created_by_profile_id: input.actorProfileId,
      created_source: input.source,
    })
    .select(APPLICATION_SELECT)
    .single<ApplicationRow>();

  if (insertError || !inserted) {
    console.error(
      "[applications service] Failed to insert application:",
      insertError?.message ?? "no row returned"
    );
    return { status: "error", code: "INSERT_FAILED" };
  }

  const application = toApplication(inserted);

  const slotResult = await createRequirementSlotsForApplication(application.id, input.productId);
  if (slotResult.status !== "ok") {
    console.error(
      "[applications service] Application created but requirement slot snapshot failed — safe to retry " +
        "createRequirementSlotsForApplication with this same application id:",
      slotResult.code
    );
    return { status: "partial", application, code: "SLOT_SNAPSHOT_FAILED" };
  }

  return { status: "ok", application };
}

export type SetApplicationStatusResult =
  | { status: "ok"; application: Application }
  | { status: "error"; code: "NOT_FOUND" | "INVALID_ACTOR" | "INVALID_TRANSITION" | "UPDATE_FAILED" };

/**
 * Transitions an application's status, enforcing
 * APPLICATION_STATUS_TRANSITIONS server-side. Same multi-actor posture as
 * requirement-slots.ts#setRequirementSlotStatus: source identifies which
 * channel/actor-type made the change, and actorProfileId is only ever
 * populated (and only ever valid) when source is "crm_manual" — mirrors
 * applications_status_changed_by_source_check, re-validated here first so
 * a misuse returns a clear INVALID_ACTOR result instead of a raw
 * constraint violation.
 *
 * Same race-safety idiom as every other status-transition function in
 * this app: reads the current status, validates the transition, then
 * writes status/status_changed_at/status_changed_by_profile_id/status_
 * changed_source together in one guarded UPDATE (`.eq("status",
 * currentStatus)`) — a concurrent change in between makes the guard match
 * zero rows, returning INVALID_TRANSITION rather than silently
 * overwriting a change this call never validated.
 */
export async function setApplicationStatus(
  applicationId: string,
  targetStatus: ApplicationStatus,
  source: ApplicationSource,
  actorProfileId: string | null
): Promise<SetApplicationStatusResult> {
  if (actorProfileId !== null && source !== "crm_manual") {
    return { status: "error", code: "INVALID_ACTOR" };
  }

  const supabase = getSupabaseServerClient();

  const { data: current, error: fetchError } = await supabase
    .from("applications")
    .select("status")
    .eq("id", applicationId)
    .maybeSingle();

  if (fetchError) {
    console.error(
      "[applications service] Failed to look up application before status change:",
      fetchError.message
    );
    return { status: "error", code: "UPDATE_FAILED" };
  }
  if (!current) {
    return { status: "error", code: "NOT_FOUND" };
  }

  const currentStatus = current.status as ApplicationStatus;
  if (!APPLICATION_STATUS_TRANSITIONS[currentStatus].includes(targetStatus)) {
    return { status: "error", code: "INVALID_TRANSITION" };
  }

  // MILESTONE 20: the write goes through record_application_status_change, a
  // SECURITY DEFINER function that performs this exact guarded UPDATE and
  // appends the crm_events row in ONE transaction. The transition graph above
  // stays canonical in src/lib/config/application.ts — the function never
  // re-encodes it; it only reproduces the `status = currentStatus` guard, so
  // a concurrent change still matches zero rows and still returns
  // INVALID_TRANSITION rather than silently overwriting.
  const { data: changedId, error: rpcError } = await supabase.rpc(
    "record_application_status_change",
    {
      p_application_id: applicationId,
      p_expected_status: currentStatus,
      p_new_status: targetStatus,
      p_source: source,
      p_actor_profile_id: actorProfileId,
    }
  );

  if (rpcError) {
    console.error("[applications service] Failed to update application status:", rpcError.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }
  // NULL means the guard matched nothing — same meaning the previous
  // `.maybeSingle()` returning no row had.
  if (!changedId) {
    return { status: "error", code: "INVALID_TRANSITION" };
  }

  // Re-read to build the return value. The function returns only the id so
  // that this service keeps its own SELECT (and, elsewhere, its PostgREST
  // embeds) as the single definition of the row shape it returns.
  const { data: updated, error: readError } = await supabase
    .from("applications")
    .select(APPLICATION_SELECT)
    .eq("id", applicationId)
    .maybeSingle<ApplicationRow>();

  if (readError || !updated) {
    console.error(
      "[applications service] Status changed but the application could not be re-read:",
      readError?.message ?? "no row returned"
    );
    return { status: "error", code: "UPDATE_FAILED" };
  }

  return { status: "ok", application: toApplication(updated) };
}

export type AssignApplicationAdvisorResult =
  | { status: "ok"; application: Application }
  | { status: "error"; code: "NOT_FOUND" | "INVALID_ADVISOR" | "UPDATE_FAILED" };

/**
 * Reassigns (or unassigns, when advisorProfileId is null) which advisor
 * owns this application. Unlike status, there is no legality graph to
 * enforce — any profile may replace any other at any time.
 *
 * MILESTONE 23: this function existed from Milestone 13B onward with NO
 * Server Action and NO UI, so ODL could never actually put a file in an
 * advisor's hands. It is now reachable, and consequently now audited.
 *
 * The direct UPDATE it used to perform is replaced by
 * record_application_advisor_assignment, which locks the row, reads the
 * advisor it is replacing, writes the change and appends the reserved
 * `application_advisor_assigned` event in ONE transaction. The old comment
 * here noted that "no accompanying audit-trail columns exist for this field";
 * that is still true of the `applications` table, and is exactly why the
 * history now lives in crm_events instead — a dedicated set of
 * advisor_changed_at/by columns would have recorded only the most recent
 * reassignment, which is the problem Milestone 20 was created to solve.
 *
 * The event stores profile IDs only — never staff name, e-mail or role.
 *
 * INVALID_ADVISOR is returned when the target profile does not exist or is
 * deactivated: assigning a file to someone who cannot sign in produces an
 * application nobody actually owns. A no-op reassignment (same advisor,
 * including null -> null) is a success and writes no event.
 */
export async function assignApplicationAdvisor(
  applicationId: string,
  advisorProfileId: string | null,
  actorProfileId: string | null
): Promise<AssignApplicationAdvisorResult> {
  const supabase = getSupabaseServerClient();

  const { data: changedId, error: rpcError } = await supabase.rpc(
    "record_application_advisor_assignment",
    {
      p_application_id: applicationId,
      p_advisor_profile_id: advisorProfileId,
      p_actor_profile_id: actorProfileId,
    }
  );

  if (rpcError) {
    // 22023 is the function's own "advisor missing or inactive" guard; 23503
    // would be the foreign key, which the guard normally reaches first.
    if (rpcError.code === "22023" || rpcError.code === "23503") {
      return { status: "error", code: "INVALID_ADVISOR" };
    }
    console.error("[applications service] Failed to update assigned advisor:", rpcError.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }
  if (!changedId) {
    return { status: "error", code: "NOT_FOUND" };
  }

  const { data: updated, error } = await supabase
    .from("applications")
    .select(APPLICATION_SELECT)
    .eq("id", applicationId)
    .maybeSingle<ApplicationRow>();

  if (error) {
    console.error("[applications service] Advisor changed but re-read failed:", error.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }
  if (!updated) {
    return { status: "error", code: "NOT_FOUND" };
  }

  return { status: "ok", application: toApplication(updated) };
}
