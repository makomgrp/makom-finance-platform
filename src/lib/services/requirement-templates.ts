import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { REQUIREMENT_STATUS_TRANSITIONS } from "@/lib/config/requirement";
import type { LocalizedText, RequirementKind, RequirementStatus, RequirementTemplate } from "@/types";

/**
 * Server-only service for the Requirement Engine's foundation table
 * (Milestone 10A — see the Milestone 10 architecture review). Uses the
 * Admin Client, same posture as every other service in this app: RLS is
 * enabled on `requirement_templates` with zero policies, so this is the
 * only way to read or write it until a real permissions model exists.
 *
 * Deliberately minimal: create, read (scoped to one product), update-
 * details, status transition, reorder (scoped to one product's own list).
 * No delete — see the migration's comment on why requirement templates are
 * never hard-deleted, only moved to inactive. No Slot logic — that is
 * Milestone 10B, not this file.
 */

interface RequirementTemplateRow {
  id: string;
  product_id: string;
  code: string;
  name: Record<string, string>;
  description: Record<string, string> | null;
  requirement_kind: string;
  required: boolean;
  display_order: number;
  status: string;
  status_changed_at: string | null;
  status_changed_by_profile_id: string | null;
  created_at: string;
  status_changed_by: { full_name: string } | null;
}

const REQUIREMENT_TEMPLATE_SELECT =
  "id, product_id, code, name, description, requirement_kind, required, display_order, status, status_changed_at, status_changed_by_profile_id, created_at, " +
  "status_changed_by:profiles!requirement_templates_status_changed_by_profile_id_fkey(full_name)";

function toRequirementTemplate(row: RequirementTemplateRow): RequirementTemplate {
  return {
    id: row.id,
    productId: row.product_id,
    code: row.code,
    name: row.name as LocalizedText,
    description: (row.description as LocalizedText | null) ?? undefined,
    requirementKind: row.requirement_kind as RequirementKind,
    required: row.required,
    displayOrder: row.display_order,
    status: row.status as RequirementStatus,
    statusChangedAt: row.status_changed_at ?? undefined,
    statusChangedByProfileId: row.status_changed_by_profile_id ?? undefined,
    statusChangedByFullName: row.status_changed_by?.full_name ?? undefined,
    createdAt: row.created_at,
  };
}

export type GetRequirementTemplatesResult =
  | { status: "ok"; requirementTemplates: RequirementTemplate[] }
  | { status: "error" };

/** Loads every requirement template for one product, in display order. No
 * fallback to demo data on failure — callers get an explicit "error"
 * status, matching every other service in this app. */
export async function getRequirementTemplatesByProductId(
  productId: string
): Promise<GetRequirementTemplatesResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("requirement_templates")
      .select(REQUIREMENT_TEMPLATE_SELECT)
      .eq("product_id", productId)
      .order("display_order", { ascending: true });

    if (error) {
      console.error("[requirement-templates service] Failed to load requirement templates:", error.message);
      return { status: "error" };
    }

    const rows = (data ?? []) as unknown as RequirementTemplateRow[];
    return { status: "ok", requirementTemplates: rows.map(toRequirementTemplate) };
  } catch (error) {
    console.error(
      "[requirement-templates service] Unexpected failure loading requirement templates:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

export interface CreateRequirementTemplateInput {
  productId: string;
  code: string;
  name: LocalizedText;
  description: LocalizedText;
  requirementKind: RequirementKind;
  required: boolean;
}

export type CreateRequirementTemplateResult =
  | { status: "ok"; requirementTemplate: RequirementTemplate }
  | { status: "error"; code: "DUPLICATE_CODE" | "INSERT_FAILED" };

/** New requirement templates are always created in draft (the column
 * default) with no status_changed_at/by (satisfies
 * requirement_templates_status_changed_pair_check by construction — no
 * transition has happened yet), and placed after every existing
 * requirement template FOR THAT PRODUCT (current max display_order + 10
 * within product_id, or 10 if this is the product's first requirement) —
 * sparse-gap convention scoped per product, see the migration comment. */
export async function createRequirementTemplate(
  input: CreateRequirementTemplateInput
): Promise<CreateRequirementTemplateResult> {
  const supabase = getSupabaseServerClient();

  const { data: lastRow } = await supabase
    .from("requirement_templates")
    .select("display_order")
    .eq("product_id", input.productId)
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextDisplayOrder = (lastRow?.display_order ?? 0) + 10;

  const { data, error } = await supabase
    .from("requirement_templates")
    .insert({
      product_id: input.productId,
      code: input.code,
      name: input.name,
      description: input.description,
      requirement_kind: input.requirementKind,
      required: input.required,
      display_order: nextDisplayOrder,
    })
    .select(REQUIREMENT_TEMPLATE_SELECT)
    .single<RequirementTemplateRow>();

  if (error) {
    if (error.code === "23505") {
      return { status: "error", code: "DUPLICATE_CODE" };
    }
    console.error("[requirement-templates service] Failed to insert requirement template:", error.message);
    return { status: "error", code: "INSERT_FAILED" };
  }

  return { status: "ok", requirementTemplate: toRequirementTemplate(data) };
}

export interface UpdateRequirementTemplateInput {
  name: LocalizedText;
  description: LocalizedText;
  required: boolean;
}

export type UpdateRequirementTemplateResult =
  | { status: "ok"; requirementTemplate: RequirementTemplate }
  | { status: "error"; code: "NOT_FOUND" | "UPDATE_FAILED" };

/** Updates name/description/required only — deliberately cannot change
 * `code`, `requirement_kind`, or `status` here. `code` and
 * `requirement_kind` are both practically immutable by convention (see the
 * migration comment — kind determines how the requirement is rendered and,
 * later, what shape of Evidence satisfies it, so changing it after
 * creation is treated the same as renaming an identity fact, not editing
 * business content). Status changes go through setRequirementTemplateStatus,
 * which enforces transition legality. */
export async function updateRequirementTemplate(
  requirementTemplateId: string,
  input: UpdateRequirementTemplateInput
): Promise<UpdateRequirementTemplateResult> {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from("requirement_templates")
    .update({ name: input.name, description: input.description, required: input.required })
    .eq("id", requirementTemplateId)
    .select(REQUIREMENT_TEMPLATE_SELECT)
    .maybeSingle<RequirementTemplateRow>();

  if (error) {
    console.error("[requirement-templates service] Failed to update requirement template:", error.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }
  if (!data) {
    return { status: "error", code: "NOT_FOUND" };
  }

  return { status: "ok", requirementTemplate: toRequirementTemplate(data) };
}

export type SetRequirementTemplateStatusResult =
  | { status: "ok"; requirementTemplate: RequirementTemplate }
  | { status: "error"; code: "NOT_FOUND" | "INVALID_TRANSITION" | "UPDATE_FAILED" };

/**
 * Transitions a requirement template's status, enforcing
 * REQUIREMENT_STATUS_TRANSITIONS server-side (never trusts the caller to
 * have only offered a legal target). Reads the current status first,
 * validates the transition, then writes status/status_changed_at/
 * status_changed_by_profile_id together in one guarded UPDATE
 * (`.eq("status", currentStatus)`) — if a concurrent request changed the
 * status in between, the guard matches zero rows and this returns
 * INVALID_TRANSITION rather than silently overwriting a change it never
 * validated. Identical idiom to src/lib/services/products.ts#setProductStatus.
 */
export async function setRequirementTemplateStatus(
  requirementTemplateId: string,
  targetStatus: RequirementStatus,
  actorProfileId: string
): Promise<SetRequirementTemplateStatusResult> {
  const supabase = getSupabaseServerClient();

  const { data: current, error: fetchError } = await supabase
    .from("requirement_templates")
    .select("status")
    .eq("id", requirementTemplateId)
    .maybeSingle();

  if (fetchError) {
    console.error(
      "[requirement-templates service] Failed to look up requirement template before status change:",
      fetchError.message
    );
    return { status: "error", code: "UPDATE_FAILED" };
  }
  if (!current) {
    return { status: "error", code: "NOT_FOUND" };
  }

  const currentStatus = current.status as RequirementStatus;
  if (!REQUIREMENT_STATUS_TRANSITIONS[currentStatus].includes(targetStatus)) {
    return { status: "error", code: "INVALID_TRANSITION" };
  }

  const { data: updated, error: updateError } = await supabase
    .from("requirement_templates")
    .update({
      status: targetStatus,
      status_changed_at: new Date().toISOString(),
      status_changed_by_profile_id: actorProfileId,
    })
    .eq("id", requirementTemplateId)
    .eq("status", currentStatus)
    .select(REQUIREMENT_TEMPLATE_SELECT)
    .maybeSingle<RequirementTemplateRow>();

  if (updateError) {
    console.error("[requirement-templates service] Failed to update requirement template status:", updateError.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }
  if (!updated) {
    return { status: "error", code: "INVALID_TRANSITION" };
  }

  return { status: "ok", requirementTemplate: toRequirementTemplate(updated) };
}

export type MoveRequirementTemplateResult =
  | { status: "ok"; requirementTemplates: RequirementTemplate[] }
  | { status: "error"; code: "NOT_FOUND" | "ALREADY_AT_EDGE" | "UPDATE_FAILED" };

/**
 * Swaps display_order with the immediate neighbor WITHIN THE SAME PRODUCT's
 * requirement list — presentation-only reordering, see the migration
 * comment. Loads only the owning product's own requirement templates
 * (never the global table) before computing neighbors, so reordering can
 * never swap display_order across two different products' requirements.
 * Two sequential updates rather than a single transaction, same reasoning
 * as src/lib/services/products.ts#moveProduct. Returns the full,
 * freshly-reordered list for that product so the caller can replace its
 * state in one shot.
 */
export async function moveRequirementTemplate(
  requirementTemplateId: string,
  direction: "up" | "down"
): Promise<MoveRequirementTemplateResult> {
  const supabase = getSupabaseServerClient();

  const { data: target, error: targetError } = await supabase
    .from("requirement_templates")
    .select("product_id")
    .eq("id", requirementTemplateId)
    .maybeSingle();

  if (targetError) {
    console.error(
      "[requirement-templates service] Failed to look up requirement template before reorder:",
      targetError.message
    );
    return { status: "error", code: "UPDATE_FAILED" };
  }
  if (!target) {
    return { status: "error", code: "NOT_FOUND" };
  }

  const { data, error } = await supabase
    .from("requirement_templates")
    .select(REQUIREMENT_TEMPLATE_SELECT)
    .eq("product_id", target.product_id)
    .order("display_order", { ascending: true });

  if (error) {
    console.error("[requirement-templates service] Failed to load requirement templates before reorder:", error.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }

  const rows = (data ?? []) as unknown as RequirementTemplateRow[];
  const index = rows.findIndex((row) => row.id === requirementTemplateId);
  if (index === -1) {
    return { status: "error", code: "NOT_FOUND" };
  }

  const neighborIndex = direction === "up" ? index - 1 : index + 1;
  if (neighborIndex < 0 || neighborIndex >= rows.length) {
    return { status: "error", code: "ALREADY_AT_EDGE" };
  }

  const current = rows[index];
  const neighbor = rows[neighborIndex];

  const { error: firstUpdateError } = await supabase
    .from("requirement_templates")
    .update({ display_order: neighbor.display_order })
    .eq("id", current.id);
  if (firstUpdateError) {
    console.error(
      "[requirement-templates service] Failed to update display_order during reorder:",
      firstUpdateError.message
    );
    return { status: "error", code: "UPDATE_FAILED" };
  }

  const { error: secondUpdateError } = await supabase
    .from("requirement_templates")
    .update({ display_order: current.display_order })
    .eq("id", neighbor.id);
  if (secondUpdateError) {
    console.error(
      "[requirement-templates service] Failed to update neighbor's display_order during reorder:",
      secondUpdateError.message
    );
    return { status: "error", code: "UPDATE_FAILED" };
  }

  const { data: reordered, error: reloadError } = await supabase
    .from("requirement_templates")
    .select(REQUIREMENT_TEMPLATE_SELECT)
    .eq("product_id", target.product_id)
    .order("display_order", { ascending: true });

  if (reloadError) {
    console.error("[requirement-templates service] Failed to reload requirement templates after reorder:", reloadError.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }

  const reorderedRows = (reordered ?? []) as unknown as RequirementTemplateRow[];
  return { status: "ok", requirementTemplates: reorderedRows.map(toRequirementTemplate) };
}
