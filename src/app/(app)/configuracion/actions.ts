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
import {
  grantStaffCapability,
  revokeStaffCapability,
} from "@/lib/services/capability-grants";
import {
  createBranch,
  setBranchActive,
  updateBranch,
  type BranchInput,
} from "@/lib/services/branches";
import {
  assignProfileBranch,
  removeProfileBranch,
  setProfileBranchScopeMode,
  setProfilePrimaryBranch,
} from "@/lib/services/branch-memberships";
import {
  isDelegatableCapability,
  type DelegatableCapability,
} from "@/lib/auth/capabilities";
import { getProfiles } from "@/lib/services/profiles";
import {
  createStaffProfile,
  linkStaffProfileAuth,
  setStaffActiveStatus,
  updateStaffRole,
  setStaffAutoAssignment,
} from "@/lib/services/staff-admin";
import { inviteStaffAuthUser } from "@/lib/services/auth-admin";
import { USER_ROLE_VALUES } from "@/lib/config/user-role";
import { SUPPORTED_LANGUAGE_VALUES } from "@/lib/config/language";
import { PRODUCT_STATUS_ORDER } from "@/lib/config/product";
import { REQUIREMENT_KIND_ORDER, REQUIREMENT_STATUS_ORDER } from "@/lib/config/requirement";
import type {
  BranchScopeMode,
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
// Four actions, each gated on its own Milestone 24 capability
// (`user:invite` / `user:set_role` / `user:set_active`). Same Milestone 16
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
  const auth = await requireCapability("user:invite");
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
  const auth = await requireCapability("user:invite");
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
      code:
        | "INVALID_INPUT"
        | "UNAUTHENTICATED"
        | "FORBIDDEN"
        | "PROFILE_NOT_FOUND"
        /** Milestone 24A — would leave zero active administradores. */
        | "LAST_ADMINISTRATOR"
        | "UPDATE_FAILED";
    };

/** Changes a staff member's role. The role drives the entire Milestone 16
 * capability matrix, so the change is audited (`user_role_changed`) with both
 * the previous and new value, recorded atomically with the update. */
export async function setStaffUserRole(input: SetStaffUserRoleInput): Promise<SetStaffUserRoleResult> {
  const auth = await requireCapability("user:set_role");
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
        /** Milestone 24A — would leave zero active administradores. */
        | "LAST_ADMINISTRATOR"
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
  const auth = await requireCapability("user:set_active");
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

/* ============================================================================
 * MILESTONE 24 — PER-USER CAPABILITY DELEGATION
 * ============================================================================
 *
 * The two actions below are the ONLY way additional permissions are granted or
 * revoked, and they are the only actions in this application guarded by
 * `user:manage_permissions` — a capability held by administrador alone and
 * excluded from the delegatable allow-list, in TypeScript AND by a database
 * CHECK constraint.
 *
 * That is the line the whole milestone rests on. A gerente holding all three
 * delegatable staff capabilities can invite, activate, deactivate and re-role
 * ordinary employees all day, and can never reach these two functions — so
 * they can never widen anyone's authority, including their own.
 *
 * DEFENCE IN DEPTH: requireCapability() below is the caller-authorization
 * boundary, and the RPCs independently hard-code `actor.role = 'administrador'`
 * (A6) plus refuse self-grant and self-revoke (A5). Neither layer is decorative
 * — if the capability check here were ever mis-wired, the database would still
 * refuse.
 * ========================================================================== */

export interface StaffCapabilityInput {
  profileId: string;
  /** Must be one of DELEGATABLE_CAPABILITIES. Validated here, again by the
   * RPC, and again by the CHECK constraint. */
  capability: string;
}

export type StaffCapabilityResult =
  | { status: "success" }
  | {
      status: "error";
      code:
        | "INVALID_INPUT"
        | "UNAUTHENTICATED"
        | "FORBIDDEN"
        | "PROFILE_NOT_FOUND"
        | "MUTATION_FAILED";
    };

/** Shared validation for both directions. Deliberately NOT a shared action:
 * grant and revoke stay two distinct entry points so each is independently
 * greppable in the guarded-action inventory and neither can be reached by
 * flipping a boolean. */
function validateStaffCapabilityInput(input: StaffCapabilityInput): boolean {
  return (
    isNonEmptyString(input.profileId) &&
    UUID_PATTERN.test(input.profileId) &&
    // Rejects user:manage_permissions and every business capability before the
    // request reaches the database.
    isDelegatableCapability(input.capability)
  );
}

/**
 * Grants one delegatable capability to one staff member.
 *
 * ORDERING (Milestone 16 rule): requireCapability() is the FIRST statement,
 * before input validation, so an unauthorized caller cannot distinguish
 * INVALID_INPUT from PROFILE_NOT_FOUND and probe for staff they may not see.
 *
 * SELF-GRANT IS REFUSED BY THE DATABASE (A5), not here. The check is stated
 * once, in the RPC, where it cannot be bypassed; duplicating it in this layer
 * would create a second rule to keep in sync. The UI hides the control on
 * one's own row as a courtesy only.
 *
 * Idempotent: granting something already held succeeds, creates no duplicate
 * row and writes no audit event.
 */
export async function grantStaffUserCapability(
  input: StaffCapabilityInput
): Promise<StaffCapabilityResult> {
  const auth = await requireCapability("user:manage_permissions");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!validateStaffCapabilityInput(input)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const result = await grantStaffCapability(
    input.profileId,
    input.capability as DelegatableCapability,
    auth.profile.id
  );
  if (result.status !== "ok") {
    return { status: "error", code: result.code };
  }

  return { status: "success" };
}

/**
 * Revokes one delegatable capability from one staff member.
 *
 * Same guards and same ordering as the grant path. Idempotent: revoking
 * something not held succeeds and writes no audit event.
 *
 * NOTE: this is not the only way a grant disappears. Changing a profile's base
 * role revokes ALL of its grants atomically inside update_staff_role, each with
 * its own audit event — an employee moved from gerente to asesor must not
 * silently retain delegated staff-management authority.
 */
export async function revokeStaffUserCapability(
  input: StaffCapabilityInput
): Promise<StaffCapabilityResult> {
  const auth = await requireCapability("user:manage_permissions");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!validateStaffCapabilityInput(input)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const result = await revokeStaffCapability(
    input.profileId,
    input.capability as DelegatableCapability,
    auth.profile.id
  );
  if (result.status !== "ok") {
    return { status: "error", code: result.code };
  }

  return { status: "success" };
}

/* ============================================================================
 * MILESTONE 25A — BRANCH ADMINISTRATION
 * ============================================================================
 *
 * THREE CAPABILITIES, DELIBERATELY NOT ONE:
 *
 *   branch:create  creating a branch defines ODL's organizational structure.
 *                  ADMINISTRADOR-ONLY AND NON-DELEGATABLE — a branch nobody is
 *                  yet a member of lies outside every delegated manager's
 *                  scope, so delegating its creation could only ever be useless
 *                  (they could not touch it) or an escalation (if creation
 *                  assigned them to it).
 *   branch:manage  operating EXISTING branches and staff memberships, strictly
 *                  inside the actor's own branch scope. DELEGATABLE — Damion
 *                  travels, Randol runs operations, and neither needs Randol to
 *                  become an administrador.
 *   user:manage_permissions
 *                  changing someone's branch SCOPE MODE. See the scope-mode
 *                  action below for why this capability and not branch:manage.
 *
 * MILESTONE 25A ENFORCES NO BRANCH ISOLATION on client or application data.
 * These actions administer branches and staff scope; nothing here filters
 * operational reads or branch-checks operational mutations. That is 25B.
 *
 * DEFENCE IN DEPTH: requireCapability() below is the caller-authorization
 * boundary; the RPCs independently enforce B1-B6 using roles, identity and
 * membership alone. Neither layer is decorative.
 * ========================================================================== */

const MAX_BRANCH_TEXT = 200;
const BRANCH_CODE_PATTERN = /^[A-Z0-9-]{2,12}$/;

export interface BranchActionInput {
  code: string;
  name: string;
  province: string;
  city?: string;
  address?: string;
  phone?: string;
  email?: string;
  isHeadquarters: boolean;
}

export type BranchActionResult =
  | { status: "success"; branchId: string }
  | {
      status: "error";
      code:
        | "INVALID_INPUT"
        | "UNAUTHENTICATED"
        | "FORBIDDEN"
        | "DUPLICATE_CODE"
        | "NOT_FOUND"
        | "MUTATION_FAILED";
    };

/** Shared shape validation. The database re-checks the code format
 * (branches_code_format_check) and uniqueness (branches_code_key) — this exists
 * so a bad value returns INVALID_INPUT instead of a raw constraint violation,
 * the same posture every other action in this file takes. */
function normalizeBranchInput(input: BranchActionInput): BranchInput | null {
  const code = isNonEmptyString(input.code) ? input.code.trim().toUpperCase() : "";
  const name = isNonEmptyString(input.name) ? input.name.trim() : "";
  const province = isNonEmptyString(input.province) ? input.province.trim() : "";

  if (!BRANCH_CODE_PATTERN.test(code)) return null;
  if (!name || name.length > MAX_BRANCH_TEXT) return null;
  if (!province || province.length > MAX_BRANCH_TEXT) return null;
  if (typeof input.isHeadquarters !== "boolean") return null;

  for (const optional of [input.city, input.address, input.phone, input.email]) {
    if (optional !== undefined && optional.length > MAX_BRANCH_TEXT) return null;
  }

  return {
    code,
    name,
    province,
    city: input.city?.trim() || undefined,
    address: input.address?.trim() || undefined,
    phone: input.phone?.trim() || undefined,
    email: input.email?.trim() || undefined,
    isHeadquarters: input.isHeadquarters,
  };
}

/**
 * Creates a branch. Requires `branch:create` — administrador-only and
 * non-delegatable — and the RPC independently hard-codes `actor.role =
 * 'administrador'`.
 *
 * NO MEMBERSHIP IS CREATED FOR THE ACTOR, deliberately. If creating a branch
 * assigned the creator to it, branch administration would become a
 * scope-expansion mechanism, which B6 exists to prevent.
 */
export async function createBranchAction(
  input: BranchActionInput
): Promise<BranchActionResult> {
  const auth = await requireCapability("branch:create");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  const normalized = normalizeBranchInput(input);
  if (!normalized) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const result = await createBranch(normalized, auth.profile.id);
  if (result.status !== "ok") {
    return { status: "error", code: result.code };
  }
  return { status: "success", branchId: result.branchId };
}

/**
 * Edits an existing branch. `branch:manage`, plus the RPC's own B1/B6 check
 * that the branch is inside the actor's branch scope — so a delegated manager
 * edits only the branches they already belong to.
 *
 * The audit event records CHANGED FIELD NAMES ONLY. A branch's phone, e-mail
 * and address are contact data that change over time, and crm_events is
 * append-only with no delete path — copying values in would make them
 * permanently uncorrectable.
 */
export async function updateBranchAction(
  branchId: string,
  input: BranchActionInput
): Promise<BranchActionResult> {
  const auth = await requireCapability("branch:manage");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(branchId) || !UUID_PATTERN.test(branchId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  const normalized = normalizeBranchInput(input);
  if (!normalized) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const result = await updateBranch(branchId, normalized, auth.profile.id);
  if (result.status !== "ok") {
    return { status: "error", code: result.code };
  }
  return { status: "success", branchId: result.branchId };
}

/**
 * Activates or deactivates a branch — the only "removal" this product has.
 * Branches are permanent FK targets on historical clients and applications, so
 * there is no delete path and none may be added.
 */
export async function setBranchActiveAction(
  branchId: string,
  active: boolean
): Promise<BranchActionResult> {
  const auth = await requireCapability("branch:manage");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(branchId) || !UUID_PATTERN.test(branchId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (typeof active !== "boolean") {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const result = await setBranchActive(branchId, active, auth.profile.id);
  if (result.status !== "ok") {
    return { status: "error", code: result.code };
  }
  return { status: "success", branchId: result.branchId };
}

export type BranchMembershipActionResult =
  | { status: "success" }
  | {
      status: "error";
      code:
        | "INVALID_INPUT"
        | "UNAUTHENTICATED"
        | "FORBIDDEN"
        | "PROFILE_NOT_FOUND"
        | "MUTATION_FAILED";
    };

/**
 * Assigns a staff member to a branch. `branch:manage`.
 *
 * B1/B2/B3/B5/B6 are enforced in the RPC, not duplicated here: the destination
 * must be inside the actor's scope, the target's existing memberships must be a
 * subset of it, nobody may modify their own, and only an administrador may
 * touch an administrador. Stating them once, where they cannot be bypassed, is
 * the same discipline Milestone 24 used for A1-A8.
 */
export async function assignProfileBranchAction(
  profileId: string,
  branchId: string,
  isPrimary: boolean
): Promise<BranchMembershipActionResult> {
  const auth = await requireCapability("branch:manage");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(profileId) || !UUID_PATTERN.test(profileId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!isNonEmptyString(branchId) || !UUID_PATTERN.test(branchId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (typeof isPrimary !== "boolean") {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const result = await assignProfileBranch(profileId, branchId, isPrimary, auth.profile.id);
  if (result.status !== "ok") {
    return { status: "error", code: result.code };
  }
  return { status: "success" };
}

/** Removes a staff member from a branch. Same guards as assignment. */
export async function removeProfileBranchAction(
  profileId: string,
  branchId: string
): Promise<BranchMembershipActionResult> {
  const auth = await requireCapability("branch:manage");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(profileId) || !UUID_PATTERN.test(profileId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!isNonEmptyString(branchId) || !UUID_PATTERN.test(branchId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const result = await removeProfileBranch(profileId, branchId, auth.profile.id);
  if (result.status !== "ok") {
    return { status: "error", code: result.code };
  }
  return { status: "success" };
}

/** Marks an existing membership as primary. Requires the membership to exist —
 * enforced in the RPC. */
export async function setProfilePrimaryBranchAction(
  profileId: string,
  branchId: string
): Promise<BranchMembershipActionResult> {
  const auth = await requireCapability("branch:manage");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(profileId) || !UUID_PATTERN.test(profileId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!isNonEmptyString(branchId) || !UUID_PATTERN.test(branchId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const result = await setProfilePrimaryBranch(profileId, branchId, auth.profile.id);
  if (result.status !== "ok") {
    return { status: "error", code: result.code };
  }
  return { status: "success" };
}

/**
 * Sets a staff member's branch SCOPE MODE — 'branch' or 'national'.
 *
 * GUARDED BY `user:manage_permissions`, NOT `branch:manage`, and the choice
 * matters. National reach is the widest thing anyone can be given, and
 * `branch:manage` is DELEGATABLE — gating scope mode with it would mean a
 * delegated manager could hand out organization-wide data access, which is
 * precisely what "delegating an action must never delegate scope" forbids.
 *
 * No new capability was invented for this. `user:manage_permissions` already
 * means "change how much authority this person has", is administrador-only, and
 * is already non-delegatable in both TypeScript and the database — exactly the
 * properties this operation needs (B4).
 *
 * The RPC independently hard-codes `actor.role = 'administrador'`, so even a
 * mis-wired capability check here could not widen anyone's reach.
 */
export async function setProfileBranchScopeModeAction(
  profileId: string,
  mode: BranchScopeMode
): Promise<BranchMembershipActionResult> {
  const auth = await requireCapability("user:manage_permissions");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(profileId) || !UUID_PATTERN.test(profileId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (mode !== "branch" && mode !== "national") {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const result = await setProfileBranchScopeMode(profileId, mode, auth.profile.id);
  if (result.status !== "ok") {
    return { status: "error", code: result.code };
  }
  return { status: "success" };
}

// ============================================================================
// MILESTONE 26B-6B — AUTOMATIC LEAD DISTRIBUTION PARTICIPATION
// ============================================================================
//
// CAPABILITY: `application:assign_advisor`, held by administrador and gerente.
//
// Deciding WHO RECEIVES LEADS is the same authority as deciding who owns one,
// so it reuses that capability rather than inventing a second permission with
// identical holders. Deliberately NOT `user:set_active` (administrador only):
// that switch is the offboarding mechanism and means something entirely
// different — being out of the rotation is not being locked out of the CRM.
//
// A normal `asesor` holds neither, so an advisor can neither reassign a process
// nor quietly add themselves to the rotation. Enforced here, server-side; the
// UI hiding the control is a convenience, not the boundary.

export interface SetStaffAutoAssignmentInput {
  profileId: string;
  enabled: boolean;
}

export type SetStaffAutoAssignmentActionResult =
  | { status: "success" }
  | {
      status: "error";
      code: "UNAUTHENTICATED" | "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND" | "UPDATE_FAILED";
    };

export async function setStaffAutoAssignmentAction(
  input: SetStaffAutoAssignmentInput
): Promise<SetStaffAutoAssignmentActionResult> {
  const auth = await requireCapability("application:assign_advisor");
  if (auth.status === "denied") {
    return { status: "error", code: auth.code };
  }

  if (!isNonEmptyString(input.profileId) || !UUID_PATTERN.test(input.profileId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (typeof input.enabled !== "boolean") {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const result = await setStaffAutoAssignment(input.profileId, input.enabled, auth.profile.id);
  if (result.status === "error") {
    return { status: "error", code: result.code };
  }

  return { status: "success" };
}
