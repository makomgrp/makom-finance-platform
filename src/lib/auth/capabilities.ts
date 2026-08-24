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
 * DELIBERATELY NOT A NUMERIC ROLE LEVEL. `gerente`, `compliance` and `asesor`
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
  /**
   * Restrict or unrestrict a client — the compliance/risk flag (Milestone
   * 23). DELIBERATELY SEPARATE from `client:set_status` even though both are
   * held by the same two roles today, because they are separate facts about a
   * client and the schema says so: `clients.status` and `clients.restricted`
   * are an intentional split (a restricted client may still be `activo`), and
   * restricting is not a lifecycle transition.
   *
   * Folding this into client:set_status would mean the capability that lets
   * someone mark a prospect `inactivo` also lets them flag that person as a
   * compliance risk. Those should be separable, and keeping them separate
   * costs one line here and nothing anywhere else.
   */
  | "client:set_restriction"

  // --- Application operations --------------------------------------------
  /**
   * Originate a new Application for a Client against a Product (Milestone
   * 17). DELIBERATELY SEPARATE from `application:set_status` and granted
   * MORE widely: registering what a client is asking for is ordinary
   * client-facing intake work, which is why `asesor` holds it, while
   * moving that request toward `approved` / `not_eligible` is the lending
   * determination and stays with administrador/gerente. `compliance` holds
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
  /**
   * Assign, reassign or unassign the advisor who owns an application
   * (Milestone 23). Made reachable by Milestone 23 — the service function had
   * existed since Milestone 13B with no Server Action and no UI, so ODL could
   * not actually put a file in an advisor's hands.
   *
   * NOT `application:set_status`, deliberately, despite the two being held by
   * the same roles today. That capability is the LENDING DETERMINATION — it
   * includes `approved` and `not_eligible` — and is held at the level its most
   * consequential target demands. Deciding who WORKS a file is workload
   * management, not a credit decision, and the two must be able to move apart:
   * when application:set_status is eventually split by target status (see its
   * own note), assignment must not be dragged along with whichever half keeps
   * the name.
   *
   * NOT granted to `asesor`. An advisor doing client-facing intake may file an
   * application (`application:create`); deciding which advisor owns which file
   * is supervisory, and self-assignment is the same act as assigning anyone
   * else. Held by administrador and gerente, matching every other supervisory
   * capability.
   */
  | "application:assign_advisor"

  /**
   * MILESTONE 26B-19 — decide who a public applicant actually is.
   *
   * The matching engine parks an intake when the identity it was given could
   * belong to an existing client but not confidently enough to act on. Someone
   * then has to look at two sets of details and say "same person" or "not the
   * same person", and that judgement decides whether a stranger is handed
   * access to an existing customer's file. It is an identity decision before it
   * is an operational one.
   *
   * A NEW CAPABILITY RATHER THAN A BORROWED ONE. `client:create` would have
   * been convenient, but it is held by asesor, and the point of parking these is
   * that they are not routine data entry. `evidence:review` reaches the right
   * three roles by accident — it is about documents, and reusing it would mean
   * a later change to document review silently moved who can merge identities.
   * Held by administrador, gerente and compliance: the same three that already
   * carry the compliance review, which is the function this belongs to.
   */
  | "intake:resolve"

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
   * ============================================================================
   * MILESTONE 24 — `user:manage` WAS SPLIT INTO THE FOUR BELOW
   * ============================================================================
   *
   * Milestone 21 shipped a single `user:manage` covering invite, resend, role
   * change and deactivation. That was correct while administrador was the only
   * holder, and became the blocker the moment ODL needed delegation: Damion
   * travels, Randol runs operations, and "let Randol invite a new hire" was
   * inseparable from "let Randol change anyone's role to administrador" and
   * "let Randol deactivate Damion".
   *
   * The split is by CONSEQUENCE, not by button. Invite and resend stay one
   * capability because resend is the documented recovery path for a failed
   * invitation, not a separate authority. Role change and activation are
   * separate because each can remove someone's ability to work, in different
   * ways. Permission management is separate because it is the privilege
   * boundary itself.
   *
   * `user:invite`, `user:set_active` and `user:set_role` are DELEGATABLE — an
   * administrador may grant them to an individual through
   * profile_capability_grants. `user:manage_permissions` is NOT, and the
   * database refuses to store it (profile_capability_grants_capability_check).
   * That single asymmetry is what makes delegation safe: a delegated manager
   * can run staff operations and can never widen anyone's authority, including
   * their own.
   *
   * NOTE ON ROLES: none of the first three is granted to `gerente` BY ROLE.
   * Delegation is deliberately per-user and explicit — being a gerente does not
   * make someone a staff administrator; being trusted by the administrador
   * does. See ROLE_CAPABILITIES below.
   */
  /** Invite a new staff member, and resend a pending invitation. */
  | "user:invite"
  /** Activate or deactivate a staff member — the whole offboarding path. */
  | "user:set_active"
  /** Change another staff member's BASE ROLE. Never one's own (A3), and never
   * to or from administrador unless the actor is themselves an administrador
   * (A1/A2) — both enforced in the database, not only here. */
  | "user:set_role"
  /**
   * Grant or revoke another user's additional per-user capabilities.
   *
   * ADMINISTRADOR-ONLY AND NON-DELEGATABLE. This is the privilege-management
   * boundary the whole milestone rests on. It is withheld from
   * profile_capability_grants by a database CHECK constraint, so it cannot be
   * delegated even by mistake, and grant_staff_capability/
   * revoke_staff_capability additionally hard-code `actor.role =
   * 'administrador'` rather than testing for this capability — a role rule the
   * database can state exactly, and the one guard that must never depend on
   * anything delegable.
   */
  | "user:manage_permissions"
  /**
   * Change another staff member's CRM interface language (Milestone 26B-6C).
   *
   * THE ONE `user:*` CAPABILITY `gerente` HOLDS BY ROLE, and the note above
   * about delegation is the reason it is not a contradiction. The first four
   * are withheld from gerente because they are STAFF ADMINISTRATION: who may
   * enter the CRM, as what, holding which powers. This one grants no access,
   * revokes none, and cannot escalate anything — it decides which of two
   * translations of the same screens a colleague reads. A supervisor sitting
   * with a new hire who cannot read Spanish should be able to fix that without
   * being made a staff administrator to do it.
   *
   * Scoped like every other staff mutation: the database additionally requires
   * the target to be inside the actor's branch scope
   * (set_staff_preferred_language).
   */
  | "user:set_language"

  // --- Operational mailbox (Milestone 26B-9A) ----------------------------
  /**
   * See the synchronised mailbox, run a sync, and link a message to a
   * customer.
   *
   * ONE CAPABILITY, NOT THREE. Viewing, syncing and linking are three verbs,
   * but in 26B-9A they are one job held by one set of people — splitting them
   * would produce three rows granted to exactly the same two roles, which is a
   * matrix that looks precise and decides nothing.
   *
   * WHY IT IS MANAGEMENT-ONLY. The mailbox contains an UNLINKED queue: mail
   * from prospects who are not yet clients, suppliers, and spam. Those
   * messages have no customer and therefore no branch, so branch scope cannot
   * narrow them for anybody — the only available control is who may open the
   * queue at all. An advisor seeing their own customers' correspondence needs
   * a per-advisor ownership rule that does not exist yet; that is 26B-9B, and
   * inventing it here would mean widening access first and designing the
   * boundary afterwards.
   *
   * LINKED mail is still branch-scoped on top of this: holding the capability
   * does not reveal a client outside the holder's scope.
   */
  | "email:manage"

  // --- Branch administration (Milestone 25A) -----------------------------
  /**
   * ============================================================================
   * MILESTONE 25A — THE THIRD AUTHORIZATION AXIS
   * ============================================================================
   *
   * ODL is becoming a national platform with branches across Panama. That adds
   * a question capabilities alone cannot answer:
   *
   *   ROLE        what kind of work may this person perform?
   *   CAPABILITY  what additional actions may this person perform?
   *   BRANCH SCOPE on WHICH branch's data may they perform them?
   *
   * These stay three independent concepts. A capability is never a branch, and
   * branch reach is never a capability — see branch_scope_mode below.
   *
   * NATIONAL REACH IS NOT IN THIS UNION, DELIBERATELY. `profiles.branch_scope_mode`
   * ('branch' | 'national') is a SCOPE property set only by an administrador. If
   * national access were a capability it would be grantable through
   * profile_capability_grants, which would let branch reach be widened by a
   * mechanism designed for action permissions. The whole point of the split is
   * that delegating an ACTION never delegates DATA SCOPE.
   */
  /**
   * Create a new organizational branch. ADMINISTRADOR-ONLY AND NON-DELEGATABLE.
   *
   * SEPARATE FROM branch:manage FOR A CONCRETE REASON, not for tidiness. A newly
   * created branch has no memberships, so it sits outside every delegated
   * manager's scope. That leaves only two possibilities and both are wrong: if
   * creation auto-assigned the creator, `branch:manage` would become a
   * SCOPE-EXPANSION mechanism (create a branch, be added to it, widen your own
   * reach) — exactly what B6 forbids; and if it did not, a delegated manager
   * would be granted an act with no reachable consequence.
   *
   * The branch list IS ODL's organizational structure. Defining the organization
   * is an ownership act; operating it is a management act — the same line
   * Milestone 24 drew between `user:manage_permissions` and `user:invite`.
   *
   * Excluded from DELEGATABLE_CAPABILITIES and from
   * profile_capability_grants_capability_check, so it cannot be delegated even
   * by mistake. create_branch additionally hard-codes `actor.role =
   * 'administrador'` rather than testing for this capability.
   */
  | "branch:create"
  /**
   * Administer EXISTING branches: edit detail, activate/deactivate, and manage
   * staff branch memberships and primary branch — all strictly inside the
   * actor's own server-resolved branch scope (B1/B2/B6).
   *
   * DELEGATABLE. Damion travels; Randol runs day-to-day operations and must be
   * able to administer the branches he is responsible for WITHOUT becoming an
   * administrador. Granting this confers no additional branch scope: a gerente
   * scoped to {Panamá, David} may administer Panamá and David and nothing else.
   */
  | "branch:manage"
  /**
   * Transfer a client's home branch, and an application's responsible branch.
   * DELEGATABLE, and deliberately NOT held by `gerente` by role: a transfer
   * moves data ACROSS an authorization boundary, which Milestone 24 established
   * should be delegated explicitly per user rather than conferred by job title.
   *
   * The capability is defined in Milestone 25A so the vocabulary is complete and
   * stable; the transfer OPERATIONS themselves ship in 25B alongside the
   * branch-scoped mutation layer they depend on.
   */
  | "branch:transfer"

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
    "client:set_restriction",
    "application:create",
    "application:set_status",
    "application:assign_advisor",
    "intake:resolve",
    "note:create",
    "alert:create",
    "alert:set_status",
    "evidence:upload",
    "evidence:review",
    "requirement_slot:set_status",
    "product:manage",
    "requirement_template:manage",
    "user:invite",
    "user:set_active",
    "user:set_role",
    "user:manage_permissions",
    "user:set_language",
    "email:manage",
    "branch:create",
    "branch:manage",
    "branch:transfer",
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
    "client:set_restriction",
    "application:create",
    "application:set_status",
    "application:assign_advisor",
    "intake:resolve",
    "note:create",
    "alert:create",
    "alert:set_status",
    "evidence:upload",
    "evidence:review",
    "requirement_slot:set_status",
    // See the capability's own note: a display language is not staff
    // administration, which is why this one crosses the line the other
    // `user:*` capabilities deliberately do not.
    "user:set_language",
    // The operational mailbox, including the unscopeable unlinked queue.
    "email:manage",
  ],

  /**
   * Operational review / evaluation. Reads everything, and holds the two
   * analysis-judgment capabilities (evidence:review, requirement_slot:
   * set_status) plus evaluation note/alert authoring. Deliberately holds
   * NO client mutation, NO application origination (`application:create`,
   * Milestone 17 — an analyst evaluates applications, they do not file
   * them, consistent with holding no `client:create`) and NO application
   * status authority: the brief
   * grants this role read access to clients and applications only, and
   * broad managerial powers are not granted merely because the schema
   * currently lacks finer ownership rules. Future preliminary-analysis and
   * human-review capabilities (Milestone 15E's application_analysis review
   * path, once it has a Server Action) belong to this role.
   */
  compliance: [
    ...BASELINE,
    ...CHAT,
    "note:create",
    "alert:create",
    "evidence:review",
    "requirement_slot:set_status",
    "intake:resolve",
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
 * BASE role capabilities only — the role matrix, nothing else.
 *
 * Since Milestone 24 this is NO LONGER the predicate authorization resolves
 * to. It is one INPUT to resolveEffectiveCapabilities() below. Application
 * code must not call it to decide whether an operation is permitted: doing so
 * would ignore every per-user grant and silently re-create the role-only model
 * this milestone replaced. Use requireCapability() (server) or useCapability()
 * (UI), both of which read the resolved effective set.
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

/**
 * ============================================================================
 * MILESTONE 24 — THE DELEGATABLE SET
 * ============================================================================
 *
 * The ONLY capabilities an administrador may grant to an individual on top of
 * their base role. Everything else is reachable exclusively by holding the
 * role that carries it.
 *
 * `user:manage_permissions` and `branch:create` ARE DELIBERATELY ABSENT and
 * must never be added.
 * It is the privilege-management boundary: if it were delegatable, a delegated
 * manager could grant themselves anything, and every other protection in this
 * milestone would be decoration. The database enforces the same exclusion
 * independently via profile_capability_grants_capability_check — this constant
 * is the convenience copy, the CHECK constraint is the guarantee.
 *
 * DELIBERATE DUPLICATION, DOCUMENTED: these three strings also appear in that
 * CHECK constraint. This is the same pattern crm_events_event_type_check
 * already uses for the event vocabulary — a security allow-list is worth
 * stating in both layers, and the friction of a migration to widen it is a
 * feature, not an oversight. It duplicates a LIST OF STRINGS, never
 * ROLE_CAPABILITIES, which remains defined exactly once.
 *
 * `branch:create` is absent for the reason given on that capability: a branch
 * nobody is yet a member of lies outside every delegated manager's scope, so
 * delegating its creation could only ever be useless or an escalation.
 *
 * Business capabilities are absent on purpose. Milestone 24 delegates STAFF
 * ADMINISTRATION, not lending authority; making `application:set_status`
 * delegatable would be a credit-policy decision wearing a permissions costume.
 * Milestone 25A adds BRANCH ADMINISTRATION on the same principle — never
 * branch SCOPE, which is `profiles.branch_scope_mode` and administrador-only.
 */
export const DELEGATABLE_CAPABILITIES = [
  "user:invite",
  "user:set_active",
  "user:set_role",
  // Milestone 25A. Delegating branch ADMINISTRATION never delegates branch
  // SCOPE: a holder acts only inside their own memberships (B1/B6), and
  // `branch:create` is deliberately absent so this can never become a way to
  // manufacture new scope.
  "branch:manage",
  "branch:transfer",
] as const satisfies readonly Capability[];

export type DelegatableCapability = (typeof DELEGATABLE_CAPABILITIES)[number];

/** Type guard for an untrusted string — used at both the Server Action
 * boundary and when reading persisted grants back out of the database. */
export function isDelegatableCapability(value: unknown): value is DelegatableCapability {
  return (
    typeof value === "string" &&
    (DELEGATABLE_CAPABILITIES as readonly string[]).includes(value)
  );
}

/**
 * ============================================================================
 * EFFECTIVE CAPABILITIES — THE ONE PLACE THE UNION HAPPENS
 * ============================================================================
 *
 *   effective = ROLE_CAPABILITIES[role]  UNION  persisted grants for the user
 *
 * ADDITIVE ONLY. There is no deny list, no negative override, no subtraction
 * and no role replacement — deliberately. A three-valued "does deny beat grant,
 * does either beat the role" resolution in the security core would be a
 * permanent source of reasoning errors, for a problem ODL does not have: if a
 * gerente should not be able to do something, do not grant it.
 *
 * PURE. No I/O, no database, no session. It takes a role and a list of strings
 * and returns a set, so it can be exhaustively asserted for every role in the
 * verification gate without a running application.
 *
 * UNKNOWN STRINGS ARE IGNORED, NEVER THROWN ON. A grant row could name a
 * capability that has since been renamed or retired (the database CHECK
 * constraint and this union are maintained in separate migrations). Failing
 * closed on the individual row — dropping it — keeps a stale grant from
 * escalating anything, while failing LOUDLY would take down authorization for
 * a user whose base role is perfectly valid. Non-delegatable strings are
 * filtered out here too, so even a row inserted by some future path that
 * bypassed the CHECK cannot widen authority beyond the delegatable set.
 */
export function resolveEffectiveCapabilities(
  role: UserRole,
  grantedCapabilities: readonly string[]
): Capability[] {
  const base = (ROLE_CAPABILITIES[role] as readonly Capability[] | undefined) ?? [];
  const effective = new Set<Capability>(base);

  for (const granted of grantedCapabilities) {
    // Both filters matter: isDelegatableCapability rejects anything outside the
    // allow-list (including user:manage_permissions), which also makes every
    // survivor a valid Capability.
    if (isDelegatableCapability(granted)) {
      effective.add(granted);
    }
  }

  return [...effective];
}

/**
 * The single predicate every authorization decision in this app resolves to —
 * server enforcement (requireCapability) and UI affordances (useCapability)
 * alike, both reading the SAME server-resolved set off the current Profile.
 *
 * Takes the already-resolved effective set rather than a role, so there is no
 * way to accidentally authorize against base capabilities alone.
 */
export function hasEffectiveCapability(
  capabilities: readonly Capability[],
  capability: Capability
): boolean {
  return capabilities.includes(capability);
}

/**
 * ============================================================================
 * TARGET PROTECTION (A1) — NOT CALLER AUTHORIZATION
 * ============================================================================
 *
 * "May this viewer act on a staff member with THIS role?" — a different
 * question from "may this viewer perform this operation at all", which is what
 * capabilities answer and what requireCapability() enforces.
 *
 * The rule: an administrador may only be modified by an administrador. It is
 * expressed in ROLES rather than capabilities on purpose, because it is about
 * role hierarchy — there is no capability that means "outranks an
 * administrador", and inventing one would be a lie about what is being
 * checked. The database states the identical rule in create_staff_profile,
 * link_staff_profile_auth, update_staff_role and set_staff_active_status.
 *
 * WHY THIS LIVES HERE rather than as an inline `role === "administrador"` in a
 * component: the architectural rule at the top of this file forbids scattering
 * role comparisons through the codebase, and it is right to. One named,
 * documented predicate is greppable, testable and cannot drift; five inline
 * comparisons in five components cannot.
 *
 * UI COURTESY, NOT ENFORCEMENT. Callers use this to avoid rendering a control
 * that the database would refuse. The RPCs remain authoritative — if this
 * function were deleted tomorrow, nothing would become permitted.
 *
 * Mirrors the Milestone 23 discipline exactly: "who may perform an operation"
 * stays separate from "which population may be the target of it".
 */
export function canActOnStaffTarget(viewerRole: UserRole, targetRole: UserRole): boolean {
  if (targetRole !== "administrador") return true;
  return viewerRole === "administrador";
}
