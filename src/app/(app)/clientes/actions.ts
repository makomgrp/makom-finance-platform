"use server";

import { createClient, updateClientProfile, setClientStatus } from "@/lib/services/clients";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { REAL_CLIENT_STATUS_VALUES } from "@/lib/config/client-status";
import type { RealClient, RealClientStatus, RealIdentificationType } from "@/types";

/**
 * Thin Server Action wrappers around src/lib/services/clients.ts, matching
 * the exact same shape as every other Server Action in this app (see
 * src/app/(app)/solicitudes/actions.ts#setSolicitudApplicationStatus): each
 * function only validates input, authenticates the caller via
 * getCurrentProfile(), delegates to the Client service, and maps the
 * outcome to a safe, client-facing result. No business logic lives here —
 * this file exists only because src/lib/services/clients.ts is
 * server-only and therefore unreachable from the "use client" components
 * this milestone adds (real-client-form-dialog.tsx, clients-table.tsx).
 * Milestone 14C — see the Milestone 14A architecture review.
 *
 * Every mutation is attributed to the caller's own getCurrentProfile().id
 * and hardcoded to source "crm_manual" — never client-supplied — since
 * these actions are reachable only from an authenticated CRM session,
 * matching every other manual-mutation action in this app.
 */

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENTIFICATION_TYPES: RealIdentificationType[] = ["cedula", "pasaporte"];

export interface ClientProfileFields {
  fullName: string;
  identificationType: RealIdentificationType;
  identificationNumber: string;
  phone: string;
  email: string;
  companyLegacyId?: string;
  position: string;
  monthlySalary: number;
  birthDate: string;
  nationality: string;
  address: string;
  observations?: string;
}

function hasValidProfileFields(input: ClientProfileFields): boolean {
  return (
    isNonEmptyString(input.fullName) &&
    (IDENTIFICATION_TYPES as string[]).includes(input.identificationType) &&
    isNonEmptyString(input.identificationNumber) &&
    isNonEmptyString(input.phone) &&
    isNonEmptyString(input.email) &&
    isNonEmptyString(input.position) &&
    isNonEmptyString(input.nationality) &&
    isNonEmptyString(input.address) &&
    isNonEmptyString(input.birthDate) &&
    typeof input.monthlySalary === "number" &&
    input.monthlySalary >= 0
  );
}

export type CreateClientActionResult =
  | { status: "success"; client: RealClient }
  | {
      status: "error";
      code: "INVALID_INPUT" | "UNAUTHENTICATED" | "DUPLICATE_IDENTIFICATION" | "INSERT_FAILED";
    };

export async function createClientAction(input: ClientProfileFields): Promise<CreateClientActionResult> {
  if (!hasValidProfileFields(input)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    console.error("[clientes actions] createClientAction rejected: no authenticated profile.");
    return { status: "error", code: "UNAUTHENTICATED" };
  }

  const result = await createClient({
    fullName: input.fullName,
    identificationType: input.identificationType,
    identificationNumber: input.identificationNumber,
    phone: input.phone,
    email: input.email,
    companyLegacyId: input.companyLegacyId,
    position: input.position,
    monthlySalary: input.monthlySalary,
    birthDate: input.birthDate,
    nationality: input.nationality,
    address: input.address,
    observations: input.observations,
    source: "crm_manual",
    actorProfileId: profile.id,
  });

  if (result.status !== "ok") {
    const code = result.code === "INVALID_ACTOR" ? "INVALID_INPUT" : result.code;
    return { status: "error", code };
  }

  return { status: "success", client: result.client };
}

export interface UpdateClientProfileActionInput extends ClientProfileFields {
  clientId: string;
}

export type UpdateClientProfileActionResult =
  | { status: "success"; client: RealClient }
  | {
      status: "error";
      code: "INVALID_INPUT" | "UNAUTHENTICATED" | "CLIENT_NOT_FOUND" | "DUPLICATE_IDENTIFICATION" | "UPDATE_FAILED";
    };

export async function updateClientProfileAction(
  input: UpdateClientProfileActionInput
): Promise<UpdateClientProfileActionResult> {
  if (!isNonEmptyString(input.clientId) || !UUID_PATTERN.test(input.clientId) || !hasValidProfileFields(input)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    console.error("[clientes actions] updateClientProfileAction rejected: no authenticated profile.");
    return { status: "error", code: "UNAUTHENTICATED" };
  }

  const result = await updateClientProfile(input.clientId, {
    fullName: input.fullName,
    identificationType: input.identificationType,
    identificationNumber: input.identificationNumber,
    phone: input.phone,
    email: input.email,
    address: input.address,
    companyLegacyId: input.companyLegacyId,
    position: input.position,
    monthlySalary: input.monthlySalary,
    birthDate: input.birthDate,
    nationality: input.nationality,
    observations: input.observations,
  });

  if (result.status !== "ok") {
    return { status: "error", code: result.code };
  }

  return { status: "success", client: result.client };
}

export interface SetClientStatusActionInput {
  clientId: string;
  status: RealClientStatus;
}

export type SetClientStatusActionResult =
  | { status: "success"; client: RealClient }
  | { status: "error"; code: "INVALID_INPUT" | "UNAUTHENTICATED" | "CLIENT_NOT_FOUND" | "UPDATE_FAILED" };

/** No transition-legality graph to enforce here (unlike
 * setSolicitudApplicationStatus) — per the Milestone 14A architecture
 * review, client status changes are administrative; every value in
 * REAL_CLIENT_STATUS_VALUES is always a legal target from any other. */
export async function setClientStatusAction(
  input: SetClientStatusActionInput
): Promise<SetClientStatusActionResult> {
  if (
    !isNonEmptyString(input.clientId) ||
    !UUID_PATTERN.test(input.clientId) ||
    !(REAL_CLIENT_STATUS_VALUES as string[]).includes(input.status)
  ) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    console.error("[clientes actions] setClientStatusAction rejected: no authenticated profile.");
    return { status: "error", code: "UNAUTHENTICATED" };
  }

  const result = await setClientStatus(input.clientId, input.status);
  if (result.status !== "ok") {
    const code = result.code === "INVALID_STATUS" ? "INVALID_INPUT" : result.code;
    return { status: "error", code };
  }

  return { status: "success", client: result.client };
}
