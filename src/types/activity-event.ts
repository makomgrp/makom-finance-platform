/**
 * ============================================================================
 * THE DOSSIER ACTIVITY VOCABULARY — ONE ENUM, NOT TWO
 * ============================================================================
 *
 * Milestone 19 rebuilt the Dossier's Activity feed on REAL persisted records.
 * Milestone 18 had removed the previous one because it rendered fabricated
 * fixture events and logged new ones to React state that vanished on reload.
 *
 * This file survived that purge deliberately: it never contained fixture
 * data, only a vocabulary. It is now the single vocabulary the feed uses —
 * each value names one event family, drives its icon
 * (src/lib/config/activity.ts#ACTIVITY_TYPE_ICON) and selects its message
 * (`dossier.activity.events.<type>`). There is intentionally no second,
 * parallel "kind" enum.
 *
 * EVERY VALUE MUST MAP ONE-TO-ONE TO PERSISTED EVIDENCE. A value may only be
 * added here once a row or column in Postgres actually proves the event
 * happened. Deliberately absent, and why:
 *   - client updated        — `clients` has no updated_at column
 *   - advisor assigned      — assigned_advisor_profile_id has no timestamp
 *   - alert reactivated     — reactivation NULLs resolved_at/by, leaving
 *                             nothing to prove it occurred
 *   - analysis generated/reviewed — the analysis engine has no UI or Server
 *                             Action yet, and application_analysis is empty
 *   - automation events     — intake-pipeline telemetry, empty, and would
 *                             double-count solicitud_iniciada
 * See the Milestone 19 pre-flight audit for the full source inventory.
 *
 * `solicitud_aprobada` was RETIRED in Milestone 19: an approval is simply an
 * application whose current recorded status is `approved`, which
 * `estado_modificado` already expresses without implying a transition the
 * database cannot prove.
 */
export type ActivityType =
  // --- Complete history: each occurrence is its own persisted row ---------
  /** A Client was created THROUGH THE CRM (created_by_profile_id present). */
  | "cliente_creado"
  /** An Application row was created. */
  | "solicitud_iniciada"
  /** A note was written. dossier_notes is append-only. */
  | "nota_agregada"
  /** An alert was raised. */
  | "alerta_registrada"
  /** Evidence was uploaded against a Requirement Slot. */
  | "documento_recibido"
  /** Evidence superseded earlier evidence (replaces_evidence_id is set). */
  | "documento_reemplazado"
  /** Evidence was reviewed. One-shot — guarded by ALREADY_REVIEWED. */
  | "documento_verificado"

  // --- Latest recorded state ONLY — see the warning below -----------------
  /**
   * The application's CURRENT recorded status, with the timestamp and actor
   * of the most recent transition. NOT a transition record.
   */
  | "estado_modificado"
  /**
   * A Requirement Slot's CURRENT recorded status. Same limitation.
   */
  | "requisito_actualizado"
  /**
   * The alert's CURRENT resolution episode. `resolved_at`/`resolved_by` are
   * cleared when an alert is reactivated, so this is not a permanent record
   * of every resolution.
   */
  | "alerta_resuelta"

  // --- TRUE HISTORY, from the crm_events audit trail (Milestone 20) --------
  // These are the durable counterparts of the three latest-state values
  // above. Because both sides of the transition are permanently recorded,
  // and only because of that, their wording may say "changed FROM x TO y" —
  // which the latest-state variants must never claim. A given entity is
  // rendered through the derived variant OR the durable one, never both;
  // see build-client-activity-feed.ts.
  /** An application status transition, both sides recorded. */
  | "estado_cambiado"
  /** A requirement slot status transition, both sides recorded. */
  | "requisito_cambiado"
  /** An alert was reactivated — invisible without the audit trail, since
   *  reactivation NULLs the columns that proved the prior resolution. */
  | "alerta_reactivada"
  /** A client status transition, both sides recorded. */
  | "cliente_estado_cambiado"
  /** A client profile edit. Records WHICH fields changed and how many —
   *  never the values. See CrmEvent.previousValue. */
  | "cliente_perfil_actualizado";

/**
 * One item in a client's Activity feed, already resolved for display by
 * src/lib/activity/build-client-activity-feed.ts.
 *
 * Replaces the old demo-oriented `ActivityEvent`, which carried a
 * `descriptionKey` pointing at a fixed fixture string plus a demo `userId`.
 * This shape instead carries a SERVER-RESOLVED actor name — the same
 * convention every other list type in this codebase uses (authorFullName,
 * createdByFullName, clientFullName, assignedAdvisorFullName).
 *
 * NOTHING HERE IS INFERRED. Every field is copied from a persisted row.
 */
export interface ActivityFeedItem {
  /**
   * Deterministic and derived from the source row (e.g. `note:<uuid>`) —
   * never random, never index-based, so repeated renders and the React key
   * are both stable.
   */
  id: string;
  type: ActivityType;
  /** The persisted timestamp this event actually carries. */
  at: string;
  /**
   * Resolved actor name, present only when the database recorded one.
   * Undefined means "not recorded" — the UI omits the actor line entirely
   * rather than inventing "Unknown"/"Desconocido".
   */
  actorFullName?: string;
  /** Present for application-scoped events. */
  applicationNumber?: string;
  /**
   * Already locale-resolved display text taken from a LocalizedText column
   * (today: the Requirement Slot name).
   */
  label?: string;
  /**
   * A RAW canonical vocabulary value — an application status, requirement
   * slot status, note type or alert type. Kept raw so the UI resolves it
   * through the existing `statuses.*` catalogues instead of this module
   * duplicating them.
   */
  code?: string;
  /**
   * The RAW value this transition moved AWAY from. Present only on the
   * audit-trail-backed types, where the database genuinely recorded both
   * sides. Never set for a latest-state item — there is nothing to set it
   * from.
   */
  previousCode?: string;
  /** Number of changed fields on `cliente_perfil_actualizado`. */
  count?: number;
}
