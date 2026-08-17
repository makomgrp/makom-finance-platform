# CRM audit trail architecture

> **STATUS: DEPLOYED to the ODL Supabase project (`eazqlwdfkillcwjpdkhg`).**
> `crm_events`, its constraints and indexes, and all five `SECURITY DEFINER`
> functions are live and verified. The table is **empty** — no backfill, by
> design — so the Dossier Activity feed currently still renders every
> transition through its Milestone 19 derived-latest-state fallback, and will
> switch to durable events per entity as real transitions occur.
>
> The application-side changes are **committed to no branch yet**: they exist
> in the working tree pending Milestone 20 closeout review.

Migrations:

| Version | Name | Purpose |
| --- | --- | --- |
| `20260817095539` | `milestone_20_crm_audit_trail` | the table, indexes, grants and five functions |
| `20260817121502` | `milestone_20a_fix_profile_update_field_array` | corrective: `record_client_profile_update` used `v_fields \|\| 'literal'`, which PostgreSQL resolves as array‖array and rejects with `22P02 malformed array literal`. Replaced with `array_append(v_fields, 'literal')` in all twelve branches. Found by runtime verification; nothing else changed. |

## Why this exists

Several important CRM mutations overwrite their own history:

| State | Columns rewritten on every change |
| --- | --- |
| Application status | `applications.status` / `status_changed_at` / `status_changed_by_profile_id` / `status_changed_source` |
| Requirement slot status | `requirement_slots.status` / `status_changed_at` / `status_changed_by_profile_id` / `status_changed_source` |
| Alert resolution | `dossier_alerts.resolved_at` / `resolved_by_profile_id` — **cleared on reactivation** |
| Client status, restriction, and every editable profile field | `clients.*` — no `updated_at` |

An application that moved `new → in_review → approved` retained only the
`→ approved` write. There was no history table and no trigger anywhere in the
schema. Milestone 19's Activity feed therefore had to describe those states as
the *current recorded state*, never as transitions.

## What `crm_events` is — and what it is not

- **`crm_events`** — durable CRM state history. What happened to a client file,
  and who did it.
- **`automation_events`** — unchanged, and deliberately so. It is intake-pipeline
  telemetry: keyed on `intake_id`, carrying a `task_id` placeholder and a
  free-text `actor` that is always `'system'`. Widening it would have produced a
  table whose name, comment and columns contradicted most of its rows.

### Events that are deliberately NOT recorded

Facts already proven permanently by their own immutable row are **not**
duplicated into `crm_events`: client and application creation, notes, alerts
raised, evidence uploaded / replaced / reviewed, analyses generated / reviewed,
chat messages.

`dossier_notes` has no update path in the entire codebase. A replacement
evidence upload is a new row carrying `replaces_evidence_id`. An evidence review
is one-shot, guarded by `ALREADY_REVIEWED`. Those tables **are** the audit trail
for their own facts, and duplicating them would create a second source of truth
plus double rendering in the Activity feed.

## Atomicity: why SECURITY DEFINER RPCs

The application reaches Postgres through **PostgREST over HTTP** using the
**service-role key**. Two consequences drove the design:

1. Each `supabase-js` call is its own transaction. A service-layer "update, then
   insert the event" is **two** transactions — a failure between them loses the
   very history this table exists to preserve.
2. The service-role JWT carries no human identity; `auth.uid()` is null for every
   CRM write.

Therefore:

- **Triggers were rejected.** A trigger sees `OLD`/`NEW` for free and cannot be
  bypassed, but it **cannot know which human acted**. Every `actor_profile_id`
  would be NULL, defeating accountability. There is also no session in which to
  `SET LOCAL` an actor before a PostgREST request.
- **Dual writes were rejected** for the partial-write reason above.
- **Five `SECURITY DEFINER` functions** perform the business mutation and the
  event append in one PL/pgSQL body — one transaction, committing or failing
  together. The actor arrives as an explicit parameter, resolved by
  `requireCapability()` in the Server Action exactly as for every other write.

This follows an existing precedent: `create_application_analysis_snapshot` and
`review_application_analysis` already do "mutate and append children atomically".

### Where transition legality lives

The functions deliberately do **not** re-encode `APPLICATION_STATUS_TRANSITIONS`
or `REQUIREMENT_SLOT_STATUS_TRANSITIONS` in SQL. Those graphs stay canonical in
`src/lib/config/`. The caller validates legality and passes the status it
believes is current; the function's guarded predicate
(`where status = p_expected_status`) reproduces the services' existing
`.eq("status", currentStatus)` guard, so a concurrent change still matches zero
rows and still returns `INVALID_TRANSITION`. A duplicated matrix would be a
second thing to forget to update.

## Append-only permission strategy

**Stronger than `automation_events` on purpose.** That table grants
`select, insert` to `service_role`, so application code *could* append to it
directly. `crm_events` withholds INSERT:

```
service_role:  SELECT only        (no INSERT, UPDATE, DELETE, TRUNCATE)
anon:          nothing
authenticated: nothing
PUBLIC:        no EXECUTE on any of the five functions
```

A future developer must not be able to write
`supabase.from('crm_events').insert(...)` and bypass the transactional
architecture, because an event appended in a separate HTTP request is exactly
the partial write this design prevents.

**How the functions still insert:** they are `SECURITY DEFINER` and owned by
`postgres`, which owns the table and holds INSERT on it. A `SECURITY DEFINER`
function executes with its owner's privileges, not its caller's. Verified
against this project before writing: `service_role` is not a superuser and holds
no role memberships, so grants bind to it directly; and this project's default
privileges grant new `postgres`-owned tables only `TRUNCATE, REFERENCES,
TRIGGER, MAINTAIN` to `anon`/`authenticated`/`service_role` — never
INSERT/SELECT/UPDATE/DELETE.

There is no `createCrmEvent`, `updateCrmEvent` or `deleteCrmEvent` anywhere in
the codebase, and no Server Action mutates events.

## Privacy rule for `client_profile_updated`

The event records **which fields changed** — `{"fields":["phone","address"]}` —
and **never what they changed from or to**.

This is structural, not stylistic: `crm_events` is append-only with no delete
path, so any personal value copied into it could never be corrected or erased.
Client PII — identification number, e-mail, phone, salary, birth date,
nationality, address, position, employer — must never be written here. The event
answers *who* changed the profile, *when*, and *which fields*. What the values
were is what the `clients` table is for.

The UI surfaces only the **count** of changed fields, so no PII reaches the
Activity feed through this path either.

## Foreign keys: history outlives its subjects

`client_id`, `application_id` and `actor_profile_id` all use
**`ON DELETE SET NULL`**, deliberately diverging from this schema's usual
`RESTRICT`:

- `RESTRICT` would let an audit row **block** deleting a client or profile,
  turning the trail into an operational obstacle and creating pressure to purge
  it.
- `CASCADE` would **destroy** history when an account is removed — the
  anti-pattern Milestone 16 rejected for `profiles.auth_user_id`.
- `SET NULL` keeps the event, its timestamp, type and before/after values
  forever, losing only the live link. `entity_id` carries no FK at all, so it
  still records which row the event was about.

## No backfill

`crm_events` starts **empty** and is never backfilled.

- Overwritten transitions **cannot** be recovered — they were never written.
  Reconstructing them would be fabrication.
- The events that *are* still provable (application creation, notes, alerts
  raised, evidence) already have canonical rows the Activity feed reads
  directly. Copying them in would only duplicate.

History starts at deployment.

## Activity feed integration (hybrid)

The Dossier Activity feed is now a hybrid, with exactly one source per fact:

| Source | Events |
| --- | --- |
| Canonical immutable rows | application created, notes, alerts raised, evidence uploaded/replaced/reviewed, attributed client creation |
| `crm_events` | application status, requirement status, alert resolved/reactivated, client status, client profile edit |

**Dedup rule.** For each `(family, entity)` pair that has at least one
`crm_event`, the Milestone 19 derived latest-state item is **suppressed** and the
durable events are authoritative. An entity with no event yet — every transition
predating deployment — keeps its derived item, still worded "estado actual /
current status". Only audit-backed items say "changed from X to Y", because only
there did the database record both sides.

One additional read, `getClientCrmEvents(clientId)`, joins the dossier's existing
parallel batch. Milestone 19's "zero additional dossier queries" property could
not survive events living in their own table.

## Rollback caveat

While `crm_events` is empty, reversal is clean: drop the five functions, then the
table.

**Once real events exist, dropping this table permanently destroys the only copy
of that history.** After go-live the correct reversal is to stop calling the
functions — never to drop the table.

## What this still does not enable

- Anything before the deployment date — permanently.
- **Rejection reasons.** A `not_eligible` transition records *that* and *who*,
  never *why*; `applications` has no reason column and `crm_events` adds none.
- Advisor productivity: `application_advisor_assigned` and
  `client_restriction_changed` are reserved in the vocabulary but **not written**,
  because `assignApplicationAdvisor` and `setClientRestricted` have no Server
  Action or UI caller today.
- Reporting UI. Milestone 20 makes a future reporting milestone *possible*; it
  does not deliver one.
