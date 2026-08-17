import type { Locale } from "@/i18n/config";
import type {
  ActivityFeedItem,
  ActivityType,
  ApplicationListItem,
  Client,
  DocumentEvidence,
  DossierAlert,
  InternalNote,
  RequirementSlot,
} from "@/types";

/**
 * ============================================================================
 * THE DOSSIER ACTIVITY FEED — PURE, AND HONEST BY CONSTRUCTION
 * ============================================================================
 *
 * Milestone 19. This module is deliberately NOT a service: it performs no
 * I/O, issues no Supabase query, calls no Server Action, and writes nothing.
 * It is a pure function over records the Dossier page has ALREADY loaded
 * (src/app/(app)/expedientes/[id]/page.tsx fetches the client, its
 * applications, notes, alerts, requirement slots and evidence regardless of
 * which tab is open), so restoring Activity costs the dossier ZERO
 * additional database round-trips.
 *
 * WHY PURE MATTERS HERE, beyond performance: a feed that cannot query cannot
 * quietly acquire a source that is not already proven and loaded, and it is
 * trivially testable by passing records in.
 *
 * ----------------------------------------------------------------------------
 * THE ONE RULE: EVERY EMITTED ITEM MAPS 1:1 TO A PERSISTED ROW OR COLUMN
 * ----------------------------------------------------------------------------
 * Milestone 18 deleted the previous Activity tab because it invented history.
 * Nothing here is inferred, reconstructed, back-dated or defaulted. If the
 * database does not carry a timestamp, the event is not emitted — full stop.
 * That is why several plausible events are absent; see the "deliberately
 * absent" list in src/types/activity-event.ts.
 *
 * TWO KINDS OF TRUTH, KEPT DISTINCT:
 *
 *   COMPLETE HISTORY — every occurrence is its own row and stays available:
 *     solicitud_iniciada, nota_agregada, alerta_registrada,
 *     documento_recibido / _reemplazado / _verificado, cliente_creado.
 *
 *   LATEST RECORDED STATE ONLY — the schema keeps a single overwritten set of
 *   columns, so earlier transitions are gone forever and CANNOT be recovered:
 *     estado_modificado        (applications.status_changed_*)
 *     requisito_actualizado    (requirement_slots.status_changed_*)
 *     alerta_resuelta          (dossier_alerts.resolved_* — cleared on
 *                               reactivation, so it describes the CURRENT
 *                               episode, not every resolution)
 *
 *   The i18n strings for the second group say "estado actual" / "current
 *   status" precisely because of this. Never reword them into "changed from
 *   X to Y": the database cannot prove the X. A general append-only audit
 *   model is required before ODL goes into real operational use — see the
 *   Milestone 19 audit; it is explicitly NOT part of this milestone.
 *
 * SEEDED FIXTURES: `cliente_creado` is emitted ONLY when
 * `createdByProfileId` is present. All 17 clients seeded into the current
 * database share one identical `created_at` (the moment the seed script ran)
 * and have no creator, so including them would assert that ODL's entire
 * client book was created in the same second by nobody. The rule states
 * honestly: we show client creation when we know who did it. Clients created
 * through the CRM from now on qualify automatically. No row is filtered on
 * the basis of being "test data", and nothing is mutated or deleted.
 */

export interface ClientActivityFeedInput {
  client: Client;
  /** This client's applications only — the page has already filtered. */
  applications: ApplicationListItem[];
  notes: InternalNote[];
  alerts: DossierAlert[];
  /** Requirement slots and evidence, keyed by application id. */
  requirementsByApplicationId: Record<
    string,
    { requirementSlots: RequirementSlot[]; evidence: DocumentEvidence[] }
  >;
  /** Resolves LocalizedText columns (today: requirement slot names). */
  locale: Locale;
}

/**
 * Ordering must be identical on every render — the list is a React list and
 * a server/client boundary. Primary key is the real timestamp, descending.
 * The two tie-breakers exist because timestamps genuinely collide: an
 * application and its Requirement Slots are written within the same
 * operation, and all seeded rows of a kind often share one instant. Sorting
 * by type then id makes those groups deterministic rather than
 * dependent on however the arrays happened to arrive.
 */
function compareItems(a: ActivityFeedItem, b: ActivityFeedItem): number {
  const byTime = Date.parse(b.at) - Date.parse(a.at);
  if (byTime !== 0) return byTime;
  if (a.type !== b.type) return a.type < b.type ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Guards every push: a source row missing its timestamp yields no event
 * rather than an event with a fabricated or empty date. */
function push(
  items: ActivityFeedItem[],
  id: string,
  type: ActivityType,
  at: string | undefined,
  rest: Omit<ActivityFeedItem, "id" | "type" | "at"> = {}
): void {
  if (!at) return;
  items.push({ id, type, at, ...rest });
}

export function buildClientActivityFeed(input: ClientActivityFeedInput): ActivityFeedItem[] {
  const { client, applications, notes, alerts, requirementsByApplicationId, locale } = input;
  const items: ActivityFeedItem[] = [];

  // --- Client -------------------------------------------------------------
  // Attribution is the gate, not the timestamp. See this module's header.
  if (client.createdByProfileId) {
    push(items, `client-created:${client.id}`, "cliente_creado", client.createdAt);
  }

  for (const application of applications) {
    // --- Application creation (complete history) --------------------------
    push(items, `application-created:${application.id}`, "solicitud_iniciada", application.createdAt, {
      actorFullName: application.createdByFullName,
      applicationNumber: application.applicationNumber,
    });

    // --- Application status (LATEST RECORDED STATE ONLY) ------------------
    // statusChangedAt is null exactly while status is still 'new' (enforced
    // by applications_status_new_pair_check), so an untouched application
    // correctly contributes nothing here.
    push(
      items,
      `application-status:${application.id}`,
      "estado_modificado",
      application.statusChangedAt,
      {
        actorFullName: application.statusChangedByFullName,
        applicationNumber: application.applicationNumber,
        code: application.status,
      }
    );

    const requirements = requirementsByApplicationId[application.id];
    if (!requirements) continue;

    const slotNameById = new Map(
      requirements.requirementSlots.map((slot) => [slot.id, slot.name[locale] ?? slot.code])
    );

    // --- Requirement slot status (LATEST RECORDED STATE ONLY) -------------
    // statusChangedAt is null exactly while status is still 'pending'
    // (requirement_slots_status_pending_pair_check), so freshly snapshotted
    // slots correctly contribute nothing.
    for (const slot of requirements.requirementSlots) {
      push(items, `slot-status:${slot.id}`, "requisito_actualizado", slot.statusChangedAt, {
        actorFullName: slot.statusChangedByFullName,
        applicationNumber: application.applicationNumber,
        label: slot.name[locale] ?? slot.code,
        code: slot.status,
      });
    }

    // --- Evidence (complete history: one row per upload) ------------------
    for (const evidence of requirements.evidence) {
      const label = slotNameById.get(evidence.requirementSlotId);

      // replacesEvidenceId is the persisted proof that this upload superseded
      // a specific earlier one — the distinction is recorded, not guessed.
      push(
        items,
        `evidence-uploaded:${evidence.id}`,
        evidence.replacesEvidenceId ? "documento_reemplazado" : "documento_recibido",
        evidence.uploadedAt,
        {
          actorFullName: evidence.uploadedByFullName,
          applicationNumber: application.applicationNumber,
          label,
        }
      );

      // Review is one-shot and never cleared (reviewDocumentEvidence rejects
      // a second attempt with ALREADY_REVIEWED), so reviewedAt is a true
      // historical fact rather than mutable current state.
      push(items, `evidence-reviewed:${evidence.id}`, "documento_verificado", evidence.reviewedAt, {
        actorFullName: evidence.reviewedByFullName,
        applicationNumber: application.applicationNumber,
        label,
      });
    }
  }

  // --- Notes (complete history: append-only, always attributed) -----------
  for (const note of notes) {
    push(items, `note:${note.id}`, "nota_agregada", note.createdAt, {
      actorFullName: note.authorFullName,
      code: note.type,
    });
  }

  // --- Alerts -------------------------------------------------------------
  for (const alert of alerts) {
    // Raised: complete history, created_by_profile_id is NOT NULL.
    push(items, `alert-created:${alert.id}`, "alerta_registrada", alert.createdAt, {
      actorFullName: alert.createdByFullName,
      code: alert.type,
    });

    // Resolved: CURRENT episode only — reactivating an alert clears these
    // columns, so a resolve-then-reopen leaves no trace of the resolution.
    push(items, `alert-resolved:${alert.id}`, "alerta_resuelta", alert.resolvedAt, {
      actorFullName: alert.resolvedByFullName,
      code: alert.type,
    });
  }

  return items.sort(compareItems);
}
