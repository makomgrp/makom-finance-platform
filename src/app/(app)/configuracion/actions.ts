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
import { headers } from "next/headers";
import { requireCapability } from "@/lib/auth/authorize";
import { getProfiles } from "@/lib/services/profiles";
import {
  createStaffProfile,
  linkStaffProfileAuth,
  setStaffActiveStatus,
  updateStaffRole,
} from "@/lib/services/staff-admin";
import { inviteStaffAuthUser } from "@/lib/services/auth-admin";
import { USER_ROLE_VALUES } from "@/lib/config/user-role";
import { SUPPORTED_LANGUAGE_VALUES } from "@/lib/config/language";
import { PRODUCT_STATUS_ORDER } from "@/lib/config/product";
import { REQUIREMENT_KIND_ORDER, REQUIREMENT_STATUS_ORDER } from "@/lib/config/requirement";
import type {
  LocalizedText,
  Product,
  SupportedLanguage,
  UserRole,
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

// ============================================================================
// MILESTONE 21 — STAFF ADMINISTRATION
// ============================================================================
//
// Four actions, all `user:manage` (administrador only). Same Milestone 16
// ordering rule as every action above: requireCapability() FIRST, before any
// validation or lookup, so an unauthorized caller cannot distinguish
// DUPLICATE_EMAIL from PROFILE_NOT_FOUND and probe the staff directory.
//
// The actor is always the caller's own resolved profile — never client input.
// ============================================================================

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface InviteStaffUserInput {
  email: string;
  fullName: string;
  role: UserRole;
  preferredLanguage: SupportedLanguage;
}

export type InviteStaffUserResult =
  | { status: "success"; profileId: string }
  /**
   * The profile EXISTS and is valid, but the Supabase Auth invitation did
   * not complete. Surfaced distinctly and never as success — the
   * administrator must know to resend. See the orchestration note below.
   */
  | { status: "pending_invitation"; profileId: string; code: "INVITE_FAILED" | "LINK_FAILED" }
  | {
      status: "error";
      code:
        | "INVALID_INPUT"
        | "UNAUTHENTICATED"
        | "FORBIDDEN"
        | "DUPLICATE_EMAIL"
        | "ALREADY_REGISTERED"
        | "CREATE_FAILED";
    };

/**
 * Invites a staff member.
 *
 * ----------------------------------------------------------------------------
 * THREE STAGES, AND WHY THE ORDER MATTERS
 * ----------------------------------------------------------------------------
 *   1. create_staff_profile RPC  -> profile row, auth_user_id NULL   [atomic + audited]
 *   2. inviteUserByEmail          -> Supabase Auth account            [EXTERNAL]
 *   3. link_staff_profile_auth    -> attach the returned auth UUID    [atomic]
 *
 * THIS IS NOT ATOMIC, AND CANNOT BE. Supabase Auth lives outside `public`
 * and outside any transaction a database function can join. Rather than
 * pretend otherwise, the order is chosen so every failure lands somewhere
 * valid and recoverable:
 *
 *   Stage 1 fails -> nothing exists. profiles_email_key blocks duplicates.
 *   Stage 2 fails -> the profile survives with auth_user_id NULL. That is a
 *                    PENDING INVITATION — a documented, legitimate state that
 *                    five live profiles already occupy — NOT an orphan. The
 *                    profile is deliberately NOT deleted: no compensating
 *                    destructive cleanup runs here, ever. Recovery is
 *                    resendStaffInvitation.
 *   Stage 3 fails -> auth account and profile both exist, unlinked. Same
 *                    recovery. Nothing is deleted.
 *
 * Because the profile is created FIRST, this ordering can never produce an
 * auth account with no profile behind it — the failure mode that would
 * actually require a destructive fix.
 *
 * LINKING NEVER USES E-MAIL. Live inspection proved a profile's address and
 * its auth account's address routinely differ in this project, so the UUID
 * returned by stage 2 is the only authoritative key.
 */
export async function inviteStaffUser(input: InviteStaffUserInput): Promise<InviteStaffUserResult> {
  const auth = await requireCapability("user:manage");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  const email = isNonEmptyString(input.email) ? input.email.trim().toLowerCase() : "";
  const fullName = isNonEmptyString(input.fullName) ? input.fullName.trim() : "";

  if (!EMAIL_PATTERN.test(email)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!fullName || fullName.length > MAX_NAME_LENGTH) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!(USER_ROLE_VALUES as readonly string[]).includes(input.role)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!(SUPPORTED_LANGUAGE_VALUES as readonly string[]).includes(input.preferredLanguage)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  // --- Stage 1 -------------------------------------------------------------
  const created = await createStaffProfile({
    email,
    fullName,
    role: input.role,
    preferredLanguage: input.preferredLanguage,
    actorProfileId: auth.profile.id,
  });
  if (created.status === "error") {
    return { status: "error", code: created.code };
  }

  // --- Stage 2 (external, non-atomic) --------------------------------------
  const origin = (await headers()).get("origin");
  if (!origin) {
    console.error("[configuracion actions] inviteStaffUser: no origin header; invitation not sent.");
    return { status: "pending_invitation", profileId: created.profileId, code: "INVITE_FAILED" };
  }

  const invited = await inviteStaffAuthUser(email, origin);
  if (invited.status === "error") {
    // Profile intentionally retained. See this function's doc comment.
    return { status: "pending_invitation", profileId: created.profileId, code: "INVITE_FAILED" };
  }

  // --- Stage 3 -------------------------------------------------------------
  const linked = await linkStaffProfileAuth(created.profileId, invited.authUserId, auth.profile.id);
  if (linked.status === "error") {
    return { status: "pending_invitation", profileId: created.profileId, code: "LINK_FAILED" };
  }

  return { status: "success", profileId: created.profileId };
}

export type ResendStaffInvitationResult =
  | { status: "success" }
  | {
      status: "error";
      code:
        | "INVALID_INPUT"
        | "UNAUTHENTICATED"
        | "FORBIDDEN"
        | "PROFILE_NOT_FOUND"
        | "ALREADY_LINKED"
        | "INVITE_FAILED";
    };

/**
 * Recovery for a pending invitation: re-runs stages 2 and 3 for a profile
 * that already exists but has no linked auth account.
 *
 * Deliberately re-reads the profile's e-mail SERVER-SIDE rather than taking
 * it from the client — the address to invite is a stored fact, not caller
 * input. `link_staff_profile_auth` is idempotent for the same auth user, so
 * repeated attempts converge rather than conflict.
 */
export async function resendStaffInvitation(profileId: string): Promise<ResendStaffInvitationResult> {
  const auth = await requireCapability("user:manage");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(profileId) || !UUID_PATTERN.test(profileId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const profilesResult = await getProfiles();
  if (profilesResult.status === "error") {
    return { status: "error", code: "INVITE_FAILED" };
  }
  const target = profilesResult.users.find((user) => user.id === profileId);
  if (!target) {
    return { status: "error", code: "PROFILE_NOT_FOUND" };
  }
  // Already linked: there is nothing to resend, and re-inviting would create
  // a second auth account for the same person.
  if (target.authLinked) {
    return { status: "error", code: "ALREADY_LINKED" };
  }

  const origin = (await headers()).get("origin");
  if (!origin) {
    return { status: "error", code: "INVITE_FAILED" };
  }

  const invited = await inviteStaffAuthUser(target.email, origin);
  if (invited.status === "error") {
    return { status: "error", code: "INVITE_FAILED" };
  }

  const linked = await linkStaffProfileAuth(profileId, invited.authUserId, auth.profile.id);
  if (linked.status === "error") {
    return {
      status: "error",
      code: linked.code === "ALREADY_LINKED" ? "ALREADY_LINKED" : "INVITE_FAILED",
    };
  }

  return { status: "success" };
}

export interface SetStaffUserRoleInput {
  profileId: string;
  role: UserRole;
}

export type SetStaffUserRoleResult =
  | { status: "success" }
  | {
      status: "error";
      code: "INVALID_INPUT" | "UNAUTHENTICATED" | "FORBIDDEN" | "PROFILE_NOT_FOUND" | "UPDATE_FAILED";
    };

/** Changes a staff member's role. The role drives the entire Milestone 16
 * capability matrix, so the change is audited (`user_role_changed`) with both
 * the previous and new value, recorded atomically with the update. */
export async function setStaffUserRole(input: SetStaffUserRoleInput): Promise<SetStaffUserRoleResult> {
  const auth = await requireCapability("user:manage");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(input.profileId) || !UUID_PATTERN.test(input.profileId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!(USER_ROLE_VALUES as readonly string[]).includes(input.role)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const result = await updateStaffRole(input.profileId, input.role, auth.profile.id);
  if (result.status === "error") {
    const code = result.code === "INVALID_INPUT" ? "INVALID_INPUT" : result.code;
    return { status: "error", code };
  }

  return { status: "success" };
}

export interface SetStaffUserActiveInput {
  profileId: string;
  active: boolean;
}

export type SetStaffUserActiveResult =
  | { status: "success" }
  | {
      status: "error";
      code:
        | "INVALID_INPUT"
        | "UNAUTHENTICATED"
        | "FORBIDDEN"
        | "PROFILE_NOT_FOUND"
        | "CANNOT_DEACTIVATE_SELF"
        | "UPDATE_FAILED";
    };

/**
 * Deactivates or reactivates a staff member — the ONLY offboarding path in
 * this product. There is no deletion action, by approved policy.
 *
 * `active = false` blocks CRM access completely (getCurrentProfile() returns
 * null), removes the person from the Chat directory, and leaves every
 * historical record they authored intact and attributed.
 */
export async function setStaffUserActive(
  input: SetStaffUserActiveInput
): Promise<SetStaffUserActiveResult> {
  const auth = await requireCapability("user:manage");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(input.profileId) || !UUID_PATTERN.test(input.profileId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (typeof input.active !== "boolean") {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const result = await setStaffActiveStatus(input.profileId, input.active, auth.profile.id);
  if (result.status === "error") {
    return { status: "error", code: result.code };
  }

  return { status: "success" };
}
