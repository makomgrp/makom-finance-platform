# Audit trail architecture — required before real operational use

This document records a **blocking requirement**, not a plan under way.
Nothing described under "Required architecture" below is created, migrated,
or configured. It is written down so the gap is not rediscovered later, and
so the decision to defer it stays a deliberate, dated one.

> **REQUIREMENT:** a general append-only CRM audit/event model
> (pre-flight "Option 3") is **REQUIRED BEFORE ODL FINANCIAL GOES INTO REAL
> OPERATIONAL USE.** Recorded as part of Milestone 19. Deliberately **not**
> implemented in Milestone 19.

## Why this exists

Milestone 19 restored the Dossier's Activity tab on genuinely persisted
records (`src/lib/activity/build-client-activity-feed.ts`). Building it
surfaced a limitation the schema has carried since the beginning.

## What the schema records today

**Complete history** — every occurrence is its own row and stays available:

| Event | Source |
| --- | --- |
| Application created | `applications.created_at` + `created_by_profile_id` |
| Note written | `dossier_notes` (append-only; `createNote` is the only mutation) |
| Alert raised | `dossier_alerts.created_at` + `created_by_profile_id` |
| Evidence uploaded / replaced | `dossier_documents` — one row per upload; `replaces_evidence_id` preserves the supersession chain |
| Evidence reviewed | `dossier_documents.reviewed_at` — one-shot, guarded by `ALREADY_REVIEWED` |
| Client created | `clients.created_at` + `created_by_profile_id` |

**Latest recorded state only** — a single set of columns, overwritten on
every change, so earlier transitions are **permanently lost**:

| State | Columns |
| --- | --- |
| Application status | `applications.status` / `status_changed_at` / `status_changed_by_profile_id` / `status_changed_source` |
| Requirement slot status | `requirement_slots.status` / `status_changed_at` / `status_changed_by_profile_id` / `status_changed_source` |
| Alert resolution | `dossier_alerts.resolved_at` / `resolved_by_profile_id` — **cleared on reactivation**, so it describes the current episode only |

An application that moved `new → in_review → approved` retains only the
`→ approved` write. There is **no history table and no trigger anywhere in
the schema**.

## Consequences accepted in Milestone 19

- The Activity feed labels the three state fields above as the **current
  recorded state** ("estado actual" / "current status"), never as a
  transition. It must never be reworded to "changed from X to Y" until the
  database can prove the X.
- Several genuine business questions are unanswerable today: how long an
  application sat in review, who moved it through each stage, how often a
  requirement was rejected before being satisfied, whether an alert was
  resolved and reopened.
- Reporting on cycle time, rejection reasons, or advisor throughput is
  blocked on this — which is why `/reportes` was deleted in Milestone 18
  rather than re-sourced.

## The irreversibility that makes this urgent

**Existing history cannot be backfilled.** It was never written. An audit
table shipped today and one shipped in six months contain exactly the same
history: everything from their ship date forward, and nothing before it.

Deferring therefore has a continuous, non-recoverable cost. While the system
holds a development dataset that cost is negligible. **From the first day ODL
works real client files, every untracked transition is lost permanently.**

## Required architecture (sketch — not implemented)

An append-only table, written by the service layer alongside each mutation:

```
crm_events
  id                 uuid primary key
  event_type         text not null        -- closed vocabulary, CHECK-constrained
  client_id          uuid references clients(id)
  application_id     uuid references applications(id)
  subject_table      text                 -- e.g. 'requirement_slots'
  subject_id         uuid
  previous_value     jsonb                -- the transition's FROM side
  new_value          jsonb                -- the transition's TO side
  actor_profile_id   uuid references profiles(id)
  actor_source       text not null        -- crm_manual | website_form | whatsapp | email | ai
  occurred_at        timestamptz not null default now()
```

No updates, no deletes — the same posture `automation_events` already takes.

### Known implementation hazards

1. **~10 mutation sites** would need to append: `createSolicitudApplication`,
   `setSolicitudApplicationStatus`, `createDossierNote`, `createDossierAlert`,
   `setDossierAlertStatus`, `uploadRequirementEvidence`,
   `reviewRequirementEvidence`, `setDossierRequirementSlotStatus`,
   `createClientAction`, `setClientStatusAction`.
2. **No multi-statement transaction** is available through supabase-js, so
   each append risks the same partial-write problem `createApplication`
   already documents. A `SECURITY DEFINER` RPC per mutation — the pattern
   `create_application_analysis_snapshot` established — or a database trigger
   are the two ways to make the mutation and its event atomic.
3. Writing events from **triggers** would capture automated and manual paths
   uniformly and cannot be forgotten by a new Server Action, at the cost of
   moving business meaning into the database.

Whichever route is chosen, it should land as its own milestone with its own
pre-flight, not as an addition to a UI milestone.
