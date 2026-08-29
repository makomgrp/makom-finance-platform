import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { applyBranchScope, isBranchDeniedError, isEmptyScope } from "@/lib/services/branch-scope-query";
import { branchOriginEmbed, toBranchOrigin, type BranchOriginRow } from "@/lib/services/branch-origin";
import { createRequirementSlotsForApplication } from "@/lib/services/requirement-slots";
import { APPLICATION_STATUS_TRANSITIONS } from "@/lib/config/application";
import { FORMAL_APPLICATION_STATUSES } from "@/types";
import type {
  Application,
  ApplicationListItem,
  ApplicationSource,
  ApplicationStatus,
  BranchScope,
  LocalizedText,
} from "@/types";

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
  approved_amount: number | null;
  requested_term_months: number | null;
  created_at: string;
  created_by_profile_id: string | null;
  created_source: string;
  status: string;
  status_changed_at: string | null;
  status_changed_by_profile_id: string | null;
  status_changed_source: string | null;
  assigned_advisor_profile_id: string | null;
  branch: BranchOriginRow | null;
}

/**
 * MILESTONE 26B-23C — the money ceiling this system already applies.
 *
 * Same value the portal's own validators use for `requestedAmount`
 * (src/lib/validation/portal-step-one.ts, public-application-intake.ts), so a
 * figure ODL may approve cannot exceed one an applicant may request. It sits
 * well inside numeric(12,2)'s own limit; the point is consistency with the
 * business ceiling, not with the column's arithmetic maximum.
 */
const MAX_MONEY_AMOUNT = 99_999_999.99;

const APPLICATION_SELECT =
  // MILESTONE 26B-23C — approved_amount joins the ONE select every application
  // read is built from, so no surface that loads a whole application silently
  // loses ODL's own figure while showing the customer's.
  "id, application_number, client_id, product_id, requested_amount, approved_amount, requested_term_months, created_at, created_by_profile_id, created_source, status, status_changed_at, status_changed_by_profile_id, status_changed_source, assigned_advisor_profile_id, " +
  // MILESTONE 25C-2 — the application's OWN branch, never inferred from its
  // client. 25B-3 transfers the two independently, so a file may legitimately
  // sit in David while its client's home branch is Panamá; reading one from the
  // other would quietly erase that fact. Left embed, so unassigned survives.
  branchOriginEmbed("applications_branch_id_fkey");

function toApplication(row: ApplicationRow): Application {
  return {
    id: row.id,
    applicationNumber: row.application_number,
    clientId: row.client_id,
    productId: row.product_id,
    requestedAmount: row.requested_amount,
    // NULL => undefined: "ODL has not decided an amount", never zero (26B-23C).
    approvedAmount: row.approved_amount ?? undefined,
    // NULL => undefined: "not yet determined" (26B-1A), never zero.
    requestedTermMonths: row.requested_term_months ?? undefined,
    createdAt: row.created_at,
    createdByProfileId: row.created_by_profile_id ?? undefined,
    createdSource: row.created_source as ApplicationSource,
    status: row.status as ApplicationStatus,
    statusChangedAt: row.status_changed_at ?? undefined,
    statusChangedByProfileId: row.status_changed_by_profile_id ?? undefined,
    statusChangedSource: (row.status_changed_source as ApplicationSource | null) ?? undefined,
    assignedAdvisorProfileId: row.assigned_advisor_profile_id ?? undefined,
    branchOrigin: toBranchOrigin(row.branch),
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
export async function getApplicationById(
  scope: BranchScope,
  applicationId: string
): Promise<GetApplicationByIdResult> {
  // Out of scope => NOT_FOUND, never FORBIDDEN. See getClientById.
  if (isEmptyScope(scope)) return { status: "error", code: "NOT_FOUND" };

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await applyBranchScope(
      supabase.from("applications").select(APPLICATION_SELECT).eq("id", applicationId),
      scope
    ).maybeSingle<ApplicationRow>();

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
export async function getApplicationByLegacyId(
  scope: BranchScope,
  legacyId: string
): Promise<GetApplicationByIdResult> {
  if (isEmptyScope(scope)) return { status: "error", code: "NOT_FOUND" };

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await applyBranchScope(
      supabase.from("applications").select(APPLICATION_SELECT).eq("legacy_id", legacyId),
      scope
    ).maybeSingle<ApplicationRow>();

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
 *
 * ----------------------------------------------------------------------------
 * MILESTONE 26B-5 — FORMAL APPLICATIONS ONLY
 * ----------------------------------------------------------------------------
 * Drafts are excluded HERE, in the query, not hidden later in the table
 * component. A portal journey that is still in progress is not something ODL
 * has received, so it must not reach an operational surface at all — and a
 * server-side predicate is the difference between "not shown" and "not sent",
 * which also keeps counts, exports and any future consumer of this function
 * honest without each of them re-remembering the rule.
 *
 * Filtering on STATUS rather than on `application_number is null` deliberately:
 * the lifecycle state is the fact, and the missing number is its consequence.
 * The database ties the two together (applications_draft_number_pair_check), so
 * the two predicates select the same rows — but only one of them still reads
 * correctly if a future state is added.
 */
export async function getApplications(scope: BranchScope): Promise<GetApplicationsResult> {
  if (isEmptyScope(scope)) return { status: "ok", applications: [] };

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await applyBranchScope(
      supabase
        .from("applications")
        .select(APPLICATION_LIST_SELECT)
        .in("status", [...FORMAL_APPLICATION_STATUSES]),
      scope
    )
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

/**
 * ============================================================================
 * MILESTONE 26B-23B.1 — THE FILES ONE CLIENT'S DOSSIER MAY WORK ON
 * ============================================================================
 *
 * Everything `getApplications` returns for this client, PLUS the drafts an
 * employee started here.
 *
 * A SEPARATE FUNCTION, NOT A FLAG ON THE EXISTING ONE. The register at
 * /solicitudes must keep listing only applications ODL has received — that is
 * the whole point of 26B-5's filter, and 23B.1 does not change it. The client's
 * dossier is answering a different question: what is on this person's desk. A
 * manual draft with four requirement slots and a document attached is
 * unmistakably on it, and the dossier saying "Sin solicitud asociada" over the
 * top of that document was simply false.
 *
 * A PORTAL DRAFT IS STILL EXCLUDED. It reaches this screen the way it always
 * has, through `getActiveDraftForClient`, which renders it as a process in
 * progress rather than as a file — see DossierHeader. Two different things, two
 * different reads, unchanged for the one that already worked.
 *
 * The scope predicate is the same `applyBranchScope` every other read uses, so
 * widening WHAT is returned does not widen WHO may see it.
 */
export async function getClientDossierApplications(
  scope: BranchScope,
  clientId: string
): Promise<GetApplicationsResult> {
  if (isEmptyScope(scope)) return { status: "ok", applications: [] };

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await applyBranchScope(
      supabase
        .from("applications")
        .select(APPLICATION_LIST_SELECT)
        .eq("client_id", clientId)
        // Formal, or a draft this CRM created. Expressed as an `or` on the two
        // columns that hold the two facts rather than as "not a portal draft",
        // so a source added later is excluded until somebody decides otherwise.
        .or(
          `status.in.(${FORMAL_APPLICATION_STATUSES.join(",")}),` +
            `and(status.eq.draft,created_source.eq.crm_manual)`
        ),
      scope
    ).order("created_at", { ascending: false });

    if (error) {
      console.error(
        "[applications service] Failed to load client dossier applications:",
        error.message
      );
      return { status: "error" };
    }

    const rows = (data ?? []) as unknown as ApplicationListRow[];
    return { status: "ok", applications: rows.map(toApplicationListItem) };
  } catch (error) {
    console.error(
      "[applications service] Unexpected failure loading client dossier applications:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

export interface CreateApplicationInput {
  clientId: string;
  productId: string;
  requestedAmount: number;
  /**
   * OPTIONAL since 26B-1A. Omit entirely when the term has not been agreed —
   * the portal does not ask for one. Never pass a placeholder.
   */
  requestedTermMonths?: number;
  source: ApplicationSource;
  /** Only valid (and only used) when source === "crm_manual" — see
   * applications_created_by_source_check. */
  actorProfileId: string | null;
  /**
   * DOES THIS APPLICATION GET ITS OFFICIAL NUMBER NOW, OR LATER?
   *
   * "draft"   — created without a number. It holds requirement slots and
   *             accepts documents like any other application; it simply has
   *             not been formally received yet. Numbered later, once, by
   *             `submit_application`.
   * "formal"  — received on arrival, so the insert trigger allocates the
   *             official number immediately.
   *
   * ----------------------------------------------------------------------------
   * IT IS ABOUT NUMBERING, NOT ABOUT WHO CREATED IT (26B-23A)
   * ----------------------------------------------------------------------------
   * 26B-5 described these as "staff created it" versus "the portal created it",
   * because at the time those were the only two callers and the distinction
   * happened to line up. It stopped lining up the moment staff needed to start
   * an application before they had the documents for it — and that description
   * is what led `createSolicitudApplication` to pass "formal" and spend an
   * official consecutive on a form somebody had only just opened.
   *
   * WHO created it is `source`, which already says `crm_manual`,
   * `website_form` and the rest. This says only when the number is issued.
   *
   * Required rather than defaulted: every caller has to state which kind of
   * thing it is creating, because getting this wrong is exactly the defect
   * 26B-5 exists to fix and a silent default would let it recur unnoticed.
   */
  lifecycle: "formal" | "draft";
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
  if (!(input.requestedAmount > 0)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  // A term is OPTIONAL but, when supplied, must still be in range — mirroring
  // applications_requested_term_months_check, which now reads
  // "IS NULL OR (1..360)". Absent and invalid are different things: absent is a
  // legitimate pending state, 400 months is a bad input.
  if (
    input.requestedTermMonths !== undefined &&
    !(Number.isInteger(input.requestedTermMonths) &&
      input.requestedTermMonths > 0 &&
      input.requestedTermMonths <= 360)
  ) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const supabase = getSupabaseServerClient();

  const { data: inserted, error: insertError } = await supabase
    .from("applications")
    .insert({
      client_id: input.clientId,
      product_id: input.productId,
      requested_amount: input.requestedAmount,
      requested_term_months: input.requestedTermMonths ?? null,
      created_by_profile_id: input.actorProfileId,
      created_source: input.source,
      // The status decides the numbering: set_application_number() skips
      // drafts. Passed explicitly rather than relying on the column default, so
      // the row's lifecycle is stated by the caller, not inherited.
      status: input.lifecycle === "draft" ? "draft" : "new",
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
    // MILESTONE 25B-2 — out of branch scope reports NOT_FOUND, exactly like an
    // application that does not exist. See BRANCH_DENIED_SQLSTATE.
    if (isBranchDeniedError(rpcError.code)) {
      return { status: "error", code: "NOT_FOUND" };
    }
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

export type SetApplicationApprovedAmountResult =
  | { status: "ok"; application: Application; changed: boolean }
  | {
      status: "error";
      code: "NOT_FOUND" | "INVALID_AMOUNT" | "NOT_FORMAL" | "UPDATE_FAILED";
    };

/**
 * ============================================================================
 * MILESTONE 26B-23C — RECORDING WHAT ODL DECIDED TO LEND
 * ============================================================================
 *
 * A SEPARATE OPERATION FROM APPROVING. `setApplicationStatus` moves the loan
 * through its lifecycle; this records a figure. Keeping them apart means
 * setting an amount can never silently approve a loan, and approving one can
 * never silently invent an amount — which also leaves 26B-23D free to decide
 * where in the interface the two are presented together without either
 * mechanism having to know about the other.
 *
 * IT NEVER TOUCHES requested_amount. That column has no update path anywhere in
 * this file, deliberately: it is the record of what somebody asked for.
 *
 * `null` CLEARS THE DECISION. Recording an amount by mistake must be
 * correctable, and returning to "not decided yet" is itself a decision worth an
 * audit entry — so it is written and audited like any other change rather than
 * being silently forbidden.
 *
 * The write goes through `set_application_approved_amount`, a SECURITY DEFINER
 * function, for the reason every audited write in this system does: `crm_events`
 * grants `service_role` SELECT only, so this process cannot append the audit row
 * itself. The function performs the update and the event in one transaction,
 * re-checks branch scope inside it, and refuses a draft.
 */
export async function setApplicationApprovedAmount(
  applicationId: string,
  approvedAmount: number | null,
  actorProfileId: string
): Promise<SetApplicationApprovedAmountResult> {
  // Mirrors applications_approved_amount_check and the MAX_AMOUNT ceiling the
  // portal validators already use, so a bad figure comes back as INVALID_AMOUNT
  // instead of a raw constraint violation — the posture createApplication()
  // takes for requested_amount.
  if (approvedAmount !== null) {
    if (!Number.isFinite(approvedAmount)) return { status: "error", code: "INVALID_AMOUNT" };
    if (approvedAmount <= 0) return { status: "error", code: "INVALID_AMOUNT" };
    if (approvedAmount > MAX_MONEY_AMOUNT) return { status: "error", code: "INVALID_AMOUNT" };
    // The column is numeric(12,2). A third decimal is a caller mistake, not a
    // value to round away silently on their behalf.
    if (Math.round(approvedAmount * 100) !== approvedAmount * 100) {
      return { status: "error", code: "INVALID_AMOUNT" };
    }
  }

  const supabase = getSupabaseServerClient();

  const { data: outcome, error } = await supabase.rpc("set_application_approved_amount", {
    p_application_id: applicationId,
    p_approved_amount: approvedAmount,
    p_source: "crm_manual",
    p_actor_profile_id: actorProfileId,
  });

  if (error) {
    // Out of branch scope reports NOT_FOUND, exactly like an application that
    // does not exist — see setApplicationStatus and BRANCH_DENIED_SQLSTATE.
    if (isBranchDeniedError(error.code)) return { status: "error", code: "NOT_FOUND" };
    // 22023 is the function's own refusal: a draft, a missing actor, or a
    // source it will not accept. Only the first is reachable from here.
    if (error.code === "22023") return { status: "error", code: "NOT_FORMAL" };
    console.error(
      "[applications service] Failed to record the approved amount:",
      error.message
    );
    return { status: "error", code: "UPDATE_FAILED" };
  }

  // null => the application does not exist. Same meaning the status function's
  // null return carries.
  if (outcome === null) return { status: "error", code: "NOT_FOUND" };

  const { data: updated, error: readError } = await supabase
    .from("applications")
    .select(APPLICATION_SELECT)
    .eq("id", applicationId)
    .maybeSingle<ApplicationRow>();

  if (readError || !updated) {
    console.error(
      "[applications service] Approved amount written but the application could not be re-read:",
      readError?.message ?? "no row returned"
    );
    return { status: "error", code: "UPDATE_FAILED" };
  }

  return { status: "ok", application: toApplication(updated), changed: outcome === "updated" };
}

export type ApproveApplicationWithAmountResult =
  | { status: "ok"; application: Application }
  | {
      status: "error";
      code: "NOT_FOUND" | "INVALID_AMOUNT" | "INVALID_TRANSITION" | "UPDATE_FAILED";
    };

/**
 * ============================================================================
 * MILESTONE 26B-23D — APPROVING, WITH THE FIGURE, AS ONE ACT
 * ============================================================================
 *
 * Approving a loan and saying how much are not two decisions that happen to be
 * taken together; they are one decision. Performing them as two calls would
 * leave a window in which the row says a loan was approved and does not say for
 * how much — a window no amount of care in the browser can close, because it
 * exists on the server. So both writes and both audit events happen inside
 * `approve_application_with_amount`, under one row lock, in one transaction.
 *
 * THE TRANSITION GRAPH STAYS IN TYPESCRIPT. `APPLICATION_STATUS_TRANSITIONS` is
 * checked here, and the function reproduces only the `status = expected` guard
 * — the same division `setApplicationStatus` already keeps with
 * `record_application_status_change`. The database refuses a stale write; it
 * does not hold a second opinion about which moves are legal.
 *
 * A SECOND CALL CANNOT RE-APPROVE. The expected status it carries no longer
 * matches the row, so it matches nothing and comes back INVALID_TRANSITION: a
 * double click appends no second pair of events, and — the case that matters —
 * cannot quietly overwrite the figure of an approval that already happened.
 * Amending a decided amount is a different act with its own audited path
 * (`setApplicationApprovedAmount`).
 */
export async function approveApplicationWithAmount(
  applicationId: string,
  expectedStatus: ApplicationStatus,
  approvedAmount: number,
  actorProfileId: string
): Promise<ApproveApplicationWithAmountResult> {
  // The graph decides whether this move exists at all, before anything else.
  if (!APPLICATION_STATUS_TRANSITIONS[expectedStatus].includes("approved")) {
    return { status: "error", code: "INVALID_TRANSITION" };
  }

  // Same money shape the column and the portal validators enforce. A bad figure
  // returns INVALID_AMOUNT rather than a raw constraint violation.
  if (!Number.isFinite(approvedAmount)) return { status: "error", code: "INVALID_AMOUNT" };
  if (approvedAmount <= 0) return { status: "error", code: "INVALID_AMOUNT" };
  if (approvedAmount > MAX_MONEY_AMOUNT) return { status: "error", code: "INVALID_AMOUNT" };
  if (Math.round(approvedAmount * 100) !== approvedAmount * 100) {
    return { status: "error", code: "INVALID_AMOUNT" };
  }

  const supabase = getSupabaseServerClient();

  const { data: outcome, error } = await supabase.rpc("approve_application_with_amount", {
    p_application_id: applicationId,
    p_expected_status: expectedStatus,
    p_approved_amount: approvedAmount,
    p_source: "crm_manual",
    p_actor_profile_id: actorProfileId,
  });

  if (error) {
    if (isBranchDeniedError(error.code)) return { status: "error", code: "NOT_FOUND" };
    // 22023 is the function's own refusal: a draft, a missing actor, a source it
    // will not take, or an amount it will not accept. The first three are
    // unreachable from here, so INVALID_AMOUNT is the honest mapping.
    if (error.code === "22023") return { status: "error", code: "INVALID_AMOUNT" };
    console.error("[applications service] Failed to approve the application:", error.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }

  // null covers both "no such application" and "it moved underneath us". The
  // caller has already re-read the row through its own scope, so by the time
  // this happens the second is overwhelmingly the likelier one.
  if (outcome === null) return { status: "error", code: "INVALID_TRANSITION" };

  const { data: updated, error: readError } = await supabase
    .from("applications")
    .select(APPLICATION_SELECT)
    .eq("id", applicationId)
    .maybeSingle<ApplicationRow>();

  if (readError || !updated) {
    console.error(
      "[applications service] Approved but the application could not be re-read:",
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
    // MILESTONE 25B-2 — the ACTOR is out of branch scope for this application.
    // Reported as NOT_FOUND, never as a distinct code.
    if (isBranchDeniedError(rpcError.code)) {
      return { status: "error", code: "NOT_FOUND" };
    }
    // 22023 is the function's own "advisor missing or inactive" guard — which
    // MILESTONE 25B-2 widened to include "this advisor's own branch reach does
    // not cover this application", deliberately under the SAME code so the
    // error cannot be used to probe which branch an application belongs to.
    // 23503 would be the foreign key, which the guard normally reaches first.
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

/**
 * ============================================================================
 * MILESTONE 26B-5 — ONE APPLICATION, FULLY RESOLVED, FOR ITS OWN DOSSIER
 * ============================================================================
 *
 * `getApplicationById` returns the thin row; the Solicitudes list resolves
 * product, advisor, client and branch through APPLICATION_LIST_SELECT. The
 * application dossier needs exactly what the list row already has — for one
 * application — so it reads through the SAME select and the SAME mapper rather
 * than growing a third shape that could drift from either.
 *
 * SCOPE IS ENFORCED HERE, not in the page. An application outside the caller's
 * branch scope returns NOT_FOUND — the same answer as an application that does
 * not exist — so the route cannot be used to discover which ids are real in
 * branches the user may not see. Holding the UUID is not authorization.
 *
 * A DRAFT IS RETURNED IF ASKED FOR BY ID. This function is deliberately not
 * filtered to formal applications: the dossier route decides what to do with a
 * draft (it 404s), and a read that silently lied about a row's existence would
 * make that decision impossible to write correctly.
 */
export async function getApplicationListItemById(
  scope: BranchScope,
  applicationId: string
): Promise<GetApplicationListItemByIdResult> {
  if (isEmptyScope(scope)) return { status: "error", code: "NOT_FOUND" };

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await applyBranchScope(
      supabase.from("applications").select(APPLICATION_LIST_SELECT).eq("id", applicationId),
      scope
    ).maybeSingle();

    if (error) {
      // A branch-denied read is indistinguishable from a missing row by
      // design — see this function's header.
      if (isBranchDeniedError(error.code)) return { status: "error", code: "NOT_FOUND" };
      console.error("[applications service] Failed to load application detail:", error.message);
      return { status: "error", code: "QUERY_FAILED" };
    }
    if (!data) return { status: "error", code: "NOT_FOUND" };

    return { status: "ok", application: toApplicationListItem(data as unknown as ApplicationListRow) };
  } catch (error) {
    console.error(
      "[applications service] Unexpected failure loading application detail:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error", code: "QUERY_FAILED" };
  }
}

export type GetApplicationListItemByIdResult =
  | { status: "ok"; application: ApplicationListItem }
  | { status: "error"; code: "NOT_FOUND" | "QUERY_FAILED" };

/**
 * ============================================================================
 * MILESTONE 26B-6B — AUTOMATIC LEAD DISTRIBUTION
 * ============================================================================
 *
 * Hands one newly captured lead to the next advisor in the rotation.
 *
 * ALL OF THE LOGIC IS IN THE DATABASE, deliberately. Choosing an advisor means
 * reading a shared cursor, picking from a pool and writing both — and two
 * customers can finish Step 1 in the same instant. Doing that in application
 * code would need its own locking to be correct; `auto_assign_lead_advisor`
 * already holds a row lock for the whole operation, so this is a call-through
 * rather than a second implementation of the same decision.
 *
 * NEVER FAILS THE CUSTOMER. A missing advisor pool, or an error reaching the
 * database, must not turn into a failed portal submission — the lead is the
 * valuable thing and it already exists by this point. Both cases are logged and
 * reported as "nobody assigned", which is a legitimate state the CRM shows as
 * Sin asignar and staff can resolve by hand.
 */
export async function autoAssignLeadAdvisor(
  applicationId: string
): Promise<{ status: "ok"; advisorProfileId?: string }> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase.rpc("auto_assign_lead_advisor", {
      p_application_id: applicationId,
    });

    if (error) {
      console.error(
        "[applications service] Automatic advisor distribution failed:",
        error.message
      );
      return { status: "ok" };
    }

    return { status: "ok", advisorProfileId: typeof data === "string" ? data : undefined };
  } catch (error) {
    console.error(
      "[applications service] Unexpected failure during automatic advisor distribution:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "ok" };
  }
}

/**
 * ============================================================================
 * MILESTONE 26B-23B — FORMALISING AN APPLICATION STAFF STARTED
 * ============================================================================
 *
 * The internal counterpart to `submitPortalApplication`, and deliberately a
 * much smaller one: everything that actually matters — the row lock, the single
 * allocation of the official number, the transition to `in_review`, the audit
 * event, and the idempotency that ties all four together — lives in
 * `submit_application()` and is reused unchanged. This adds the two things the
 * RPC cannot know: that the caller is allowed to act on this application, and
 * who the caller is.
 *
 * ----------------------------------------------------------------------------
 * IT DOES NOT CHECK DOCUMENTS, ON PURPOSE
 * ----------------------------------------------------------------------------
 * The portal refuses to submit until every required document is in, which is
 * right for someone filling in their own form: they are the only person who can
 * supply them, and letting them "finish" without them would be a lie.
 *
 * Staff are in the opposite position. ODL holds paper files from before the CRM
 * existed, some complete and some not, and an application that arrived months
 * ago IS a real application whatever is still missing from it. Blocking here
 * would leave those files with no way into the system at all — so the pending
 * requirements travel with the application into review, where the review panel
 * already reports "received" and "reviewed" separately and lists what is open.
 *
 * This asymmetry is intentional and is the one place portal and manual
 * legitimately differ. `evaluatePortalProgress` is untouched.
 */
export type FormalizeApplicationResult =
  | { status: "ok"; applicationNumber: string }
  | { status: "error"; code: "NOT_FOUND" | "NOT_DRAFT" | "FORMALIZE_FAILED" };

/**
 * Give a draft its official number.
 *
 * Safe to call twice: the RPC returns the number the row already owns without
 * allocating a second one or appending a second event, so a double click, a
 * retry and a refresh all converge on one application with one number.
 */
export async function formalizeApplication(
  scope: BranchScope,
  applicationId: string,
  actorProfileId: string
): Promise<FormalizeApplicationResult> {
  // Read through the caller's OWN scope, so an id naming an application in a
  // branch they cannot see resolves to NOT_FOUND rather than being formalised.
  const existing = await getApplicationById(scope, applicationId);
  if (existing.status !== "ok") return { status: "error", code: "NOT_FOUND" };

  // Already formal. Reported distinctly because the recovery differs: there is
  // nothing to do, rather than something that failed.
  if (existing.application.status !== "draft") {
    return { status: "error", code: "NOT_DRAFT" };
  }

  const supabase = getSupabaseServerClient();
  const { data: allocatedNumber, error } = await supabase.rpc("submit_application", {
    p_application_id: applicationId,
    // Server-defined. A caller cannot choose the source, which is what keeps a
    // CRM submission from being recorded as if it came from the website.
    p_source: "crm_manual",
    p_actor_profile_id: actorProfileId,
  });

  if (error || typeof allocatedNumber !== "string" || allocatedNumber.length === 0) {
    console.error(
      "[applications service] Manual formalisation failed:",
      error?.message ?? "no application number returned"
    );
    return { status: "error", code: "FORMALIZE_FAILED" };
  }

  return { status: "ok", applicationNumber: allocatedNumber };
}
