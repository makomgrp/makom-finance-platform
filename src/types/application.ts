import type { BranchOrigin } from "@/types/branch";
import type { LocalizedText } from "@/types/product";

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
 * transition — same vocabulary as RequirementSlotSource and
 * EvidenceUploadedSource. `email` added in Milestone 15B (Application
 * Intake Foundation) — see the Milestone 15A architecture review's
 * Application Creation Strategy section for why Damion's explicit email
 * requirement made this the one addition to an otherwise-stable
 * vocabulary. */
export type ApplicationSource = "crm_manual" | "website_form" | "whatsapp" | "email" | "ai";

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
 * src/lib/services/applications.ts. clientId is the real Client Engine
 * relationship (Milestone 14E — see the Milestone 14E implementation
 * report), replacing the former TEMPORARY clientLegacyId bridge as the
 * primary relationship; the underlying client_legacy_id column still
 * exists on the row but is no longer exposed here (see applications.
 * client_legacy_id's own migration comment for why it isn't dropped yet).
 */
export interface Application {
  /** MILESTONE 25C-2 — the application's OWN branch, joined from
   * `applications.branch_id` and never inferred from the client. 25B-3 moves
   * the two independently, so they may legitimately differ. Null fields mean
   * UNASSIGNED. */
  branchOrigin: BranchOrigin;
  id: string;
  applicationNumber: string;
  /** The real Client this application belongs to (Milestone 14E). NOT
   * NULL, ON DELETE RESTRICT — see applications.client_id's migration
   * comment. */
  clientId: string;
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

/**
 * `Application` plus its resolved Product identity and advisor name
 * (Milestone 13B — the foundation layer for the future Solicitudes
 * migration; see the Milestone 13A architecture review and its final
 * validation, "Application Workspace" question). Returned only by
 * src/lib/services/applications.ts#getApplications() — a thin, additive
 * extension of Application, not a separate read model: productId's
 * FK is NOT NULL, so productCode/productName are always resolved for
 * every row; assignedAdvisorProfileId remains independently nullable, so
 * assignedAdvisorFullName is populated only when it is.
 */
export interface ApplicationListItem extends Application {
  productCode: string;
  productName: LocalizedText;
  /** Resolved server-side (joined from profiles) — never guessed
   * client-side. Undefined exactly when assignedAdvisorProfileId is. */
  assignedAdvisorFullName?: string;
  /** Resolved server-side (joined from clients) — never guessed
   * client-side. Always populated: clientId is NOT NULL. */
  clientFullName: string;
  /**
   * Milestone 19: who created this application, resolved server-side.
   * Undefined exactly when createdByProfileId is — i.e. for every
   * application that arrived through an automated intake channel rather
   * than the CRM (see applications_created_by_source_check).
   */
  createdByFullName?: string;
  /**
   * Milestone 19: who performed the MOST RECENT status change, resolved
   * server-side. Undefined exactly when statusChangedByProfileId is.
   *
   * NOTE THE SCOPE DELIBERATELY: this names the actor of the LATEST
   * transition only. `applications` stores status/status_changed_at/
   * status_changed_by_profile_id/status_changed_source as four single
   * overwritten columns, so earlier transitions and their actors are not
   * retained anywhere. Never present this as a transition history.
   */
  statusChangedByFullName?: string;
}
