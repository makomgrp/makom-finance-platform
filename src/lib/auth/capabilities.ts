import type { UserRole } from "@/types";

/**
 * ============================================================================
 * ARCHITECTURAL RULE — THE ONLY AUTHORIZATION MATRIX IN THIS REPOSITORY
 * ============================================================================
 *
 * Milestone 16 (Security Floor). Before this module, `profiles.role` was
 * display-only: every authenticated active profile could invoke every
 * mutation in the CRM, because no Server Action ever compared a role to
 * anything. Route protection (Milestone 4) proved *a* valid session reached
 * a page; getCurrentProfile() (Milestone 5) proved *who* was calling an
 * action; neither ever asked whether that person was allowed to.
 *
 * This file answers that last question, and it is the ONLY place allowed to.
 * No module may write `role === "administrador"` (or any other direct role
 * comparison) to decide whether an operation is permitted — server-side or
 * client-side. If a new operation needs a rule, it gets a Capability here
 * and a row in ROLE_CAPABILITIES here. Duplicating the matrix, or shortcutting
 * it with an inline role check, is an architecture violation, not a style
 * preference: a second matrix is a second thing to forget to update, and an
 * inline check is a rule no audit can find.
 *
 * DELIBERATELY NOT A NUMERIC ROLE LEVEL. `gerente`, `analista` and `asesor`
 * are NOT increasingly-privileged versions of one another — they are
 * different jobs with genuinely overlapping-but-distinct powers. An analyst
 * may pass judgment on a Requirement Slot but may not create a client; an
 * advisor may create a client and upload evidence but may not review it.
 * Neither is "above" the other, and any `level >= 3` scheme would have to
 * lie about that. Capabilities are enumerated explicitly, per role, so the
 * matrix can express exactly what the business means and nothing more.
 *
 * ISOMORPHIC BY DESIGN — this module is deliberately NOT marked
 * "server-only". The server enforcement layer (src/lib/auth/authorize.ts)
 * and the client UI (via useCurrentProfile().role) both read this same
 * matrix, so a hidden button and a rejected Server Action can never
 * disagree about the rule. The server remains authoritative regardless:
 * hiding a control is a courtesy, requireCapability() is the enforcement.
 * Nothing secret lives here — it is a static policy table, safe to ship to
 * the browser.
 */

/**
 * Every distinct thing a user can be permitted to do, derived one-for-one
 * from the CURRENT exported Server Action inventory (Milestone 16 audit) —
 * not from a speculative future permission scheme. Adding an action means
 * adding a capability here; there is no "misc" or catch-all value.
 *
 * Naming is `<domain>:<operation>`. Read capabilities are included so that
 * every guarded action states its requirement in the same vocabulary, and
 * so a future decision to restrict a read is a one-line matrix change
 * rather than a new mechanism.
 */
export type Capability =
  // --- Reads -------------------------------------------------------------
  /** Mint a short-lived signed URL to view one Evidence file. */
  | "evidence:read"
  /** Read an Application's Requirement Slots + Evidence. */
  | "requirement:read"
  /** Read the global Document Evidence workspace. */
  | "document_workspace:read"

  // --- Self-scoped -------------------------------------------------------
  /**
   * Advance the caller's OWN chat read cursor. Self-scoped session state,
   * never another user's — held to the same carve-out as locale selection
   * and the authentication actions, and therefore granted to every role
   * including `consulta`. It writes nothing another user can observe and
   * withholding it would only strand read-only users under permanently
   * unread conversations.
   */
  | "chat:mark_read"

  // --- Client operations -------------------------------------------------
  | "client:create"
  | "client:update"
  /** Administrative client status change — separate from profile editing. */
  | "client:set_status"

  // --- Application operations --------------------------------------------
  /**
   * Originate a new Application for a Client against a Product (Milestone
   * 17). DELIBERATELY SEPARATE from `application:set_status` and granted
   * MORE widely: registering what a client is asking for is ordinary
   * client-facing intake work, which is why `asesor` holds it, while
   * moving that request toward `approved` / `not_eligible` is the lending
   * determination and stays with administrador/gerente. `analista` holds
   * neither, consistent with holding no client mutation at all — the
   * analyst evaluates an application, they do not originate one.
   *
   * Creating a Client inside the same flow is NOT covered by this
   * capability: it independently requires `client:create`, so a holder of
   * this capability alone may file an application for an existing client
   * but may not invent a new one.
   */
  | "application:create"
  /**
   * Move an Application through its lifecycle. NOTE: today this single
   * capability necessarily includes `approved` / `not_eligible`, i.e. the
   * lending determination itself — see APPLICATION_STATUS_TRANSITIONABLE in
   * src/lib/config/application.ts. It is granted accordingly narrowly; see
   * the Milestone 16 report's ambiguity notes.
   */
  | "application:set_status"

  // --- Dossier collaboration ---------------------------------------------
  | "note:create"
  | "alert:create"
  /** Resolve or reactivate an existing alert — a supervisory act. */
  | "alert:set_status"

  // --- Requirements & evidence -------------------------------------------
  | "evidence:upload"
  /** Record a factual review of one Evidence item — an analysis act. */
  | "evidence:review"
  /**
   * Staff completion judgment on a Requirement Slot (satisfied / rejected /
   * waived / re-submission). Independent of evidence:review — see the
   * doc comments on both underlying actions; neither implies the other.
   */
  | "requirement_slot:set_status"

  // --- Internal chat -----------------------------------------------------
  | "chat:send"
  | "chat:retry_translation"

  // --- Staff administration ----------------------------------------------
  /**
   * Invite a staff member, change their role, and deactivate/reactivate
   * them (Milestone 21). ADMINISTRADOR-ONLY, and deliberately a single
   * capability rather than three: invite / role / active would all be
   * granted to exactly the same one role, so splitting them would be three
   * names for one grant. Mirrors `product:manage` and
   * `requirement_template:manage`, the existing single-role configuration
   * capabilities.
   *
   * `gerente` does NOT hold it despite holding every operational
   * capability — the Milestone 16 boundary is operations vs. configuration,
   * and administering who may act at all is further from operations than
   * either product or template management. It is also the one capability
   * whose holder can grant itself anything else.
   *
   * There is deliberately no user:delete. Milestone 21's approved policy is
   * deactivate-only; see the migration header.
   */
  | "user:manage"

  // --- System configuration ----------------------------------------------
  /** Create/edit/reorder//status Products. Administrator-only in Milestone 16. */
  | "product:manage"
  /** Create/edit/reorder/status Requirement Templates. Administrator-only in Milestone 16. */
  | "requirement_template:manage";

/**
 * Capabilities every authenticated, active profile holds regardless of role
 * — the read + self-scoped floor. Spelled out once and spread into each
 * role below rather than special-cased in the helper, so that revoking a
 * read from a role later is still a single, visible edit to that role's row.
 */
const BASELINE: Capability[] = [
  "evidence:read",
  "requirement:read",
  "document_workspace:read",
  "chat:mark_read",
];

/** Chat participation — everything except the strictly read-only role. */
const CHAT: Capability[] = ["chat:send", "chat:retry_translation"];

/**
 * The canonical role → capability matrix.
 *
 * Least-privilege is the tie-breaker throughout: where the Milestone 16
 * brief did not explicitly grant a capability to a role, it is NOT granted,
 * even where a broader reading would have been defensible. Every such
 * decision is enumerated in the Milestone 16 report rather than silently
 * widened here.
 *
 * `satisfies` (not `:`) so TypeScript still checks the shape while keeping
 * the literal capability arrays narrow enough to be useful to readers.
 */
export const ROLE_CAPABILITIES = {
  /**
   * Full CRM access — the only role holding system configuration, and (as
   * of Milestone 21) the only role holding staff administration.
   */
  administrador: [
    ...BASELINE,
    ...CHAT,
    "client:create",
    "client:update",
    "client:set_status",
    "application:create",
    "application:set_status",
    "note:create",
    "alert:create",
    "alert:set_status",
    "evidence:upload",
    "evidence:review",
    "requirement_slot:set_status",
    "product:manage",
    "requirement_template:manage",
    "user:manage",
  ],

  /**
   * Full day-to-day operational management and supervision across the CRM.
   * Holds every operational capability — including the supervisory ones
   * (alert:set_status, client:set_status, application:set_status) that no
   * other non-administrator role holds — but NO system configuration:
   * Product and Requirement Template mutation stays administrator-only in
   * Milestone 16.
   */
  gerente: [
    ...BASELINE,
    ...CHAT,
    "client:create",
    "client:update",
    "client:set_status",
    "application:create",
    "application:set_status",
    "note:create",
    "alert:create",
    "alert:set_status",
    "evidence:upload",
    "evidence:review",
    "requirement_slot:set_status",
  ],

  /**
   * Operational review / evaluation. Reads everything, and holds the two
   * analysis-judgment capabilities (evidence:review, requirement_slot:
   * set_status) plus evaluation note/alert authoring. Deliberately holds
   * NO client mutation, NO application origination (`application:create`,
   * Milestone 17 — an analyst evaluates applications, they do not file
   * them, consistent with holding no `client:create`) and NO application
   * status authority: the brief
   * grants analysts read access to clients and applications only, and
   * broad managerial powers are not granted merely because the schema
   * currently lacks finer ownership rules. Future preliminary-analysis and
   * human-review capabilities (Milestone 15E's application_analysis review
   * path, once it has a Server Action) belong to this role.
   */
  analista: [
    ...BASELINE,
    ...CHAT,
    "note:create",
    "alert:create",
    "evidence:review",
    "requirement_slot:set_status",
  ],

  /**
   * Normal client-facing advisory work: owns the client record, ORIGINATES
   * applications (Milestone 16 granted nothing here; `application:create`
   * was added in Milestone 17), and owns the intake side of the document
   * workflow. Deliberately holds NO analysis-specific review or override
   * capability (evidence:review, requirement_slot:set_status) — those are
   * the analyst's judgment, not the advisor's — no `application:set_status`
   * (filing a request is not deciding it) and no system configuration.
   */
  asesor: [
    ...BASELINE,
    ...CHAT,
    "client:create",
    "client:update",
    "application:create",
    "note:create",
    "alert:create",
    "evidence:upload",
  ],

  /**
   * Strictly read-only. Holds the baseline reads and its own chat read
   * cursor, and NOTHING else — zero business mutations, enforced
   * server-side by requireCapability(), not by hidden buttons.
   */
  consulta: [...BASELINE],
} satisfies Record<UserRole, Capability[]>;

/**
 * The single predicate every authorization decision in this app resolves
 * to — server enforcement and UI affordances alike.
 *
 * Fails closed on an unrecognized role: a `profiles.role` value outside the
 * five canonical ones (only reachable today via direct database edit, and
 * blocked at the database level by profiles_role_check as of Milestone 16)
 * yields NO capabilities rather than defaulting to a permissive baseline.
 */
export function hasCapability(role: UserRole, capability: Capability): boolean {
  const granted = ROLE_CAPABILITIES[role] as readonly Capability[] | undefined;
  return granted?.includes(capability) ?? false;
}
