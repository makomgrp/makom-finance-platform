import type { BranchOrigin } from "@/types/branch";
import type { ApplicationSource } from "@/types/application";

/**
 * Client lifecycle stage for the real Client Engine (Milestone 14B).
 * Deliberately narrower than the retired demo model's 6-value vocabulary
 * (activo/prospecto/en_evaluacion/aprobado/restringido/inactivo — see
 * the Milestone 14A architecture review's Client Status section):
 * en_evaluacion and aprobado described an Application's outcome, not a
 * real client-level concept — a client can have zero, one, or several
 * real Applications in different states simultaneously, so duplicating
 * ApplicationStatus semantics onto Client was explicitly rejected. The
 * compliance/risk concept the demo model called "restringido" is split
 * out onto Client.restricted instead — an orthogonal boolean, not a
 * lifecycle stage.
 */
export type ClientStatus = "prospecto" | "activo" | "inactivo";

/**
 * Identification document type for the real Client Engine — lowercase
 * text, matching this schema's established CHECK-constrained vocabulary
 * convention (never a native Postgres ENUM).
 */
export type IdentificationType = "cedula" | "pasaporte";

/**
 * The Client Engine's identity record (Milestone 14B — see the Milestone
 * 14A architecture review; canonical Client model as of Milestone 14F,
 * which retired the demo Client this type coexisted alongside). legacyId
 * is populated only for rows seeded from the original demo fixtures; a
 * newly-created real client (src/lib/services/clients.ts#createClient)
 * never has one. companyLegacyId is a DELIBERATE, TEMPORARY bridge to the
 * still-demo Company model — a real companies table is explicitly out of
 * scope for the Client Engine. assignedAdvisorId is deliberately NOT
 * present here: advisor ownership stays Application-scoped only (see
 * Application.assignedAdvisorProfileId), matching where this codebase's
 * UI has already organically converged.
 */
export interface Client {
  /** MILESTONE 26B-25 — undefined significa que nunca se preguntó, no "ninguna".
   * Cierto para todos los clientes anteriores a este milestone. */
  primarySocialNetwork?: PrimarySocialNetwork;
  /** Solo cuando la red es `other`, y obligatorio en ese caso. */
  primarySocialNetworkOther?: string;
  /** MILESTONE 25C-2 — which branch owns this client TODAY, joined from
   * `clients.branch_id`. Null fields mean UNASSIGNED, which is a real state
   * (public intake, pre-cutover records), never a missing value to fill in.
   * Independent of any application's branch — see 25B-3 transfers. */
  branchOrigin: BranchOrigin;
  id: string;
  legacyId?: string;
  fullName: string;
  identificationType: IdentificationType;
  identificationNumber: string;
  phone: string;
  email: string;
  /**
   * The employer, as the client stated it (Milestone 23). Free text on
   * purpose — ODL's real employers are not a known closed set, and a
   * companies table without employer-based lending rules would be
   * normalisation for its own sake.
   *
   * THIS IS THE ONLY EMPLOYER FIELD NEW CLIENTS WRITE. Undefined means not
   * recorded, which is a true statement; it is never an empty string.
   */
  employerName?: string;
  /**
   * LEGACY, READ-ONLY. Bridge to the static demo Company id (e.g. "c-001"),
   * populated on fixture rows only. Since Milestone 23 the CRM NEVER writes
   * this field — it survives solely so those pre-existing rows still render an
   * employer, and becomes removable once the cutover cleanup has purged them.
   * Read `employerName` first and fall back to this; never the reverse.
   */
  companyLegacyId?: string;
  /**
   * MILESTONE 26B-2A — THE FIVE FIELDS ODL MAY NOT HAVE ASKED FOR YET.
   *
   * Undefined means NOT COLLECTED YET, never "empty" and never zero. The
   * public portal's Step 1 asks only for name, contact and identity, so a
   * client created from it legitimately has none of these until ODL gathers
   * them (Step 2 collects job title and salary; the rest come later).
   *
   * A client created through the CRM still has all five — that form asks for
   * them — so absence here is information, not a defect.
   */
  position?: string;
  monthlySalary?: number;
  birthDate?: string;
  nationality?: string;
  address?: string;
  observations?: string;
  status: ClientStatus;
  /** Orthogonal compliance/risk flag, independent from status — a client
   * can be simultaneously "activo" and restricted. */
  restricted: boolean;
  createdAt: string;
  /** Populated only when createdSource === "crm_manual". */
  createdByProfileId?: string;
  createdSource: ApplicationSource;
}

/**
 * ============================================================================
 * MILESTONE 26B-25 — WHICH NETWORK THIS PERSON ACTUALLY USES
 * ============================================================================
 *
 * Stable internal values, never the visible label. The CRM and the public form
 * both run in Spanish and English, and a row storing "Otros" could not be
 * rendered in the other one — the label is looked up from the message
 * catalogue, so the stored value stays the same in both.
 *
 * The list is closed and mirrors `clients_primary_social_network_check`. ODL
 * named these six; YouTube is deliberately absent because people watch it
 * rather than being reachable on it.
 */
export const PRIMARY_SOCIAL_NETWORKS = [
  "instagram",
  "facebook",
  "tiktok",
  "linkedin",
  "x",
  "other",
] as const;

export type PrimarySocialNetwork = (typeof PRIMARY_SOCIAL_NETWORKS)[number];

export function isPrimarySocialNetwork(value: string): value is PrimarySocialNetwork {
  return (PRIMARY_SOCIAL_NETWORKS as readonly string[]).includes(value);
}
