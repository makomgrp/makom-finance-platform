import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { applyBranchScope, isBranchDeniedError, isEmptyScope, withScopedParent } from "@/lib/services/branch-scope-query";
import { REQUIREMENT_SLOT_STATUS_TRANSITIONS } from "@/lib/config/requirement-slot";
import { getApplicationById } from "@/lib/services/applications";
import { evaluateDocumentsCompleteWorkflow } from "./document-completeness-workflow.ts";
import type {
  BranchScope,
  DocumentEvidence,
  LocalizedText,
  RequirementKind,
  RequirementSlot,
  RequirementSlotSource,
  RequirementSlotStatus,
  RequirementStage,
  RequirementActor,
  RequirementConditionKey,
  RequirementSubjectType,
} from "@/types";

/**
 * Server-only service for the Requirement Engine's execution layer
 * (Milestone 10B — see the Milestone 10B architecture review and its
 * critical-review follow-up — migrated onto a real applications foreign
 * key in Milestone 11). Uses the Admin Client, same posture as every
 * other service in this app: RLS is enabled on `requirement_slots` with
 * zero policies, so this is the only way to read or write it until a real
 * permissions model exists.
 *
 * Deliberately minimal: snapshot creation, read (scoped to one
 * application), and status transition. No update-details function — every
 * copied field is immutable forever once a slot exists (see the migration
 * comment). No delete.
 *
 * No Server Actions wrap this yet, and none are added in Milestone 11
 * either — there is no client UI to bridge to (Configuration UI does not
 * apply to Slots, ever; Execution UI is deferred). Callers (dev/
 * verification scripts, src/lib/services/applications.ts#createApplication,
 * and later an Execution UI's own Server Actions) invoke this service
 * directly, exactly like every other service in this app.
 */

interface RequirementSlotRow {
  id: string;
  application_id: string;
  requirement_template_id: string;
  code: string;
  name: Record<string, string>;
  description: Record<string, string>;
  requirement_kind: string;
  required: boolean;
  display_order: number;
  status: string;
  status_changed_at: string | null;
  status_changed_by_profile_id: string | null;
  status_changed_source: string | null;
  created_at: string;
  status_changed_by: { full_name: string } | null;
  min_files: number | null;
  allows_multiple_files: boolean;
  stage: string;
  actor: string;
  condition_key: string | null;
  applicant_visible: boolean;
  original_required_later: boolean;
  subject_type: string;
  application_guarantor_id: string | null;
  application_collateral_id: string | null;
}

const REQUIREMENT_SLOT_SELECT =
  "id, application_id, requirement_template_id, code, name, description, requirement_kind, required, display_order, status, status_changed_at, status_changed_by_profile_id, status_changed_source, created_at, " +
  // MILESTONE 26A-3 — the snapshotted Step 3 configuration.
  "min_files, allows_multiple_files, stage, actor, condition_key, applicant_visible, original_required_later, subject_type, application_guarantor_id, application_collateral_id, " +
  "status_changed_by:profiles!requirement_slots_status_changed_by_profile_id_fkey(full_name)";

/** MILESTONE 25B-1 — slots derive their branch from their application via an
 * `!inner` join, so a slot whose application is out of scope disappears rather
 * than returning with a null application. */
const SLOT_APPLICATION_SCOPE_EMBED =
  "scope_application:applications!requirement_slots_application_id_fkey!inner(branch_id)";

function toRequirementSlot(row: RequirementSlotRow): RequirementSlot {
  return {
    id: row.id,
    applicationId: row.application_id,
    requirementTemplateId: row.requirement_template_id,
    code: row.code,
    name: row.name as LocalizedText,
    description: row.description as LocalizedText,
    requirementKind: row.requirement_kind as RequirementKind,
    required: row.required,
    displayOrder: row.display_order,
    status: row.status as RequirementSlotStatus,
    statusChangedAt: row.status_changed_at ?? undefined,
    statusChangedByProfileId: row.status_changed_by_profile_id ?? undefined,
    statusChangedByFullName: row.status_changed_by?.full_name ?? undefined,
    statusChangedSource: (row.status_changed_source as RequirementSlotSource | null) ?? undefined,
    createdAt: row.created_at,
    minFiles: row.min_files ?? undefined,
    allowsMultipleFiles: row.allows_multiple_files,
    stage: row.stage as RequirementStage,
    actor: row.actor as RequirementActor,
    conditionKey: (row.condition_key as RequirementConditionKey | null) ?? undefined,
    applicantVisible: row.applicant_visible,
    originalRequiredLater: row.original_required_later,
    subjectType: row.subject_type as RequirementSubjectType,
    applicationGuarantorId: row.application_guarantor_id ?? undefined,
    applicationCollateralId: row.application_collateral_id ?? undefined,
  };
}

export type GetRequirementSlotsResult =
  | { status: "ok"; requirementSlots: RequirementSlot[] }
  | { status: "error" };

/** Loads every slot for one application, in display order. No fallback to
 * demo data on failure — callers get an explicit "error" status, matching
 * every other service in this app. */
export async function getRequirementSlotsByApplicationId(
  scope: BranchScope,
  applicationId: string
): Promise<GetRequirementSlotsResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await applyBranchScope(
      supabase
        .from("requirement_slots")
        .select(withScopedParent(REQUIREMENT_SLOT_SELECT, scope, SLOT_APPLICATION_SCOPE_EMBED))
        .eq("application_id", applicationId),
      scope,
      "scope_application.branch_id"
    )
      .order("display_order", { ascending: true });

    if (error) {
      console.error("[requirement-slots service] Failed to load requirement slots:", error.message);
      return { status: "error" };
    }

    const rows = (data ?? []) as unknown as RequirementSlotRow[];
    return { status: "ok", requirementSlots: rows.map(toRequirementSlot) };
  } catch (error) {
    console.error(
      "[requirement-slots service] Unexpected failure loading requirement slots:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

/** MILESTONE 26A-3 — the snapshot source shape. Declared explicitly because a
 * runtime-composed select string leaves PostgREST inferring GenericStringError
 * instead of a row (the same trap Milestone 25B-1 hit). */
interface RequirementTemplateSnapshotRow {
  id: string;
  code: string;
  name: Record<string, string>;
  description: Record<string, string>;
  requirement_kind: string;
  required: boolean;
  display_order: number;
  min_files: number | null;
  allows_multiple_files: boolean;
  stage: string;
  actor: string;
  condition_key: string | null;
  applicant_visible: boolean;
  original_required_later: boolean;
  subject_type: string;
}

export type CreateRequirementSlotsResult =
  | { status: "ok"; requirementSlots: RequirementSlot[] }
  | { status: "error"; code: "NO_ACTIVE_TEMPLATES" | "INSERT_FAILED" };

/**
 * The core snapshot mechanism this milestone exists to build. Reads every
 * currently ACTIVE requirement template for the given product and inserts
 * exactly one slot per template, copying code/name/description/
 * requirement_kind/required/display_order verbatim — see the Milestone
 * 10B architecture review's "Snapshot Strategy" section for why this must
 * happen as one immediate, full batch rather than lazily or on first
 * upload.
 *
 * Inactive and draft templates are silently excluded — only active
 * templates produce slots, matching exactly what the real application
 * creation flow (src/lib/services/applications.ts#createApplication,
 * Milestone 11) needs.
 *
 * Written as a single multi-row INSERT rather than N sequential inserts:
 * Postgres executes one INSERT statement atomically, so either every
 * template produces its slot or none do if a constraint is violated —
 * meaningfully better than looping individual inserts, though still not a
 * true multi-statement transaction spanning the application creation
 * itself. See src/lib/services/applications.ts#createApplication's doc
 * comment for how that specific partial-failure window (application
 * created, slot snapshot failed) is handled — a caller-visible "partial"
 * result plus safe retry, not silently ignored.
 *
 * Idempotent: calling this twice for the same application never creates
 * duplicate slots. MILESTONE 26A-3 changed HOW — it now reads which templates
 * already have an application-level slot and inserts only the rest, because the
 * non-partial unique index the old upsert targeted was replaced by three
 * partial ones so a requirement can bind to a specific guarantor or collateral
 * item. requirement_slots_unbound_template_key still backs the guarantee, so a
 * concurrent double-call fails loudly into the documented safe-retry path
 * rather than duplicating.
 *
 * MILESTONE 26A-3 also narrowed WHAT is snapshotted: only unconditional,
 * application-level templates. Conditional and subject-bound requirements
 * materialize later, when their condition is answered and their guarantor or
 * collateral row exists — see the query below.
 */
export async function createRequirementSlotsForApplication(
  applicationId: string,
  productId: string
): Promise<CreateRequirementSlotsResult> {
  const supabase = getSupabaseServerClient();

  const { data: templates, error: templatesError } = await supabase
    .from("requirement_templates")
    .select(
      "id, code, name, description, requirement_kind, required, display_order, " +
        // MILESTONE 26A-3 — the new configuration must be SNAPSHOT too, or an
        // application would freeze its requirement list while silently
        // inheriting today's min_files and visibility rules forever after.
        "min_files, allows_multiple_files, stage, actor, condition_key, " +
        "applicant_visible, original_required_later, subject_type"
    )
    .eq("product_id", productId)
    .eq("status", "active")
    // MILESTONE 26A-3 — ONLY UNCONDITIONAL, APPLICATION-LEVEL REQUIREMENTS
    // MATERIALIZE AT CREATION.
    //
    // A conditional requirement (guarantor documents, TCC, proformas, collateral
    // papers) has no answer yet at the moment an application is created: nobody
    // has said whether there is a guarantor. Snapshotting it anyway would put a
    // permanently-incomplete row into every progress calculation and show the
    // applicant a document they may never owe.
    //
    // Subject-bound requirements additionally CANNOT exist yet: their slot
    // needs a real application_guarantor_id or application_collateral_id, and
    // those rows are created later in Step 2.
    //
    // Auditability is unaffected — the template catalogue is the permanent
    // record of what a product can require; slots record what THIS application
    // was actually asked for.
    .is("condition_key", null)
    .eq("subject_type", "application");

  if (templatesError) {
    console.error(
      "[requirement-slots service] Failed to load active requirement templates for snapshot:",
      templatesError.message
    );
    return { status: "error", code: "INSERT_FAILED" };
  }

  const templateRows = (templates ?? []) as unknown as RequirementTemplateSnapshotRow[];

  if (templateRows.length === 0) {
    return { status: "error", code: "NO_ACTIVE_TEMPLATES" };
  }

  // MILESTONE 26A-3 — IDEMPOTENCY WITHOUT onConflict.
  //
  // This used upsert(onConflict: "application_id,requirement_template_id"),
  // which PostgREST can only target through a NON-partial unique index. 26A-3
  // replaced that index with three partial ones so a requirement can bind to a
  // specific guarantor or collateral item (an application with two guarantors
  // needs two slots from one template).
  //
  // The retry-safety this function's doc comment promises is preserved by
  // reading which templates already have an application-level slot and
  // inserting only the rest. A concurrent double-call still cannot duplicate:
  // requirement_slots_unbound_template_key rejects the loser, which surfaces as
  // INSERT_FAILED and the documented "safe to retry" path.
  const { data: existing, error: existingError } = await supabase
    .from("requirement_slots")
    .select("requirement_template_id")
    .eq("application_id", applicationId)
    .is("application_guarantor_id", null)
    .is("application_collateral_id", null);

  if (existingError) {
    console.error(
      "[requirement-slots service] Failed to read existing requirement slots:",
      existingError.message
    );
    return { status: "error", code: "INSERT_FAILED" };
  }

  const alreadySnapshotted = new Set(
    ((existing ?? []) as { requirement_template_id: string }[]).map(
      (row) => row.requirement_template_id
    )
  );

  const rowsToInsert = templateRows
    .filter((template) => !alreadySnapshotted.has(template.id))
    .map((template) => ({
      application_id: applicationId,
      requirement_template_id: template.id,
      code: template.code,
      name: template.name,
      description: template.description,
      requirement_kind: template.requirement_kind,
      required: template.required,
      display_order: template.display_order,
      min_files: template.min_files,
      allows_multiple_files: template.allows_multiple_files,
      stage: template.stage,
      actor: template.actor,
      condition_key: template.condition_key,
      applicant_visible: template.applicant_visible,
      original_required_later: template.original_required_later,
      subject_type: template.subject_type,
    }));

  if (rowsToInsert.length > 0) {
    const { error: insertError } = await supabase.from("requirement_slots").insert(rowsToInsert);

    if (insertError) {
      console.error("[requirement-slots service] Failed to insert requirement slots:", insertError.message);
      return { status: "error", code: "INSERT_FAILED" };
    }
  }

  // MILESTONE 25B-1 — this is a READ-BACK OF THIS FUNCTION'S OWN INSERT, not a
  // user-facing query, so it deliberately does NOT go through the scoped
  // reader. Passing a scope here would be theatre: the rows were created by the
  // line above, for an application this function was handed, and the caller has
  // already been authorized to create it.
  //
  // The branch boundary for CREATING an application belongs at the mutation
  // layer and is Milestone 25B-2's job. Routing this through a scoped read
  // would also break legitimately: an application created for a branch the
  // actor cannot read would return zero slots and report INSERT_FAILED after a
  // successful insert.
  const { data: created, error: readBackError } = await supabase
    .from("requirement_slots")
    .select(REQUIREMENT_SLOT_SELECT)
    .eq("application_id", applicationId)
    .order("display_order", { ascending: true });

  if (readBackError) {
    console.error(
      "[requirement-slots service] Failed to read back inserted requirement slots:",
      readBackError.message
    );
    return { status: "error", code: "INSERT_FAILED" };
  }

  const createdRows = (created ?? []) as unknown as RequirementSlotRow[];
  return { status: "ok", requirementSlots: createdRows.map(toRequirementSlot) };
}

export type SetRequirementSlotStatusResult =
  | { status: "ok"; requirementSlot: RequirementSlot }
  | { status: "error"; code: "NOT_FOUND" | "INVALID_ACTOR" | "INVALID_TRANSITION" | "UPDATE_FAILED" };

/**
 * Transitions a slot's execution status, enforcing
 * REQUIREMENT_SLOT_STATUS_TRANSITIONS server-side. Unlike Product/
 * Requirement Template status changes, the actor is not always an
 * authenticated CRM profile — source identifies which channel/actor-type
 * made the change (crm_manual/website_form/whatsapp/ai), and
 * actorProfileId is only ever populated (and only ever valid) when source
 * is "crm_manual" — mirrors requirement_slots_status_changed_by_source_
 * check at the database level, re-validated here first so a misuse
 * returns a clear INVALID_ACTOR result instead of a raw constraint
 * violation.
 *
 * Same race-safety idiom as src/lib/services/products.ts#setProductStatus
 * and src/lib/services/requirement-templates.ts#setRequirementTemplateStatus:
 * reads the current status, validates the transition, then writes
 * status/status_changed_at/status_changed_by_profile_id/status_changed_
 * source together in one guarded UPDATE (`.eq("status", currentStatus)`)
 * — a concurrent change in between makes the guard match zero rows,
 * returning INVALID_TRANSITION rather than silently overwriting a change
 * this call never validated.
 */
export async function setRequirementSlotStatus(
  slotId: string,
  targetStatus: RequirementSlotStatus,
  source: RequirementSlotSource,
  actorProfileId: string | null
): Promise<SetRequirementSlotStatusResult> {
  if (actorProfileId !== null && source !== "crm_manual") {
    return { status: "error", code: "INVALID_ACTOR" };
  }

  const supabase = getSupabaseServerClient();

  const { data: current, error: fetchError } = await supabase
    .from("requirement_slots")
    .select("status")
    .eq("id", slotId)
    .maybeSingle();

  if (fetchError) {
    console.error(
      "[requirement-slots service] Failed to look up requirement slot before status change:",
      fetchError.message
    );
    return { status: "error", code: "UPDATE_FAILED" };
  }
  if (!current) {
    return { status: "error", code: "NOT_FOUND" };
  }

  const currentStatus = current.status as RequirementSlotStatus;
  if (!REQUIREMENT_SLOT_STATUS_TRANSITIONS[currentStatus].includes(targetStatus)) {
    return { status: "error", code: "INVALID_TRANSITION" };
  }

  // MILESTONE 20: atomic mutation + audit append. The transition graph above
  // stays canonical in src/lib/config/requirement-slot.ts; the function only
  // reproduces the `status = currentStatus` guard, preserving this path's
  // existing race semantics exactly.
  const { data: changedId, error: rpcError } = await supabase.rpc(
    "record_requirement_slot_status_change",
    {
      p_slot_id: slotId,
      p_expected_status: currentStatus,
      p_new_status: targetStatus,
      p_source: source,
      p_actor_profile_id: actorProfileId,
    }
  );

  if (rpcError) {
    // MILESTONE 25B-2 — out of branch scope (resolved from the slot's parent
    // application inside the RPC) reports NOT_FOUND, exactly like a slot that
    // does not exist. See BRANCH_DENIED_SQLSTATE.
    if (isBranchDeniedError(rpcError.code)) {
      return { status: "error", code: "NOT_FOUND" };
    }
    console.error("[requirement-slots service] Failed to update requirement slot status:", rpcError.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }
  if (!changedId) {
    return { status: "error", code: "INVALID_TRANSITION" };
  }

  // Re-read so this service keeps REQUIREMENT_SLOT_SELECT — including its
  // status_changed_by profile embed — as the single definition of the shape
  // it returns.
  const { data: updated, error: readError } = await supabase
    .from("requirement_slots")
    .select(REQUIREMENT_SLOT_SELECT)
    .eq("id", slotId)
    .maybeSingle<RequirementSlotRow>();

  if (readError || !updated) {
    console.error(
      "[requirement-slots service] Status changed but the slot could not be re-read:",
      readError?.message ?? "no row returned"
    );
    return { status: "error", code: "UPDATE_FAILED" };
  }

  // MILESTONE 2.4 — satisfied/waived are the only two states this codebase's
  // own transition graph treats as terminal for a slot, which makes them the
  // only moments the applicant's document package can newly become complete
  // (see document-completeness.ts). Awaited rather than fired through
  // `after()`: unlike the portal's confirmation email, this touches no
  // external network — two small internal queries — so the added latency is
  // negligible and awaiting keeps the effect visible before this call
  // returns. Never allowed to turn a successful status change into a
  // reported failure: the workflow function swallows its own errors, and
  // this catch is a second, defensive guarantee of that same contract.
  if (targetStatus === "satisfied" || targetStatus === "waived") {
    await evaluateDocumentsCompleteWorkflow(updated.application_id).catch((error) => {
      console.error(
        "[requirement-slots service] documents-complete workflow failed:",
        error instanceof Error ? error.message : "unknown error"
      );
    });
  }

  return { status: "ok", requirementSlot: toRequirementSlot(updated) };
}

export type GetDocumentSlotsAwaitingReviewCountResult =
  | { status: "ok"; count: number }
  | { status: "error" };

/**
 * Server-side count only (no row payload) — backs the Dashboard's
 * document-requirements KPI (Milestone 12E1b — see the Milestone 12E
 * architecture review, Question 2). Counts document-kind Requirement
 * Slots in 'submitted' or 'under_review': Evidence has arrived and no
 * staff judgment has been made yet — the actual staff-facing work queue,
 * not client-side-pending work (pending/missing) nobody at the CRM needs
 * to act on, and not already-concluded outcomes (satisfied/rejected/
 * waived). Deliberately does not reuse getDocumentEvidenceWorkspace() —
 * that read exists to populate a table of rows for /documentos; a KPI
 * card needs one integer, not every Slot's full Application/Evidence
 * embed. Never returns a fabricated 0 on failure — callers must treat
 * "error" as unknown, not zero, same contract as every other count-only
 * read in this app (see src/lib/services/documents.ts#
 * getPendingDocumentCount, the legacy function this replaces).
 */
export async function getDocumentSlotsAwaitingReviewCount(
  scope: BranchScope
): Promise<GetDocumentSlotsAwaitingReviewCountResult> {
  // A COUNT LEAKS. An unscoped dashboard figure would tell a branch user how
  // much work exists elsewhere in ODL without showing a single row.
  if (isEmptyScope(scope)) return { status: "ok", count: 0 };

  try {
    const supabase = getSupabaseServerClient();
    const { count, error } = await applyBranchScope(
      supabase
        .from("requirement_slots")
        .select(withScopedParent("id", scope, SLOT_APPLICATION_SCOPE_EMBED), {
          count: "exact",
          head: true,
        })
        .eq("requirement_kind", "document")
        .in("status", ["submitted", "under_review"]),
      scope,
      "scope_application.branch_id"
    );

    if (error) {
      console.error(
        "[requirement-slots service] Failed to count document slots awaiting review:",
        error.message
      );
      return { status: "error" };
    }

    return { status: "ok", count: count ?? 0 };
  } catch (error) {
    console.error(
      "[requirement-slots service] Unexpected failure counting document slots awaiting review:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

export type DocumentSlotCompletionCounts = Record<string, { completed: number; total: number }>;

export type GetDocumentSlotCompletionCountsResult =
  | { status: "ok"; counts: DocumentSlotCompletionCounts }
  | { status: "error" };

/**
 * Per-application document-kind Requirement Slot completion counts —
 * completed = satisfied or waived, total = every document-kind slot —
 * backing the Solicitudes list/kanban's documentation-progress indicator
 * (Milestone 13C; see the Milestone 13A architecture review's
 * "Documentation Progress" question). Deliberately never reads or derives
 * from the legacy documentationProgress demo field, which this replaces.
 *
 * One query for every application at once, grouped in memory — not one
 * query per application — the same "avoid N+1" posture as
 * getDocumentEvidenceWorkspace(), at a fraction of its cost: only
 * application_id and status are selected, no Evidence, no Application/
 * Advisor embed. Not built as its own workspace read: this is two columns
 * and an in-memory tally, far short of justifying a parallel read model
 * (see the Milestone 13A architecture validation's "Application
 * Workspace" question for why that bar is deliberately high in this app).
 *
 * Applications with zero document-kind slots (e.g. the slot snapshot
 * failed, or the product has no document requirements) are simply absent
 * from the returned map — callers must treat a missing key as "0 of 0",
 * not as an error.
 */
export async function getDocumentSlotCompletionCounts(
  scope: BranchScope
): Promise<GetDocumentSlotCompletionCountsResult> {
  if (isEmptyScope(scope)) return { status: "ok", counts: {} };

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await applyBranchScope(
      supabase
        .from("requirement_slots")
        .select(withScopedParent("application_id, status", scope, SLOT_APPLICATION_SCOPE_EMBED))
        .eq("requirement_kind", "document"),
      scope,
      "scope_application.branch_id"
    );

    if (error) {
      console.error(
        "[requirement-slots service] Failed to load document slot completion counts:",
        error.message
      );
      return { status: "error" };
    }

    const counts: DocumentSlotCompletionCounts = {};
    const rows = (data ?? []) as unknown as { application_id: string; status: string }[];
    for (const row of rows) {
      const bucket = (counts[row.application_id] ??= { completed: 0, total: 0 });
      bucket.total += 1;
      if (row.status === "satisfied" || row.status === "waived") {
        bucket.completed += 1;
      }
    }

    return { status: "ok", counts };
  } catch (error) {
    console.error(
      "[requirement-slots service] Unexpected failure loading document slot completion counts:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

/**
 * ============================================================================
 * MILESTONE 26A-3 — FILE-COUNT COMPLETION
 * ============================================================================
 *
 * ADDITIVE. getDocumentSlotCompletionCounts() above is unchanged and remains
 * STATUS-based (satisfied/waived) — that is the CRM's review verdict, and a
 * reviewer rejecting a blurry pay slip must be able to reopen a slot no matter
 * how many files sit under it.
 *
 * This answers a different question, the one the applicant's progress bar
 * needs: HAS THE APPLICANT UPLOADED ENOUGH FILES YET? The two deliberately do
 * not replace each other. A slot can be file-complete and still awaiting
 * review; that is a normal, meaningful state and collapsing it would hide it.
 *
 * `minFiles === null` means file count is not how this completes (an internal
 * approval, a phone verification) — such a slot is never file-complete and is
 * excluded from file-based progress rather than counted as done at zero.
 */
export interface RequirementFileCompletion {
  slotId: string;
  minFiles: number | null;
  fileCount: number;
  /** True once at least `minFiles` files exist. Stays true above that. */
  isFileComplete: boolean;
}

export function evaluateFileCompletion(
  slot: { id: string; minFiles: number | null },
  fileCount: number
): RequirementFileCompletion {
  const minFiles = slot.minFiles;
  return {
    slotId: slot.id,
    minFiles,
    fileCount,
    // 0 of 2 -> false. 1 of 2 -> false. 2 of 2 -> true. 3 of 2 -> still true:
    // extra pay slips are welcome and must never un-complete a requirement.
    isFileComplete: minFiles === null ? false : fileCount >= minFiles,
  };
}

/**
 * ============================================================================
 * MILESTONE 26B-5 — RECEIVED IS NOT REVIEWED
 * ============================================================================
 *
 * Manual QA found Solicitudes reporting "Documentación 0%" for an application
 * whose seven requirements had all been uploaded and all read "Enviado". Both
 * numbers were correct; they were answering different questions, and only one
 * of them was on screen.
 *
 *   RECEIVED — has the applicant sent enough files? File-count based, using
 *              26A-3's own `evaluateFileCompletion` so `min_files` semantics
 *              are honoured rather than re-implemented.
 *   REVIEWED — has a member of staff concluded the requirement is good?
 *              Status based (satisfied / waived), the CRM's review verdict.
 *
 * Keeping them apart is the point. "7 received, 0 reviewed" is the true and
 * useful state of a freshly submitted application; collapsing it to 0% reads as
 * "the customer sent nothing", and collapsing it to 100% would claim staff had
 * verified documents nobody had opened.
 *
 * SUPERSEDED FILES DO NOT COUNT. A replaced upload is the file the applicant
 * withdrew; counting it would let one document satisfy a two-document
 * requirement.
 *
 * TWO QUERIES, NEVER PER ROW. One for the slots in scope, one for their
 * evidence, then aggregation in memory — so a Solicitudes page showing fifty
 * applications costs exactly the same two round trips as one showing three.
 */
export interface ApplicationDocumentProgress {
  /** Requirements with enough live files uploaded. */
  received: number;
  /** Requirements a reviewer has concluded (satisfied or waived). */
  reviewed: number;
  /** Every document-kind requirement on the application. */
  total: number;
}

export type ApplicationDocumentProgressMap = Record<string, ApplicationDocumentProgress>;

export type GetApplicationDocumentProgressResult =
  | { status: "ok"; progress: ApplicationDocumentProgressMap }
  | { status: "error" };

export async function getApplicationDocumentProgress(
  scope: BranchScope
): Promise<GetApplicationDocumentProgressResult> {
  if (isEmptyScope(scope)) return { status: "ok", progress: {} };

  try {
    const supabase = getSupabaseServerClient();

    const { data: slotData, error: slotError } = await applyBranchScope(
      supabase
        .from("requirement_slots")
        .select(
          withScopedParent(
            "id, application_id, status, min_files",
            scope,
            SLOT_APPLICATION_SCOPE_EMBED
          )
        )
        .eq("requirement_kind", "document"),
      scope,
      "scope_application.branch_id"
    );

    if (slotError) {
      console.error(
        "[requirement-slots service] Failed to load slots for document progress:",
        slotError.message
      );
      return { status: "error" };
    }

    const slots = (slotData ?? []) as unknown as {
      id: string;
      application_id: string;
      status: string;
      min_files: number | null;
    }[];

    if (slots.length === 0) return { status: "ok", progress: {} };

    // Evidence is fetched by slot id — already scope-filtered above, so this
    // inherits the branch predicate rather than re-expressing it.
    const { data: evidenceData, error: evidenceError } = await supabase
      .from("dossier_documents")
      .select("id, requirement_slot_id, replaces_evidence_id")
      .in(
        "requirement_slot_id",
        slots.map((slot) => slot.id)
      );

    if (evidenceError) {
      console.error(
        "[requirement-slots service] Failed to load evidence for document progress:",
        evidenceError.message
      );
      return { status: "error" };
    }

    const evidence = (evidenceData ?? []) as unknown as {
      id: string;
      requirement_slot_id: string;
      replaces_evidence_id: string | null;
    }[];

    const superseded = new Set(
      evidence.map((row) => row.replaces_evidence_id).filter((id): id is string => Boolean(id))
    );

    const liveFilesBySlot = new Map<string, number>();
    for (const row of evidence) {
      if (superseded.has(row.id)) continue;
      liveFilesBySlot.set(
        row.requirement_slot_id,
        (liveFilesBySlot.get(row.requirement_slot_id) ?? 0) + 1
      );
    }

    const progress: ApplicationDocumentProgressMap = {};
    for (const slot of slots) {
      const bucket = (progress[slot.application_id] ??= { received: 0, reviewed: 0, total: 0 });
      bucket.total += 1;

      if (
        evaluateFileCompletion(
          { id: slot.id, minFiles: slot.min_files ?? null },
          liveFilesBySlot.get(slot.id) ?? 0
        ).isFileComplete
      ) {
        bucket.received += 1;
      }

      if (slot.status === "satisfied" || slot.status === "waived") {
        bucket.reviewed += 1;
      }
    }

    return { status: "ok", progress };
  } catch (error) {
    console.error(
      "[requirement-slots service] Unexpected failure loading document progress:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

/**
 * ============================================================================
 * MILESTONE 26B-10 — ONE APPLICATION'S DOCUMENT PICTURE
 * ============================================================================
 *
 * The same three counts as `getApplicationDocumentProgress`, for a single
 * application, derived from slots and evidence the caller already holds.
 *
 * WHY NOT JUST CALL THE MAP VERSION? Because it answers a different-shaped
 * question. That one exists so Solicitudes can price FIFTY applications in two
 * round trips — it queries every slot in the viewer's whole branch scope and
 * buckets by application. Calling it to render one dossier would load a
 * branch's worth of rows to report on one file.
 *
 * These are not two implementations of one rule. The rule itself —
 * `evaluateFileCompletion`, `min_files`, superseded files not counting,
 * satisfied|waived being what "reviewed" means — is `evaluateFileCompletion`
 * and the two status checks below, and both paths run exactly those. What
 * differs is only where the rows come from.
 *
 * REJECTED IS REPORTED, NOT INVENTED. A `rejected` requirement slot is the
 * existing document-review verdict from Milestone 12E; the review workspace
 * surfaces it rather than modelling a second notion of a bad document.
 */
export interface ApplicationDocumentSummary extends ApplicationDocumentProgress {
  /** Requirements a reviewer explicitly turned back. */
  rejected: number;
}

export function summariseDocumentProgress(
  slots: readonly Pick<RequirementSlot, "id" | "status" | "minFiles" | "requirementKind">[],
  evidence: readonly Pick<DocumentEvidence, "id" | "requirementSlotId" | "replacesEvidenceId">[]
): ApplicationDocumentSummary {
  const superseded = new Set(
    evidence.map((row) => row.replacesEvidenceId).filter((id): id is string => Boolean(id))
  );

  const liveFilesBySlot = new Map<string, number>();
  for (const row of evidence) {
    if (superseded.has(row.id)) continue;
    liveFilesBySlot.set(row.requirementSlotId, (liveFilesBySlot.get(row.requirementSlotId) ?? 0) + 1);
  }

  const summary: ApplicationDocumentSummary = { received: 0, reviewed: 0, total: 0, rejected: 0 };
  for (const slot of slots) {
    // Document requirements only — an internal approval or a phone check is a
    // requirement, but it is not a document and must not dilute this count.
    if (slot.requirementKind !== "document") continue;
    summary.total += 1;

    if (
      evaluateFileCompletion(
        { id: slot.id, minFiles: slot.minFiles ?? null },
        liveFilesBySlot.get(slot.id) ?? 0
      ).isFileComplete
    ) {
      summary.received += 1;
    }

    if (slot.status === "satisfied" || slot.status === "waived") summary.reviewed += 1;
    if (slot.status === "rejected") summary.rejected += 1;
  }
  return summary;
}

export type AddManualDocumentSlotResult =
  | { status: "ok"; slotId: string }
  | { status: "error"; code: "NOT_FOUND" | "INVALID_INPUT" | "NO_TEMPLATE" | "INSERT_FAILED" };

/**
 * ============================================================================
 * MILESTONE 26B-25 — UN DOCUMENTO QUE LLEGÓ POR OTRO CANAL
 * ============================================================================
 *
 * ODL recibe cosas por WhatsApp, por correo y en mano. Hasta ahora el
 * expediente solo aceptaba un archivo contra un requisito previsto de antemano,
 * y lo que no estaba previsto se quedaba fuera del expediente — es decir, fuera
 * del sitio donde alguien lo buscaría después.
 *
 * Esto crea el hueco donde colgarlo, y nada más: la subida en sí sigue pasando
 * por la evidencia de siempre, con su almacenamiento, su historial y su
 * reemplazo. No hay un segundo mecanismo documental.
 *
 * NO ES UN REQUISITO QUE SE PIDA. Nace `applicant_visible = false` y
 * `required = false`: no se muestra en el portal y no cuenta para completar
 * ningún paso. Es el registro de algo que YA llegó, no una petición.
 *
 * EL NOMBRE LO PONE QUIEN LO INCORPORA. Cada slot fotografía su propio nombre
 * y descripción (26A-3), así que una sola plantilla `other_document` respalda
 * tantos documentos distintos como haga falta. Pedir una plantilla por tipo
 * sería pedir que ODL prevea lo imprevisto.
 */
export async function addManualDocumentSlot(
  scope: BranchScope,
  applicationId: string,
  input: { name: string; description?: string }
): Promise<AddManualDocumentSlotResult> {
  const name = input.name.trim();
  if (name.length === 0 || name.length > 120) return { status: "error", code: "INVALID_INPUT" };
  const description = (input.description ?? "").trim().slice(0, 300);

  // La solicitud se re-resuelve por el scope del llamador: conocer un id nunca
  // es autorización, y una solicitud de otra sucursal no existe para quien
  // pregunta. Misma postura que el resto de este servicio.
  const application = await getApplicationById(scope, applicationId);
  if (application.status !== "ok") return { status: "error", code: "NOT_FOUND" };

  const supabase = getSupabaseServerClient();

  const { data: template, error: templateError } = await supabase
    .from("requirement_templates")
    .select("id")
    .eq("product_id", application.application.productId)
    .eq("code", "other_document")
    .maybeSingle<{ id: string }>();

  if (templateError) {
    console.error("[requirement-slots] Failed to load other_document template:", templateError.message);
    return { status: "error", code: "INSERT_FAILED" };
  }
  if (!template) return { status: "error", code: "NO_TEMPLATE" };

  // Al final de la lista y sin colisionar con los requisitos del producto, que
  // usan órdenes bajos. Varios documentos manuales se ordenan entre sí por su
  // propia creación, que es el orden en que llegaron.
  const { data: last } = await supabase
    .from("requirement_slots")
    .select("display_order")
    .eq("application_id", applicationId)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle<{ display_order: number }>();

  const { data: inserted, error } = await supabase
    .from("requirement_slots")
    .insert({
      application_id: applicationId,
      requirement_template_id: template.id,
      code: "other_document",
      name: { es: name, en: name },
      description: { es: description, en: description },
      requirement_kind: "document",
      required: false,
      applicant_visible: false,
      min_files: 1,
      allows_multiple_files: true,
      stage: "application",
      actor: "internal",
      subject_type: "application",
      display_order: Math.max(last?.display_order ?? 0, 900) + 1,
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error || !inserted) {
    console.error("[requirement-slots] Failed to add manual document slot:", error?.message);
    return { status: "error", code: "INSERT_FAILED" };
  }

  return { status: "ok", slotId: inserted.id };
}
