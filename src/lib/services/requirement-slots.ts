import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { REQUIREMENT_SLOT_STATUS_TRANSITIONS } from "@/lib/config/requirement-slot";
import type { LocalizedText, RequirementKind, RequirementSlot, RequirementSlotSource, RequirementSlotStatus } from "@/types";

/**
 * Server-only service for the Requirement Engine's execution layer
 * (Milestone 10B — see the Milestone 10B architecture review and its
 * critical-review follow-up). Uses the Admin Client, same posture as every
 * other service in this app: RLS is enabled on `requirement_slots` with
 * zero policies, so this is the only way to read or write it until a real
 * permissions model exists.
 *
 * Deliberately minimal: snapshot creation, read (scoped to one
 * application), and status transition. No update-details function — every
 * copied field is immutable forever once a slot exists (see the migration
 * comment). No delete.
 *
 * No Server Actions wrap this yet, and none are added in this milestone —
 * there is no client UI to bridge to (Configuration UI does not apply to
 * Slots, ever; Execution UI is deferred). Callers (dev/verification
 * scripts today, a future Milestone 11 application-creation flow and,
 * later, an Execution UI's own Server Actions) invoke this service
 * directly, exactly like every other service in this app.
 */

interface RequirementSlotRow {
  id: string;
  application_legacy_id: string;
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
  "id, application_legacy_id, requirement_template_id, code, name, description, requirement_kind, required, display_order, status, status_changed_at, status_changed_by_profile_id, status_changed_source, created_at, " +
  "status_changed_by:profiles!requirement_slots_status_changed_by_profile_id_fkey(full_name)";

function toRequirementSlot(row: RequirementSlotRow): RequirementSlot {
  return {
    id: row.id,
    applicationLegacyId: row.application_legacy_id,
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
  applicationLegacyId: string
): Promise<GetRequirementSlotsResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("requirement_slots")
      .select(REQUIREMENT_SLOT_SELECT)
      .eq("application_legacy_id", applicationLegacyId)
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
 * templates produce slots, matching exactly what a real application
 * creation flow (Milestone 11) will need.
 *
 * Written as a single multi-row INSERT rather than N sequential inserts:
 * Postgres executes one INSERT statement atomically, so either every
 * template produces its slot or none do if a constraint is violated —
 * meaningfully better than looping individual inserts, though still not a
 * true multi-statement transaction spanning the (future) application
 * creation itself. See the architecture review's Risks section for that
 * caveat, which is Milestone 11's concern, not this function's.
 *
 * Idempotent via the same on-conflict-do-nothing discipline used by every
 * dev seed in this schema: calling this twice for the same application
 * never creates duplicate or conflicting slots, matching the
 * unique(application_legacy_id, requirement_template_id) constraint.
 */
export async function createRequirementSlotsForApplication(
  applicationLegacyId: string,
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
    application_legacy_id: applicationLegacyId,
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
    .upsert(rowsToInsert, { onConflict: "application_legacy_id,requirement_template_id", ignoreDuplicates: true });

  if (insertError) {
    console.error("[requirement-slots service] Failed to insert requirement slots:", insertError.message);
    return { status: "error", code: "INSERT_FAILED" };
  }

  const result = await getRequirementSlotsByApplicationId(applicationLegacyId);
  if (result.status !== "ok") {
    return { status: "error", code: "INSERT_FAILED" };
  }
  return { status: "ok", requirementSlots: result.requirementSlots };
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

  const { data: updated, error: updateError } = await supabase
    .from("requirement_slots")
    .update({
      status: targetStatus,
      status_changed_at: new Date().toISOString(),
      status_changed_by_profile_id: actorProfileId,
      status_changed_source: source,
    })
    .eq("id", slotId)
    .eq("status", currentStatus)
    .select(REQUIREMENT_SLOT_SELECT)
    .maybeSingle<RequirementSlotRow>();

  if (updateError) {
    console.error("[requirement-slots service] Failed to update requirement slot status:", updateError.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }
  if (!updated) {
    return { status: "error", code: "INVALID_TRANSITION" };
  }

  return { status: "ok", requirementSlot: toRequirementSlot(updated) };
}
