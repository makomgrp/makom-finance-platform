import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * ============================================================================
 * MATERIALISING CONDITIONAL REQUIREMENTS (26B-3)
 * ============================================================================
 *
 * 26A-3 deliberately does NOT snapshot a conditional requirement when an
 * application is created, because at that moment nobody has said whether there
 * is a guarantor or what the collateral is. Creating those slots anyway would
 * put permanently-incomplete rows into every progress calculation and show an
 * applicant documents they may never owe.
 *
 * Step 2 is where those answers arrive. This module turns an answer into the
 * slots it implies — and nothing else.
 *
 * ----------------------------------------------------------------------------
 * A CONDITION IS ONLY "TRUE" WHEN REAL DATA SAYS SO
 * ----------------------------------------------------------------------------
 *   has_guarantor          -> an application_guarantors row exists
 *   collateral_is_vehicle  -> an application_collateral row of type 'vehicle'
 *                             exists, and the slots bind to THAT row
 *
 * Both are read from the tables Step 2 already writes. Neither is inferred, and
 * neither is remembered separately from the data — so a guarantor removed in
 * Step 2 is a condition that is no longer true.
 *
 * ----------------------------------------------------------------------------
 * TWO CONDITIONS ARE DELIBERATELY NEVER MATERIALISED
 * ----------------------------------------------------------------------------
 *   business_has_tcc               nothing in the schema records whether a
 *                                  business holds a Tax Compliance Certificate.
 *                                  Step 2 does not ask, and guessing from
 *                                  "it's a company" would demand a document
 *                                  from businesses that do not have one.
 *
 *   loan_purpose_requires_proforma WHICH loan purposes require a quotation is
 *                                  lending policy ODL has not stated. Equipment
 *                                  and inventory are the obvious candidates,
 *                                  which is exactly why writing that rule here
 *                                  would be inventing it.
 *
 * Both are reported as open business questions in the milestone report rather
 * than answered by this file. Until ODL answers, the requirement simply does
 * not appear — which is the behaviour 26A-3 designed for.
 *
 * `collateral_is_property` has no templates at all: 26A-3 deliberately seeded
 * no property document requirements, so property collateral materialises
 * nothing. That absence is real, not a bug to route around.
 *
 * ----------------------------------------------------------------------------
 * ADDITIVE ONLY
 * ----------------------------------------------------------------------------
 * This never deletes a slot. A customer who uploads a guarantor's ID and then
 * removes the guarantor in Step 2 would otherwise have their file cascade away
 * (26A-3 binds those slots ON DELETE CASCADE) — but that deletion belongs to
 * the Step 2 write that removed the guarantor, not to a read of Step 3. Here,
 * re-running is safe and idempotent: slots that already exist are skipped.
 */

/** Mirrors the template columns 26A-3 requires a slot to snapshot. */
interface TemplateRow {
  id: string;
  code: string;
  name: Record<string, string>;
  description: Record<string, string> | null;
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

const TEMPLATE_SELECT =
  "id, code, name, description, requirement_kind, required, display_order, min_files, " +
  "allows_multiple_files, stage, actor, condition_key, applicant_visible, " +
  "original_required_later, subject_type";

export type MaterializeResult =
  | { status: "ok"; created: number }
  | { status: "error"; code: "MATERIALIZE_FAILED" };

/**
 * Bring an application's conditional slots in line with its Step 2 answers.
 *
 * Called on every Step 3 render. That is deliberate rather than wasteful: it
 * means a customer who adds a guarantor and immediately continues sees the
 * guarantor's documents, with no separate "regenerate" step to forget.
 */
export async function materializeConditionalSlots(
  applicationId: string,
  productId: string
): Promise<MaterializeResult> {
  const supabase = getSupabaseServerClient();

  const [templatesResult, slotsResult, guarantorsResult, collateralResult] = await Promise.all([
    supabase
      .from("requirement_templates")
      .select(TEMPLATE_SELECT)
      .eq("product_id", productId)
      .eq("status", "active")
      .not("condition_key", "is", null),
    supabase
      .from("requirement_slots")
      .select("requirement_template_id, application_guarantor_id, application_collateral_id")
      .eq("application_id", applicationId),
    supabase
      .from("application_guarantors")
      .select("id")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: true }),
    supabase
      .from("application_collateral")
      .select("id, collateral_type")
      .eq("application_id", applicationId)
      .order("created_at", { ascending: true }),
  ]);

  if (
    templatesResult.error ||
    slotsResult.error ||
    guarantorsResult.error ||
    collateralResult.error
  ) {
    console.error(
      "[slot-materialization] Failed to load state:",
      templatesResult.error?.message ??
        slotsResult.error?.message ??
        guarantorsResult.error?.message ??
        collateralResult.error?.message
    );
    return { status: "error", code: "MATERIALIZE_FAILED" };
  }

  const templates = (templatesResult.data ?? []) as unknown as TemplateRow[];
  const existing = (slotsResult.data ?? []) as {
    requirement_template_id: string | null;
    application_guarantor_id: string | null;
    application_collateral_id: string | null;
  }[];

  // The portal manages ONE guarantor — the oldest — matching the Step 2 write
  // layer's rule. Binding to a different one would create documents for a
  // person the customer was never shown.
  const guarantorId = ((guarantorsResult.data ?? []) as { id: string }[])[0]?.id;
  const vehicle = ((collateralResult.data ?? []) as { id: string; collateral_type: string }[]).find(
    (row) => row.collateral_type === "vehicle"
  );

  // Identity of an already-materialised slot is (template, subject) — the same
  // triple 26A-3's partial unique indexes enforce. Re-running must not attempt
  // a duplicate.
  const seen = new Set(
    existing.map(
      (row) =>
        `${row.requirement_template_id}|${row.application_guarantor_id ?? ""}|${row.application_collateral_id ?? ""}`
    )
  );

  const toInsert: Record<string, unknown>[] = [];

  for (const template of templates) {
    let guarantorBinding: string | null = null;
    let collateralBinding: string | null = null;

    if (template.condition_key === "has_guarantor") {
      if (!guarantorId) continue;
      guarantorBinding = guarantorId;
    } else if (template.condition_key === "collateral_is_vehicle") {
      if (!vehicle) continue;
      collateralBinding = vehicle.id;
    } else {
      // business_has_tcc, loan_purpose_requires_proforma, collateral_is_property
      // — see this module's header. No data answers these, so nothing is
      // created and no requirement is invented.
      continue;
    }

    const key = `${template.id}|${guarantorBinding ?? ""}|${collateralBinding ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // A SNAPSHOT, exactly as createRequirementSlotsForApplication makes one:
    // every configuration column is copied so a later template edit cannot
    // retroactively change what this applicant was asked for.
    toInsert.push({
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
      application_guarantor_id: guarantorBinding,
      application_collateral_id: collateralBinding,
    });
  }

  if (toInsert.length === 0) return { status: "ok", created: 0 };

  const { error } = await supabase.from("requirement_slots").insert(toInsert);
  if (error) {
    // 23505 is the partial unique index doing its job under a concurrent
    // render — the slots exist, which is the outcome we wanted.
    if (error.code === "23505") return { status: "ok", created: 0 };
    console.error("[slot-materialization] Failed to insert slots:", error.message);
    return { status: "error", code: "MATERIALIZE_FAILED" };
  }

  return { status: "ok", created: toInsert.length };
}
