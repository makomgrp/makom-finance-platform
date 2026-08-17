"use server";

import {
  createProduct as createProductService,
  updateProductDetails as updateProductDetailsService,
  setProductStatus as setProductStatusService,
  moveProduct as moveProductService,
} from "@/lib/services/products";
import {
  createRequirementTemplate as createRequirementTemplateService,
  updateRequirementTemplate as updateRequirementTemplateService,
  setRequirementTemplateStatus as setRequirementTemplateStatusService,
  moveRequirementTemplate as moveRequirementTemplateService,
} from "@/lib/services/requirement-templates";
import { requireCapability } from "@/lib/auth/authorize";
import { PRODUCT_STATUS_ORDER } from "@/lib/config/product";
import { REQUIREMENT_KIND_ORDER, REQUIREMENT_STATUS_ORDER } from "@/lib/config/requirement";
import type {
  LocalizedText,
  Product,
  ProductStatus,
  RequirementKind,
  RequirementStatus,
  RequirementTemplate,
} from "@/types";

/**
 * Thin Server Action wrapper around src/lib/services/products.ts, matching
 * the same shape as src/app/(app)/expedientes/actions.ts: validates input,
 * authenticates the caller, delegates to the service, maps the outcome to
 * a safe, client-facing result.
 *
 * Never accepts a client-supplied actor identity — the caller is always
 * derived from getCurrentProfile(), same rule as every other Server Action
 * in this app since Milestone 5.
 *
 * MILESTONE 16 — EVERY action in this file is ADMINISTRADOR-ONLY. These are
 * the CRM's system-configuration mutations: they define the Products the
 * business offers and the Requirement Templates every future Application
 * inherits, so a change here silently reshapes work across every other
 * module rather than affecting one record. `gerente` deliberately does NOT
 * hold these despite holding every operational capability — the Milestone 16
 * boundary is operations vs. configuration, not seniority. The two
 * capabilities below (`product:manage`, `requirement_template:manage`) are
 * the only ones in the canonical matrix granted to exactly one role.
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
  | { status: "error"; code: "INVALID_INPUT" | "UNAUTHENTICATED" | "FORBIDDEN" | "DUPLICATE_CODE" | "CREATE_FAILED" };

export async function createProduct(input: CreateProductInput): Promise<CreateProductActionResult> {
  const auth = await requireCapability("product:manage");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

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
  | { status: "error"; code: "INVALID_INPUT" | "UNAUTHENTICATED" | "FORBIDDEN" | "PRODUCT_NOT_FOUND" | "UPDATE_FAILED" };

export async function updateProductDetails(
  input: UpdateProductDetailsInput
): Promise<UpdateProductDetailsActionResult> {
  const auth = await requireCapability("product:manage");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

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
      code: "INVALID_INPUT" | "UNAUTHENTICATED" | "FORBIDDEN" | "PRODUCT_NOT_FOUND" | "INVALID_TRANSITION" | "UPDATE_FAILED";
    };

/** Never accepts statusChangedByProfileId from the client — only productId
 * and the target status. Legality of the transition (draft->active,
 * active->inactive, inactive->active only) is re-validated server-side by
 * the service, not trusted from whatever the UI happened to offer. */
export async function setProductStatus(input: SetProductStatusInput): Promise<SetProductStatusActionResult> {
  const auth = await requireCapability("product:manage");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(input.productId) || !UUID_PATTERN.test(input.productId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!(PRODUCT_STATUS_ORDER as string[]).includes(input.status)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const result = await setProductStatusService(input.productId, input.status, auth.profile.id);
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
      code: "INVALID_INPUT" | "UNAUTHENTICATED" | "FORBIDDEN" | "PRODUCT_NOT_FOUND" | "ALREADY_AT_EDGE" | "UPDATE_FAILED";
    };

export async function moveProduct(input: MoveProductInput): Promise<MoveProductActionResult> {
  const auth = await requireCapability("product:manage");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(input.productId) || !UUID_PATTERN.test(input.productId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (input.direction !== "up" && input.direction !== "down") {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const result = await moveProductService(input.productId, input.direction);
  if (result.status !== "ok") {
    return { status: "error", code: result.code };
  }

  return { status: "success", products: result.products };
}

// ============================================================================
// createRequirementTemplate
// ============================================================================

export interface CreateRequirementTemplateInput {
  productId: string;
  code: string;
  name: LocalizedText;
  description: LocalizedText;
  requirementKind: RequirementKind;
  required: boolean;
}

export type CreateRequirementTemplateActionResult =
  | { status: "success"; requirementTemplate: RequirementTemplate }
  | { status: "error"; code: "INVALID_INPUT" | "UNAUTHENTICATED" | "FORBIDDEN" | "DUPLICATE_CODE" | "CREATE_FAILED" };

export async function createRequirementTemplate(
  input: CreateRequirementTemplateInput
): Promise<CreateRequirementTemplateActionResult> {
  const auth = await requireCapability("requirement_template:manage");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(input.productId) || !UUID_PATTERN.test(input.productId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!isNonEmptyString(input.code) || !CODE_PATTERN.test(input.code.trim())) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!isValidLocalizedText(input.name, MAX_NAME_LENGTH)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!isValidLocalizedText(input.description, MAX_DESCRIPTION_LENGTH)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!(REQUIREMENT_KIND_ORDER as string[]).includes(input.requirementKind)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (typeof input.required !== "boolean") {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const result = await createRequirementTemplateService({
    productId: input.productId,
    code: input.code.trim(),
    name: normalizeLocalizedText(input.name),
    description: normalizeLocalizedText(input.description),
    requirementKind: input.requirementKind,
    required: input.required,
  });

  if (result.status !== "ok") {
    return { status: "error", code: result.code === "DUPLICATE_CODE" ? "DUPLICATE_CODE" : "CREATE_FAILED" };
  }

  return { status: "success", requirementTemplate: result.requirementTemplate };
}

// ============================================================================
// updateRequirementTemplate
// ============================================================================

export interface UpdateRequirementTemplateInput {
  requirementTemplateId: string;
  name: LocalizedText;
  description: LocalizedText;
  required: boolean;
}

export type UpdateRequirementTemplateActionResult =
  | { status: "success"; requirementTemplate: RequirementTemplate }
  | { status: "error"; code: "INVALID_INPUT" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "UPDATE_FAILED" };

/** Deliberately cannot change `code`, `productId`, or `requirementKind`
 * here — both are treated as locked identity/classification facts, same
 * as the service layer's own contract. Only name, description, and the
 * required/optional toggle are editable after creation. */
export async function updateRequirementTemplate(
  input: UpdateRequirementTemplateInput
): Promise<UpdateRequirementTemplateActionResult> {
  const auth = await requireCapability("requirement_template:manage");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(input.requirementTemplateId) || !UUID_PATTERN.test(input.requirementTemplateId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!isValidLocalizedText(input.name, MAX_NAME_LENGTH)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!isValidLocalizedText(input.description, MAX_DESCRIPTION_LENGTH)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (typeof input.required !== "boolean") {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const result = await updateRequirementTemplateService(input.requirementTemplateId, {
    name: normalizeLocalizedText(input.name),
    description: normalizeLocalizedText(input.description),
    required: input.required,
  });

  if (result.status !== "ok") {
    return { status: "error", code: result.code };
  }

  return { status: "success", requirementTemplate: result.requirementTemplate };
}

// ============================================================================
// setRequirementTemplateStatus
// ============================================================================

export interface SetRequirementTemplateStatusInput {
  requirementTemplateId: string;
  status: RequirementStatus;
}

export type SetRequirementTemplateStatusActionResult =
  | { status: "success"; requirementTemplate: RequirementTemplate }
  | {
      status: "error";
      code: "INVALID_INPUT" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "INVALID_TRANSITION" | "UPDATE_FAILED";
    };

/** Never accepts statusChangedByProfileId from the client — only
 * requirementTemplateId and the target status. Legality of the transition
 * is re-validated server-side by the service, not trusted from whatever
 * the UI happened to offer. */
export async function setRequirementTemplateStatus(
  input: SetRequirementTemplateStatusInput
): Promise<SetRequirementTemplateStatusActionResult> {
  const auth = await requireCapability("requirement_template:manage");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(input.requirementTemplateId) || !UUID_PATTERN.test(input.requirementTemplateId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!(REQUIREMENT_STATUS_ORDER as string[]).includes(input.status)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const result = await setRequirementTemplateStatusService(
    input.requirementTemplateId,
    input.status,
    auth.profile.id
  );
  if (result.status !== "ok") {
    return { status: "error", code: result.code };
  }

  return { status: "success", requirementTemplate: result.requirementTemplate };
}

// ============================================================================
// moveRequirementTemplate
// ============================================================================

export interface MoveRequirementTemplateInput {
  requirementTemplateId: string;
  direction: "up" | "down";
}

export type MoveRequirementTemplateActionResult =
  | { status: "success"; requirementTemplates: RequirementTemplate[] }
  | {
      status: "error";
      code: "INVALID_INPUT" | "UNAUTHENTICATED" | "FORBIDDEN" | "NOT_FOUND" | "ALREADY_AT_EDGE" | "UPDATE_FAILED";
    };

export async function moveRequirementTemplate(
  input: MoveRequirementTemplateInput
): Promise<MoveRequirementTemplateActionResult> {
  const auth = await requireCapability("requirement_template:manage");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(input.requirementTemplateId) || !UUID_PATTERN.test(input.requirementTemplateId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (input.direction !== "up" && input.direction !== "down") {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const result = await moveRequirementTemplateService(input.requirementTemplateId, input.direction);
  if (result.status !== "ok") {
    return { status: "error", code: result.code };
  }

  return { status: "success", requirementTemplates: result.requirementTemplates };
}
