"use server";

import {
  createProduct as createProductService,
  updateProductDetails as updateProductDetailsService,
  setProductStatus as setProductStatusService,
  moveProduct as moveProductService,
} from "@/lib/services/products";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { PRODUCT_STATUS_ORDER } from "@/lib/config/product";
import type { LocalizedText, Product, ProductStatus } from "@/types";

/**
 * Thin Server Action wrapper around src/lib/services/products.ts, matching
 * the same shape as src/app/(app)/expedientes/actions.ts: validates input,
 * authenticates the caller, delegates to the service, maps the outcome to
 * a safe, client-facing result.
 *
 * Never accepts a client-supplied actor identity — the caller is always
 * derived from getCurrentProfile(), same rule as every other Server Action
 * in this app since Milestone 5.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Mirrors products_code_format_check in the products table migration.
const CODE_PATTERN = /^[a-z][a-z0-9_]{1,59}$/;
const MAX_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 500;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Requires both "es" and "en" keys, non-empty, within maxLength — mirrors
 * products_name_locales_check / products_short_description_locales_check. */
function isValidLocalizedText(value: unknown, maxLength: number): value is LocalizedText {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    isNonEmptyString(record.es) &&
    record.es.trim().length <= maxLength &&
    isNonEmptyString(record.en) &&
    record.en.trim().length <= maxLength
  );
}

function normalizeLocalizedText(value: LocalizedText): LocalizedText {
  return { es: value.es.trim(), en: value.en.trim() };
}

// ============================================================================
// createProduct
// ============================================================================

export interface CreateProductInput {
  code: string;
  name: LocalizedText;
  shortDescription?: LocalizedText;
}

export type CreateProductActionResult =
  | { status: "success"; product: Product }
  | { status: "error"; code: "INVALID_INPUT" | "UNAUTHENTICATED" | "DUPLICATE_CODE" | "CREATE_FAILED" };

export async function createProduct(input: CreateProductInput): Promise<CreateProductActionResult> {
  if (!isNonEmptyString(input.code) || !CODE_PATTERN.test(input.code.trim())) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!isValidLocalizedText(input.name, MAX_NAME_LENGTH)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (
    input.shortDescription !== undefined &&
    !isValidLocalizedText(input.shortDescription, MAX_DESCRIPTION_LENGTH)
  ) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    console.error("[configuracion actions] createProduct rejected: no authenticated profile.");
    return { status: "error", code: "UNAUTHENTICATED" };
  }

  const result = await createProductService({
    code: input.code.trim(),
    name: normalizeLocalizedText(input.name),
    shortDescription: input.shortDescription ? normalizeLocalizedText(input.shortDescription) : undefined,
  });

  if (result.status !== "ok") {
    return { status: "error", code: result.code === "DUPLICATE_CODE" ? "DUPLICATE_CODE" : "CREATE_FAILED" };
  }

  return { status: "success", product: result.product };
}

// ============================================================================
// updateProductDetails
// ============================================================================

export interface UpdateProductDetailsInput {
  productId: string;
  name: LocalizedText;
  shortDescription?: LocalizedText;
}

export type UpdateProductDetailsActionResult =
  | { status: "success"; product: Product }
  | { status: "error"; code: "INVALID_INPUT" | "UNAUTHENTICATED" | "PRODUCT_NOT_FOUND" | "UPDATE_FAILED" };

export async function updateProductDetails(
  input: UpdateProductDetailsInput
): Promise<UpdateProductDetailsActionResult> {
  if (!isNonEmptyString(input.productId) || !UUID_PATTERN.test(input.productId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!isValidLocalizedText(input.name, MAX_NAME_LENGTH)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (
    input.shortDescription !== undefined &&
    !isValidLocalizedText(input.shortDescription, MAX_DESCRIPTION_LENGTH)
  ) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    console.error("[configuracion actions] updateProductDetails rejected: no authenticated profile.");
    return { status: "error", code: "UNAUTHENTICATED" };
  }

  const result = await updateProductDetailsService(input.productId, {
    name: normalizeLocalizedText(input.name),
    shortDescription: input.shortDescription ? normalizeLocalizedText(input.shortDescription) : undefined,
  });

  if (result.status !== "ok") {
    return { status: "error", code: result.code };
  }

  return { status: "success", product: result.product };
}

// ============================================================================
// setProductStatus
// ============================================================================

export interface SetProductStatusInput {
  productId: string;
  status: ProductStatus;
}

export type SetProductStatusActionResult =
  | { status: "success"; product: Product }
  | {
      status: "error";
      code: "INVALID_INPUT" | "UNAUTHENTICATED" | "PRODUCT_NOT_FOUND" | "INVALID_TRANSITION" | "UPDATE_FAILED";
    };

/** Never accepts statusChangedByProfileId from the client — only productId
 * and the target status. Legality of the transition (draft->active,
 * active->inactive, inactive->active only) is re-validated server-side by
 * the service, not trusted from whatever the UI happened to offer. */
export async function setProductStatus(input: SetProductStatusInput): Promise<SetProductStatusActionResult> {
  if (!isNonEmptyString(input.productId) || !UUID_PATTERN.test(input.productId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!(PRODUCT_STATUS_ORDER as string[]).includes(input.status)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    console.error("[configuracion actions] setProductStatus rejected: no authenticated profile.");
    return { status: "error", code: "UNAUTHENTICATED" };
  }

  const result = await setProductStatusService(input.productId, input.status, profile.id);
  if (result.status !== "ok") {
    return { status: "error", code: result.code };
  }

  return { status: "success", product: result.product };
}

// ============================================================================
// moveProduct
// ============================================================================

export interface MoveProductInput {
  productId: string;
  direction: "up" | "down";
}

export type MoveProductActionResult =
  | { status: "success"; products: Product[] }
  | {
      status: "error";
      code: "INVALID_INPUT" | "UNAUTHENTICATED" | "PRODUCT_NOT_FOUND" | "ALREADY_AT_EDGE" | "UPDATE_FAILED";
    };

export async function moveProduct(input: MoveProductInput): Promise<MoveProductActionResult> {
  if (!isNonEmptyString(input.productId) || !UUID_PATTERN.test(input.productId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (input.direction !== "up" && input.direction !== "down") {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    console.error("[configuracion actions] moveProduct rejected: no authenticated profile.");
    return { status: "error", code: "UNAUTHENTICATED" };
  }

  const result = await moveProductService(input.productId, input.direction);
  if (result.status !== "ok") {
    return { status: "error", code: result.code };
  }

  return { status: "success", products: result.products };
}
