import type { ApplicationSource } from "@/types/application";

export type ClientStatus =
  | "activo"
  | "prospecto"
  | "en_evaluacion"
  | "aprobado"
  | "restringido"
  | "inactivo";

export type IdentificationType = "Cédula" | "Pasaporte";

export interface Client {
  id: string;
  fullName: string;
  idType: IdentificationType;
  idNumber: string;
  phone: string;
  email: string;
  companyId: string;
  position: string;
  monthlySalary: number;
  birthDate: string;
  nationality: string;
  address: string;
  observations?: string;
  status: ClientStatus;
  registeredAt: string;
  assignedAdvisorId: string;
}

/**
 * Client lifecycle stage for the real Client Engine (Milestone 14B).
 * Deliberately narrower than the demo ClientStatus above: en_evaluacion
 * and aprobado describe an Application's outcome, not a real client-level
 * concept — a client can have zero, one, or several real Applications in
 * different states simultaneously, so duplicating ApplicationStatus
 * semantics onto Client was explicitly rejected. See the Milestone 14A
 * architecture review's Client Status section. The compliance/risk
 * concept the demo model called "restringido" is split out onto
 * RealClient.restricted instead — an orthogonal boolean, not a lifecycle
 * stage.
 */
export type RealClientStatus = "prospecto" | "activo" | "inactivo";

/**
 * Identification document type for the real Client Engine — lowercase
 * text, matching this schema's established CHECK-constrained vocabulary
 * convention (never a native Postgres ENUM), unlike the demo
 * IdentificationType above which uses display-cased Spanish strings
 * directly.
 */
export type RealIdentificationType = "cedula" | "pasaporte";

/**
 * The Client Engine's identity record (Milestone 14B — see the Milestone
 * 14A architecture review). Coexists with the demo Client above for the
 * duration of the Milestone 14 migration — every current UI surface still
 * reads the demo Client; nothing consumes RealClient yet. legacyId is
 * populated only for rows seeded from the demo fixtures; a newly-created
 * real client (src/lib/services/clients.ts#createClient) never has one.
 * companyLegacyId is a DELIBERATE, TEMPORARY bridge to the still-demo
 * Company model — a real companies table is explicitly out of scope for
 * the Client Engine. assignedAdvisorId is deliberately NOT present here:
 * advisor ownership stays Application-scoped only (see
 * Application.assignedAdvisorProfileId), matching where this codebase's
 * UI has already organically converged.
 */
export interface RealClient {
  id: string;
  legacyId?: string;
  fullName: string;
  identificationType: RealIdentificationType;
  identificationNumber: string;
  phone: string;
  email: string;
  /** DELIBERATE, TEMPORARY bridge to the still-demo Company id (e.g.
   * "c-001") — see this interface's doc comment. */
  companyLegacyId?: string;
  position: string;
  monthlySalary: number;
  birthDate: string;
  nationality: string;
  address: string;
  observations?: string;
  status: RealClientStatus;
  /** Orthogonal compliance/risk flag, independent from status — a client
   * can be simultaneously "activo" and restricted. */
  restricted: boolean;
  createdAt: string;
  /** Populated only when createdSource === "crm_manual". */
  createdByProfileId?: string;
  createdSource: ApplicationSource;
}
