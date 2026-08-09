/**
 * The application's own 5-value execution lifecycle — independent from
 * products.status and requirement_templates.status (both configuration
 * lifecycles, not execution ones). Deliberately narrower than the demo
 * LoanStatus vocabulary (see src/types/loan-application.ts): pending_
 * documentos / documentacion_completa are not real statuses here, since
 * both are computed live from RequirementSlot statuses instead of stored.
 * See the Milestone 11 architecture review's Lifecycle section.
 */
export type ApplicationStatus = "new" | "in_review" | "approved" | "not_eligible" | "cancelled";

/** Which channel/actor-type created the application or performed a status
 * transition — same vocabulary as RequirementSlotSource. */
export type ApplicationSource = "crm_manual" | "website_form" | "whatsapp" | "ai";

/**
 * The Application Engine's identity + lifecycle record (Milestone 11).
 * A client's request for a specific Product — the central entity
 * RequirementSlot (and later Document Evidence, Workflow, AI Rules) hang
 * off of via applicationId. Deliberately thin — see the Milestone 11
 * architecture review for the full "what belongs inside vs. outside
 * Applications" reasoning.
 *
 * productId, requestedAmount, and requestedTermMonths are immutable
 * forever once set — no update path exists for any of them in
 * src/lib/services/applications.ts. clientLegacyId is a TEMPORARY bridge
 * to the existing demo-data client ids, following the same pattern
 * RequirementSlot's former applicationLegacyId used until this same
 * milestone replaced it.
 */
export interface Application {
  id: string;
  applicationNumber: string;
  /** TEMPORARY bridge to the existing demo-data client ids (e.g.
   * "cl-001") — the Client module has no Supabase table yet. See the
   * migration comment for the recommended replacement path once a real
   * clients table exists. */
  clientLegacyId: string;
  /** Immutable — no update path exists. See the migration comment for
   * why product switching is deliberately unsupported. */
  productId: string;
  /** The client's originally-requested amount, immutable forever once
   * set. Deliberately distinct from any future approved amount. */
  requestedAmount: number;
  /** The client's originally-requested term in months, immutable forever
   * once set. Deliberately distinct from any future approved term. */
  requestedTermMonths: number;
  createdAt: string;
  /** Populated only when createdSource === "crm_manual". */
  createdByProfileId?: string;
  createdSource: ApplicationSource;
  status: ApplicationStatus;
  statusChangedAt?: string;
  /** Populated only when the actor was a real CRM profile
   * (statusChangedSource === "crm_manual"). */
  statusChangedByProfileId?: string;
  statusChangedSource?: ApplicationSource;
  /** Which advisor currently owns this case — freely reassignable, no
   * accompanying audit trail by deliberate design. */
  assignedAdvisorProfileId?: string;
}
