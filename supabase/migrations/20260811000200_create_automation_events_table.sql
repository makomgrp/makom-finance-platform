-- ============================================================================
-- automation_events
-- ============================================================================
--
-- Purpose: the append-only audit trail for every automated action this
-- system takes (Milestone 15B — see the Milestone 15A architecture
-- review's "Automation Audit Trail Design" section: "any automated
-- action must be explainable"). Nothing existing could be reused for
-- this — src/types/activity-event.ts's ActivityEvent (the Dossier
-- Activity tab) is explicitly client-side, in-memory, never persisted,
-- and was never a candidate; this is a genuinely new concern.
--
-- Foundation only, matching this milestone's scope: only the five event
-- types the Application Intake pipeline itself produces are enabled
-- below (see automation_events_event_type_check) — no Task Engine event
-- types, no Notification event types, no Document-analysis event types.
-- Widening the vocabulary as later milestones need to is a single DROP
-- CONSTRAINT + ADD CONSTRAINT, the same pattern this schema already uses
-- everywhere a closed vocabulary needs to grow.
--
-- APPEND-ONLY BY DESIGN: this table's grants (below) are select + insert
-- only. There is no updateAutomationEvent or deleteAutomationEvent
-- anywhere in this codebase, and none should ever be added — an audit
-- fact that could be edited or removed after the fact would not be
-- trustworthy as one, the exact same principle already applied to
-- dossier_documents.reviewed_at (see document-evidence.ts's own doc
-- comment: "an immutable audit fact, not a status").
--
-- task_id is deliberately a bare uuid column with NO foreign key
-- constraint — the Task Engine does not exist yet (a future milestone's
-- explicit scope, not this one). Adding the FK now would either force
-- inventing a `tasks` table ahead of its own milestone or leave a
-- forward-reference this migration has no business making. The column
-- exists so a future Task Engine migration can add the constraint
-- retroactively (`alter table ... add constraint ... foreign key
-- (task_id) references tasks(id)`) without needing a second migration to
-- add the column itself.

create table if not exists public.automation_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null,
  intake_id uuid references public.application_intakes(id) on delete restrict,
  client_id uuid references public.clients(id) on delete restrict,
  application_id uuid references public.applications(id) on delete restrict,
  task_id uuid,
  payload jsonb not null default '{}'::jsonb,
  actor text not null,
  created_at timestamptz not null default now()
);

comment on table public.automation_events is
  'Append-only audit trail for every automated action the system takes '
  '(Milestone 15B — see the Milestone 15A architecture review). Every '
  'row is a fact about something that already happened; nothing here is '
  'ever updated or deleted. Foundation-scoped: only the five event types '
  'the Application Intake pipeline produces are enabled today (see '
  'automation_events_event_type_check) — future milestones (Task Engine, '
  'Notifications, Document Analysis) will widen this vocabulary '
  'additively, the same way this schema always widens closed '
  'vocabularies.';
comment on column public.automation_events.task_id is
  'Deliberately no foreign key yet — the Task Engine does not exist as '
  'of Milestone 15B. The column exists so a future migration can add '
  'the constraint without a second migration to add the column itself. '
  'Not populated by anything in this milestone.';
comment on column public.automation_events.payload is
  'Event-specific structured detail. Same raw_payload security '
  'discipline as application_intakes.raw_payload: MUST NEVER contain '
  'secrets, API keys, webhook signatures, or authorization headers.';
comment on column public.automation_events.actor is
  '''system'' for every event this milestone''s automated pipeline '
  'writes. Free text rather than a profiles.id foreign key: a future '
  'manual-reprocessing action may eventually identify a real profile '
  'here, but designing that is explicitly out of scope for Milestone '
  '15B (see the Milestone 15B brief''s Actor Model section) — kept as '
  'plain text now rather than a constraint this milestone would have to '
  'guess the right shape for.';

-- Restricts event_type to exactly the five values Milestone 15B's
-- Application Intake pipeline produces.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'automation_events_event_type_check'
      and conrelid = 'public.automation_events'::regclass
  ) then
    alter table public.automation_events
      add constraint automation_events_event_type_check
      check (event_type in (
        'intake_received',
        'client_matched',
        'client_created',
        'application_created',
        'intake_needs_review'
      ));
  end if;
end $$;

-- The real query shapes: "every event for this intake" (reconstructing
-- exactly what the pipeline did for one submission — the primary
-- audit-trail use case), "every event for this application," and a
-- chronological feed. client_id is deliberately not indexed here in this
-- milestone: nothing in 15B queries automation_events by client_id alone
-- (a future Dossier "automation history" surface, if built, is exactly
-- the kind of addition that would justify one then — see the Milestone
-- 15A architecture review's Internal Chat / Dossier linkage discussion
-- for the closest analogous future surface).
create index if not exists automation_events_intake_id_idx
  on public.automation_events (intake_id);

create index if not exists automation_events_application_id_idx
  on public.automation_events (application_id);

create index if not exists automation_events_created_at_idx
  on public.automation_events (created_at desc);

-- ============================================================================
-- Row Level Security
-- ============================================================================

-- Enabled with zero policies, same posture as every other real table in
-- this schema: fully locked to both `anon` and `authenticated` until a
-- real permissions model exists. Reads/writes go through the server-only
-- Supabase client exclusively.
alter table public.automation_events enable row level security;

-- ============================================================================
-- service_role grants
-- ============================================================================

-- Select + insert ONLY — no update, no delete. This is the strictest
-- grant posture in this schema so far (every other table at minimum
-- allows update for a status/lifecycle column this table doesn't have):
-- an append-only audit trail has no legitimate mutation path at all, by
-- design, not by omission.
grant select, insert on public.automation_events to service_role;
