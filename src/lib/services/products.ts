import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getProductIdsWithActiveRequirementTemplates } from "@/lib/services/requirement-templates";
import { PRODUCT_STATUS_TRANSITIONS } from "@/lib/config/product";
import type { LocalizedText, Product, ProductStatus } from "@/types";

/**
 * Server-only service for the Product Engine's identity + lifecycle table
 * (Milestone 9A — see the Milestone 9 architecture review). Uses the Admin
 * Client, same posture as every other service in this app: RLS is enabled
 * on `products` with zero policies, so this is the only way to read or
 * write it until a real permissions model exists.
 *
 * Deliberately minimal: create, read, update-details, status transition,
 * reorder. No delete — see the migration's comment on why products are
 * never hard-deleted, only moved to inactive.
 */

interface ProductRow {
  id: string;
  code: string;
  name: Record<string, string>;
  short_description: Record<string, string> | null;
  status: string;
  display_order: number;
  status_changed_at: string | null;
  status_changed_by_profile_id: string | null;
  created_at: string;
  status_changed_by: { full_name: string } | null;
}

const PRODUCT_SELECT =
  "id, code, name, short_description, status, display_order, status_changed_at, status_changed_by_profile_id, created_at, " +
  "status_changed_by:profiles!products_status_changed_by_profile_id_fkey(full_name)";

function toProduct(row: ProductRow): Product {
  return {
    id: row.id,
    code: row.code,
    name: row.name as LocalizedText,
    shortDescription: (row.short_description as LocalizedText | null) ?? undefined,
    status: row.status as ProductStatus,
    displayOrder: row.display_order,
    statusChangedAt: row.status_changed_at ?? undefined,
    statusChangedByProfileId: row.status_changed_by_profile_id ?? undefined,
    statusChangedByFullName: row.status_changed_by?.full_name ?? undefined,
    createdAt: row.created_at,
  };
}

export type GetProductsResult = { status: "ok"; products: Product[] } | { status: "error" };

/** Loads every product, in display order. No fallback to demo data on
 * failure (there is no demo data for this module) — callers get an
 * explicit "error" status, matching every other service in this app. */
export async function getAllProducts(): Promise<GetProductsResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("products")
      .select(PRODUCT_SELECT)
      .order("display_order", { ascending: true });

    if (error) {
      console.error("[products service] Failed to load products:", error.message);
      return { status: "error" };
    }

    const rows = (data ?? []) as unknown as ProductRow[];
    return { status: "ok", products: rows.map(toProduct) };
  } catch (error) {
    console.error(
      "[products service] Unexpected failure loading products:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

/**
 * THE canonical answer to "may a new Application be created against this
 * Product?" (Milestone 17). Every caller — the Solicitudes page, the
 * Clientes page, and the createSolicitudApplication Server Action's own
 * server-side re-validation — resolves through THIS function, so the list
 * the UI offers and the list the server accepts can never disagree.
 *
 * A product is creatable when BOTH hold:
 *   1. status = 'active'. `draft` and `inactive` are excluded — the same
 *      rule the Application Intake pipeline already enforces for inbound
 *      channels (see application-intake-processing.ts's `product_inactive`
 *      review reason), applied here to the CRM path so both origination
 *      routes agree on what a usable product is.
 *   2. it has at least one ACTIVE requirement template. Without one,
 *      createApplication() would succeed but come back "partial" with
 *      SLOT_SNAPSHOT_FAILED, leaving an application with no Requirement
 *      Slots to work. Milestone 17 (decision P1, option A) excludes those
 *      products from origination instead; nothing here modifies them,
 *      their status, or their templates.
 *
 * Returns "error" if EITHER underlying read fails — deliberately never a
 * partial list. A half-resolved eligibility list would silently hide
 * usable products from the operator, or worse, offer an unusable one.
 */
export type GetApplicationCreatableProductsResult =
  | { status: "ok"; products: Product[] }
  | { status: "error" };

export async function getApplicationCreatableProducts(): Promise<GetApplicationCreatableProductsResult> {
  const [productsResult, templatesResult] = await Promise.all([
    getAllProducts(),
    getProductIdsWithActiveRequirementTemplates(),
  ]);

  if (productsResult.status === "error" || templatesResult.status === "error") {
    return { status: "error" };
  }

  return {
    status: "ok",
    products: productsResult.products.filter(
      (product) => product.status === "active" && templatesResult.productIds.has(product.id)
    ),
  };
}

export type GetProductResult = { status: "ok"; product: Product } | { status: "error" };

/** Loads a single product by id — backs the product-detail page
 * (Configuración > Productos > [product] > Requisitos). Same
 * no-fallback-on-error contract as getAllProducts; "error" also covers "not
 * found", since the detail page treats both as "can't show this product"
 * rather than distinguishing them. */
export async function getProductById(productId: string): Promise<GetProductResult> {
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("products")
      .select(PRODUCT_SELECT)
      .eq("id", productId)
      .maybeSingle<ProductRow>();

    if (error) {
      console.error("[products service] Failed to load product:", error.message);
      return { status: "error" };
    }
    if (!data) {
      return { status: "error" };
    }

    return { status: "ok", product: toProduct(data) };
  } catch (error) {
    console.error(
      "[products service] Unexpected failure loading product:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

export interface CreateProductInput {
  code: string;
  name: LocalizedText;
  shortDescription?: LocalizedText;
}

export type CreateProductResult =
  | { status: "ok"; product: Product }
  | { status: "error"; code: "DUPLICATE_CODE" | "INSERT_FAILED" };

/** New products are always created in draft (the column default) with no
 * status_changed_at/by (satisfies products_status_changed_pair_check by
 * construction — no transition has happened yet), and placed after every
 * existing product (current max display_order + 10, or 10 if this is the
 * first product ever) — sparse-gap convention, see the migration comment. */
export async function createProduct(input: CreateProductInput): Promise<CreateProductResult> {
  const supabase = getSupabaseServerClient();

  const { data: lastRow } = await supabase
    .from("products")
    .select("display_order")
    .order("display_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nextDisplayOrder = (lastRow?.display_order ?? 0) + 10;

  const { data, error } = await supabase
    .from("products")
    .insert({
      code: input.code,
      name: input.name,
      short_description: input.shortDescription ?? null,
      display_order: nextDisplayOrder,
    })
    .select(PRODUCT_SELECT)
    .single<ProductRow>();

  if (error) {
    if (error.code === "23505") {
      return { status: "error", code: "DUPLICATE_CODE" };
    }
    console.error("[products service] Failed to insert product:", error.message);
    return { status: "error", code: "INSERT_FAILED" };
  }

  return { status: "ok", product: toProduct(data) };
}

export interface UpdateProductDetailsInput {
  name: LocalizedText;
  shortDescription?: LocalizedText;
}

export type UpdateProductDetailsResult =
  | { status: "ok"; product: Product }
  | { status: "error"; code: "PRODUCT_NOT_FOUND" | "UPDATE_FAILED" };

/** Updates name/short_description only — deliberately cannot change `code`
 * or `status` here. `code` is practically immutable by convention (see the
 * migration comment); status changes go through setProductStatus, which
 * enforces transition legality. */
export async function updateProductDetails(
  productId: string,
  input: UpdateProductDetailsInput
): Promise<UpdateProductDetailsResult> {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from("products")
    .update({ name: input.name, short_description: input.shortDescription ?? null })
    .eq("id", productId)
    .select(PRODUCT_SELECT)
    .maybeSingle<ProductRow>();

  if (error) {
    console.error("[products service] Failed to update product details:", error.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }
  if (!data) {
    return { status: "error", code: "PRODUCT_NOT_FOUND" };
  }

  return { status: "ok", product: toProduct(data) };
}

export type SetProductStatusResult =
  | { status: "ok"; product: Product }
  | { status: "error"; code: "PRODUCT_NOT_FOUND" | "INVALID_TRANSITION" | "UPDATE_FAILED" };

/**
 * Transitions a product's status, enforcing PRODUCT_STATUS_TRANSITIONS
 * server-side (never trusts the caller to have only offered a legal
 * target). Reads the current status first, validates the transition, then
 * writes status/status_changed_at/status_changed_by_profile_id together in
 * one guarded UPDATE (`.eq("status", currentStatus)`) — if a concurrent
 * request changed the status in between, the guard matches zero rows and
 * this returns INVALID_TRANSITION rather than silently overwriting a
 * change it never validated, the same race-safety idiom as
 * src/lib/services/alerts.ts#setAlertStatus.
 */
export async function setProductStatus(
  productId: string,
  targetStatus: ProductStatus,
  actorProfileId: string
): Promise<SetProductStatusResult> {
  const supabase = getSupabaseServerClient();

  const { data: current, error: fetchError } = await supabase
    .from("products")
    .select("status")
    .eq("id", productId)
    .maybeSingle();

  if (fetchError) {
    console.error("[products service] Failed to look up product before status change:", fetchError.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }
  if (!current) {
    return { status: "error", code: "PRODUCT_NOT_FOUND" };
  }

  const currentStatus = current.status as ProductStatus;
  if (!PRODUCT_STATUS_TRANSITIONS[currentStatus].includes(targetStatus)) {
    return { status: "error", code: "INVALID_TRANSITION" };
  }

  const { data: updated, error: updateError } = await supabase
    .from("products")
    .update({
      status: targetStatus,
      status_changed_at: new Date().toISOString(),
      status_changed_by_profile_id: actorProfileId,
    })
    .eq("id", productId)
    .eq("status", currentStatus)
    .select(PRODUCT_SELECT)
    .maybeSingle<ProductRow>();

  if (updateError) {
    console.error("[products service] Failed to update product status:", updateError.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }
  if (!updated) {
    return { status: "error", code: "INVALID_TRANSITION" };
  }

  return { status: "ok", product: toProduct(updated) };
}

export type MoveProductResult =
  | { status: "ok"; products: Product[] }
  | { status: "error"; code: "PRODUCT_NOT_FOUND" | "ALREADY_AT_EDGE" | "UPDATE_FAILED" };

/**
 * Swaps display_order with the immediate neighbor in the current ordering
 * — presentation-only reordering, see the migration comment. Two
 * sequential updates rather than a single transaction (no multi-statement
 * transaction primitive is available through the JS client here); low-risk
 * for an admin-only, low-concurrency management screen. Returns the full,
 * freshly-reordered product list so the caller can replace its state in
 * one shot rather than reconciling a single row.
 */
export async function moveProduct(productId: string, direction: "up" | "down"): Promise<MoveProductResult> {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .order("display_order", { ascending: true });

  if (error) {
    console.error("[products service] Failed to load products before reorder:", error.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }

  const rows = (data ?? []) as unknown as ProductRow[];
  const index = rows.findIndex((row) => row.id === productId);
  if (index === -1) {
    return { status: "error", code: "PRODUCT_NOT_FOUND" };
  }

  const neighborIndex = direction === "up" ? index - 1 : index + 1;
  if (neighborIndex < 0 || neighborIndex >= rows.length) {
    return { status: "error", code: "ALREADY_AT_EDGE" };
  }

  const current = rows[index];
  const neighbor = rows[neighborIndex];

  const { error: firstUpdateError } = await supabase
    .from("products")
    .update({ display_order: neighbor.display_order })
    .eq("id", current.id);
  if (firstUpdateError) {
    console.error("[products service] Failed to update display_order during reorder:", firstUpdateError.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }

  const { error: secondUpdateError } = await supabase
    .from("products")
    .update({ display_order: current.display_order })
    .eq("id", neighbor.id);
  if (secondUpdateError) {
    console.error(
      "[products service] Failed to update neighbor's display_order during reorder:",
      secondUpdateError.message
    );
    return { status: "error", code: "UPDATE_FAILED" };
  }

  const { data: reordered, error: reloadError } = await supabase
    .from("products")
    .select(PRODUCT_SELECT)
    .order("display_order", { ascending: true });

  if (reloadError) {
    console.error("[products service] Failed to reload products after reorder:", reloadError.message);
    return { status: "error", code: "UPDATE_FAILED" };
  }

  const reorderedRows = (reordered ?? []) as unknown as ProductRow[];
  return { status: "ok", products: reorderedRows.map(toProduct) };
}
