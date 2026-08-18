import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { applyBranchScope, isEmptyScope, withScopedParent } from "@/lib/services/branch-scope-query";
import { REQUIREMENT_SLOT_STATUS_TRANSITIONS } from "@/lib/config/requirement-slot";
import type {
  BranchScope,
  LocalizedText,
  RequirementKind,
  RequirementSlot,
  RequirementSlotSource,
  RequirementSlotStatus,
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
}

const REQUIREMENT_SLOT_SELECT =
  "id, application_id, requirement_template_id, code, name, description, requirement_kind, required, display_order, status, status_changed_at, status_changed_by_profile_id, status_changed_source, created_at, " +
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
 * Idempotent via the same on-conflict-do-nothing discipline used by every
 * dev seed in this schema: calling this twice for the same application
 * never creates duplicate or conflicting slots, matching the
 * unique(application_id, requirement_template_id) constraint — this is
 * exactly what makes the retry-on-partial-failure mitigation above safe.
 */
export async function createRequirementSlotsForApplication(
  applicationId: string,
  productId: string
): Promise<CreateRequirementSlotsResult> {
  const supabase = getSupabaseServerClient();

  const { data: templates, error: templatesError } = await supabase
    .from("requirement_templates")
    .select("id, code, name, description, requirement_kind, required, display_order")
    .eq("product_id", productId)
    .eq("status", "active");

  if (templatesError) {
    console.error(
      "[requirement-slots service] Failed to load active requirement templates for snapshot:",
      templatesError.message
    );
    return { status: "error", code: "INSERT_FAILED" };
  }

  if (!templates || templates.length === 0) {
    return { status: "error", code: "NO_ACTIVE_TEMPLATES" };
  }

  const rowsToInsert = templates.map((template) => ({
    application_id: applicationId,
    requirement_template_id: template.id,
    code: template.code,
    name: template.name,
    description: template.description,
    requirement_kind: template.requirement_kind,
    required: template.required,
    display_order: template.display_order,
  }));

  const { error: insertError } = await supabase
    .from("requirement_slots")
    .upsert(rowsToInsert, { onConflict: "application_id,requirement_template_id", ignoreDuplicates: true });

  if (insertError) {
    console.error("[requirement-slots service] Failed to insert requirement slots:", insertError.message);
    return { status: "error", code: "INSERT_FAILED" };
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
