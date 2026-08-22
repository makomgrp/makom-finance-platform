-- ============================================================================
-- MILESTONE 26B-6 — WHAT ODL IS DOING ABOUT THIS CUSTOMER
-- ============================================================================
--
-- The portal pipeline answers "how far has the customer got?". Nothing yet
-- answers "what has ODL actually DONE about them?" — who called, when, what
-- happened, and what someone promised to do next. Capturing a lead at Step 1 is
-- only worth anything if a person can then work it.
--
-- ----------------------------------------------------------------------------
-- WHY A NEW TABLE, AFTER CHECKING THE THREE THAT ALREADY EXIST
-- ----------------------------------------------------------------------------
--   * dossier_notes — client-scoped free text (type general | seguimiento).
--     No contact method, no outcome, no schedule, no completion, and no link
--     to the process it concerns. A note saying "called him" cannot be asked
--     "who is overdue?".
--   * dossier_alerts — a CUSTOMER RISK register: posible_fraude,
--     incumplimiento_previo, restriccion_interna, with severity levels. Putting
--     "call Juan back on Tuesday" in there would conflate a staff to-do with a
--     statement that something is wrong with the customer. Deliberately left
--     alone.
--   * crm_events — append-only audit of things that already happened. It
--     cannot hold a FUTURE commitment, which is most of the point here.
--
-- So this is a fourth, narrow thing: a durable record of one contact attempt
-- and, optionally, the next one someone committed to.
--
-- ----------------------------------------------------------------------------
-- ATTACHED TO THE PROCESS, NOT THE PERSON
-- ----------------------------------------------------------------------------
-- application_id, because a customer who comes back for a second loan next year
-- starts a new process with its own owner and its own follow-up history. The
-- client's history is still reachable by joining through applications — one
-- fact stored once, rather than a client_id that could drift.
--
-- The same choice gives continuity for free: 26B-5 PROMOTES the draft row on
-- submission rather than creating a new one, so every follow-up, and the
-- assigned advisor beside them, survive the moment the application becomes
-- formal. Nothing needs to be migrated across at submit because nothing moves.
--
-- ----------------------------------------------------------------------------
-- NOTHING HERE SENDS ANYTHING
-- ----------------------------------------------------------------------------
-- This records what a human already did by phone, WhatsApp or email. No
-- messaging, no reminders, no scheduling engine. It is the data a later
-- milestone's automation can read — deliberately built before, and separately
-- from, anything that acts on it.
create table if not exists public.application_follow_ups (
  id uuid primary key default gen_random_uuid(),

  -- ON DELETE RESTRICT, like every other operational relationship in this
  -- schema: contact history is evidence of what ODL did and must not disappear
  -- because something upstream was removed.
  application_id uuid not null
    references public.applications (id) on delete restrict,

  -- Who did the work. NOT NULL: an unattributable follow-up cannot be followed
  -- up on, and "who" is half of what makes this auditable.
  author_profile_id uuid not null
    references public.profiles (id) on delete restrict,

  -- When the CONTACT happened, which is not the same as when it was typed in.
  -- Defaults to now() for the common case of logging it immediately.
  contacted_at timestamptz not null default now(),

  contact_method text not null
    check (contact_method in ('call', 'whatsapp', 'email', 'other')),

  -- OUTCOMES, NOT PIPELINE STAGES. These say what happened on the phone. They
  -- are deliberately few, and deliberately incapable of moving the customer's
  -- portal progress — only the customer's own actions do that.
  outcome text not null
    check (outcome in (
      'contacted',
      'no_answer',
      'customer_responded',
      'waiting_customer',
      'follow_up_scheduled',
      'other'
    )),

  note text,

  -- The commitment. Both halves or neither: an action with no date cannot
  -- become due, and a date with no action says nothing to whoever reads it.
  next_action text,
  next_action_at timestamptz,

  -- Completion, and who did it. Only meaningful for a row that promised
  -- something in the first place.
  completed_at timestamptz,
  completed_by_profile_id uuid references public.profiles (id) on delete restrict,

  created_at timestamptz not null default now(),

  constraint application_follow_ups_next_action_pair_check
    check ((next_action is null) = (next_action_at is null)),

  constraint application_follow_ups_completion_pair_check
    check ((completed_at is null) = (completed_by_profile_id is null)),

  -- Nothing can be completed that was never promised.
  constraint application_follow_ups_completion_requires_action_check
    check (completed_at is null or next_action is not null),

  -- "Otro" on its own records nothing anyone can act on later, so that one
  -- outcome has to say what it was. Every other outcome is self-describing
  -- ("no answer" needs no essay), so a note stays optional there.
  constraint application_follow_ups_other_needs_note_check
    check (outcome <> 'other' or (note is not null and length(btrim(note)) > 0))
);

comment on table public.application_follow_ups is
  'MILESTONE 26B-6. One recorded staff contact attempt on one loan process, and '
  'optionally the next action someone committed to. Scoped to the application '
  'so it survives draft -> formal promotion unchanged. Records outward contact '
  'that already happened; sends nothing.';

comment on column public.application_follow_ups.next_action_at is
  'When the promised action is due. Overdue and due-today are DERIVED from this '
  'against the reader''s clock, never stored — a stored flag would be wrong '
  'from the moment it was written.';

-- The two questions the board asks constantly: "what is this process''s latest
-- contact?" and "what is still outstanding?".
create index if not exists application_follow_ups_application_contacted_idx
  on public.application_follow_ups (application_id, contacted_at desc);

-- Partial: only rows that still owe something. The work queue is small even
-- when the history is large.
create index if not exists application_follow_ups_pending_action_idx
  on public.application_follow_ups (next_action_at)
  where next_action_at is not null and completed_at is null;

-- Same posture as every other operational table: RLS on with NO policies, so
-- nothing is reachable except through server code holding service_role. Branch
-- scope is enforced in the services by joining to the owning application, which
-- is where branch actually lives.
alter table public.application_follow_ups enable row level security;

revoke all on table public.application_follow_ups from public;
revoke all on table public.application_follow_ups from anon;
revoke all on table public.application_follow_ups from authenticated;

-- UPDATE is granted because completing an action mutates the row that promised
-- it. DELETE is deliberately withheld: contact history is not editable away.
grant select, insert, update on table public.application_follow_ups to service_role;
