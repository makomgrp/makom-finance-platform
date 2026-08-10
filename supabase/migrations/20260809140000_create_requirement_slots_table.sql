-- ============================================================================
-- requirement_slots
-- ============================================================================
--
-- Purpose: the Requirement Engine's execution layer (Milestone 10B — see
-- the Milestone 10B architecture review and its follow-up critical review,
-- both approved before this migration was written). A Requirement Slot is
-- the per-application INSTANCE of a Requirement Template — "this specific
-- application needs a Salary Letter" — created by copying the template's
-- defining facts at the exact moment an application is created. It is the
-- mechanism that makes editing Requirement Templates safe: 100 existing
-- applications' slots never change when a Product's requirements change
-- tomorrow, because every slot already carries its own frozen copy of what
-- was true when it was made. Only NEW applications, created after the
-- change, see the new requirements.
--
-- Scope (deliberately minimal — see the architecture review's "Recommended
-- Implementation Plan" section):
--   - Database + service only. No Server Actions, no Configuration UI (not
--     applicable to Slots, ever — administrators only ever edit Templates,
--     never Slots directly), no Execution UI (deferred — there is no real
--     per-application dossier view yet for it to live in). A future
--     Execution UI, whenever built, will read and write this exact table
--     through the service this migration backs.
--   - No relationship to Evidence yet. Evidence (the future dossier_
--     documents migration target) will reference requirement_slot_id, not
--     requirement_template_id — because evidence satisfies a specific
--     application's instance of a requirement, never the shared,
--     mutable, product-wide rule directly. That migration is explicitly
--     out of scope here.
--   - No Row Level Security policies yet — same posture as every other
--     real table in this schema: RLS is enabled but left fully locked.
--     Reads/writes go through the server-only Supabase client
--     (src/lib/supabase/server.ts).
--
-- application_legacy_id: a DELIBERATE, TEMPORARY bridge to the existing
-- demo-data application ids (e.g. "ap-001"), following the exact same
-- pattern already used by dossier_notes.client_legacy_id, dossier_alerts.
-- client_legacy_id, and dossier_documents.client_legacy_id /
-- application_legacy_id — the Applications module has no Supabase table
-- yet. This is explicitly NOT meant to be permanent. Per the Milestone 10B
-- critical review: once a real `applications` table exists (Milestone 11),
-- this column should be fully REPLACED — not kept alongside a new
-- application_id — with a real `application_id uuid references
-- applications(id)`. The recommended evolution: add the new nullable
-- column, backfill it from application_legacy_id once Milestone 11
-- establishes the mapping from legacy ids to real application rows,
-- verify complete resolution, promote it to NOT NULL with a proper FK
-- constraint, then DROP application_legacy_id entirely. Keeping both
-- permanently was considered and rejected — it would recreate, in a worse
-- form (no immutability guarantee protects it from drifting), the exact
-- kind of redundant-dual-source-of-truth problem this same review
-- concluded should be avoided for product_id (see below). Not validated at
-- the database level; the creating service/Server Action layer is
-- responsible for validating it against the current demo application list,
-- matching the existing bridge precedent exactly.
--
-- Deliberately does NOT have a product_id column, despite Requirement
-- Template having one. This was the Milestone 10B critical review's first
-- question, and the conclusion reverses the original architecture
-- proposal: requirement_templates.product_id is itself immutable (a
-- template belongs to exactly one product for its entire lifetime, by
-- construction — nothing in this schema allows re-parenting a template to
-- a different product), so the join path
-- requirement_slots.requirement_template_id -> requirement_templates.
-- product_id gives the exact same permanently-correct historical answer a
-- direct copy would, with zero risk of divergence. A direct product_id
-- column here would be a genuine, unprotected redundancy (unlike
-- application_legacy_id above, nothing here needs a temporary bridge — the
-- derivation is exact and permanent), not a historical-correctness
-- safeguard. If product_id is ever needed for reporting convenience, that
-- is a query-time join (requirement_template_id is indexed below), not a
-- standing column.
--
-- What is copied from the owning Requirement Template at creation time,
-- and why each one must be frozen rather than live-referenced: code, name,
-- description, requirement_kind, required, and display_order. Every one of
-- these is copied because a later Template edit (a rename, a description
-- change, marking something optional, deactivating it, reordering it, or
-- — already locked at the Template level, but doubly protected here too —
-- changing its kind) must NEVER retroactively change what an existing
-- application was told it needed. See requirement_slots_requirement_kind_
-- check / requirement_slots_code_format_check / requirement_slots_name_
-- locales_check / requirement_slots_description_locales_check below for
-- the same defense-in-depth CHECK constraints already applied to these
-- same fields on requirement_templates — duplicated here even though every
-- value is copied from an already-validated template row, matching this
-- schema's standing discipline of enforcing invariants at the database
-- level even when the application layer is expected to guarantee them.
--
-- requirement_template_id: kept as a NOT NULL, ON DELETE RESTRICT foreign
-- key purely for traceability and auditing ("which template produced this
-- slot") — never read as a live data source. Both this FK and the copied
-- fields above exist simultaneously because they serve different purposes:
-- the FK is lineage, the copied fields are the source of truth for
-- correctness and display. Templates are never hard-deleted in this
-- schema (only deactivated), so this FK never faces a dangling reference
-- in practice.
--
-- Every copied field, plus requirement_template_id, is immutable forever
-- once a slot is created — there is no update path for any of them. The
-- only thing that legitimately changes over a slot's lifetime is its
-- execution state (status and its audit trio below). If a specific
-- application genuinely doesn't need a requirement despite it being
-- copied as required, the correct mechanism is transitioning status to
-- 'waived' — never mutating the `required` column, which would falsify
-- the historical record of what was actually asked for.
--
-- status: the slot's OWN execution vocabulary — pending, submitted,
-- under_review, satisfied, rejected, waived, missing — completely
-- independent from requirement_templates.status (draft/active/inactive),
-- which is a lifecycle concept, not an execution one. The two must never
-- share a column or vocabulary. See requirement_slots_status_check below.
--
-- status_changed_at / status_changed_by_profile_id / status_changed_
-- source: a three-column audit trio, richer than the simple pair used by
-- products/requirement_templates, because Slot status can legitimately be
-- changed by actors that are not an authenticated CRM profile at all — a
-- future AI process, a website form, or a WhatsApp flow. This mirrors the
-- exact precedent already established by dossier_documents.uploaded_
-- source (crm_manual/website_form/whatsapp), extended here with 'ai'.
-- status_changed_by_profile_id is populated ONLY when a real CRM profile
-- made the change; status_changed_source always records which channel/
-- actor-type did, regardless. Both status_changed_at and status_changed_
-- source are null exactly when status is still at its untouched initial
-- value ('pending'); status_changed_by_profile_id may additionally be null
-- even after a real transition, whenever the actor was not CRM staff. See
-- requirement_slots_status_pending_pair_check, requirement_slots_status_
-- changed_source_pair_check, and requirement_slots_status_changed_by_
-- source_check below for the three separate invariants this implies.

create table if not exists public.requirement_slots (
  id uuid primary key default gen_random_uuid(),
  application_legacy_id text not null,
  requirement_template_id uuid not null references public.requirement_templates(id) on delete restrict,
  code text not null,
  name jsonb not null,
  description jsonb not null,
  requirement_kind text not null,
  required boolean not null,
  display_order integer not null,
  status text not null default 'pending',
  status_changed_at timestamptz,
  status_changed_by_profile_id uuid references public.profiles(id) on delete restrict,
  status_changed_source text,
  created_at timestamptz not null default now(),
  unique (application_legacy_id, requirement_template_id)
);

comment on table public.requirement_slots is
  'The Requirement Engine''s execution layer (Milestone 10B). The '
  'per-application instance of a Requirement Template, created by copying '
  'the template''s defining facts at application-creation time. Immutable '
  'except for execution state (status and its audit trio). See the '
  'Milestone 10B architecture review and its critical-review follow-up '
  'for the full reasoning behind every column and its absence of a '
  'product_id column.';
comment on column public.requirement_slots.application_legacy_id is
  'TEMPORARY bridge to the existing demo-data application ids (e.g. '
  '"ap-001") — the Applications module has no Supabase table yet. '
  'Explicitly NOT meant to be permanent: once a real applications table '
  'exists, this column should be fully replaced by a real application_id '
  'uuid foreign key, not kept alongside one — see this migration''s header '
  'comment for the recommended evolution path. Not validated at the '
  'database level; the creating service/Server Action layer validates it.';
comment on column public.requirement_slots.requirement_template_id is
  'The template this slot was snapshotted from. ON DELETE RESTRICT: '
  'templates are never hard-deleted in this schema, so this never faces a '
  'dangling reference in practice. Purely for traceability/auditing — '
  'never read as a live data source. The slot''s own copied columns '
  '(code, name, description, requirement_kind, required, display_order) '
  'are the source of truth, not this template''s current values.';
comment on column public.requirement_slots.code is
  'Copied from the requirement template at creation time, then frozen '
  'forever. Never re-synced if the template''s code changes.';
comment on column public.requirement_slots.name is
  'Locale-keyed display name, copied from the requirement template at '
  'creation time and frozen forever — the entire point of the snapshot. A '
  'later rename of the template must never retroactively change what an '
  'existing application was told it needed. Same shape as requirement_'
  'templates.name. Must carry every locale in src/i18n/config.ts''s '
  'LOCALES ("es", "en") — see requirement_slots_name_locales_check below.';
comment on column public.requirement_slots.description is
  'Locale-keyed description, same shape, reasoning, and frozen-at-'
  'creation behavior as name. Not nullable, matching requirement_'
  'templates.description — see requirement_slots_description_locales_'
  'check below.';
comment on column public.requirement_slots.requirement_kind is
  'Copied from the requirement template at creation time and frozen '
  'forever. Doubly protected: requirement_templates.requirement_kind is '
  'already locked by convention at the Server Action layer, and even if '
  'that were ever bypassed, this column would still never reflect the '
  'change, since it is never re-read from the template after creation. '
  'See requirement_slots_requirement_kind_check below.';
comment on column public.requirement_slots.required is
  'Copied from the requirement template at creation time and frozen '
  'forever. If a specific application genuinely does not need this '
  'requirement despite it being copied as required, the correct mechanism '
  'is transitioning status to ''waived'' — never mutating this column, '
  'which would falsify the historical record of what was actually asked '
  'for.';
comment on column public.requirement_slots.display_order is
  'Copied from the requirement template at creation time and frozen '
  'forever — gives a sensible initial checklist order matching what the '
  'applicant would have seen. Unlike products.display_order and '
  'requirement_templates.display_order, this is never independently '
  'reordered after creation; no per-application reordering mechanism '
  'exists in this milestone.';
comment on column public.requirement_slots.status is
  'The slot''s own execution vocabulary: pending (initial state, nothing '
  'submitted), submitted (evidence/attempt has arrived), under_review '
  '(actively being evaluated), satisfied (requirement met, terminal), '
  'rejected (submission reviewed and found insufficient), waived '
  '(an authorized actor determined this specific application does not '
  'need to satisfy this requirement, terminal), missing (nothing '
  'submitted AND explicitly flagged as overdue/actionable — a deliberate, '
  'actor-attributed escalation of pending, not a passively computed '
  'flag). Completely independent from requirement_templates.status '
  '(draft/active/inactive), which is a lifecycle concept, not an '
  'execution one — the two must never share a column or vocabulary. See '
  'requirement_slots_status_check below.';
comment on column public.requirement_slots.status_changed_at is
  'When the slot''s status last transitioned. Null exactly when status is '
  'still ''pending'' (its untouched initial value) — see requirement_'
  'slots_status_pending_pair_check below.';
comment on column public.requirement_slots.status_changed_by_profile_id is
  'Who performed the slot''s last status transition — always the '
  'caller''s own getCurrentProfile().id, never client-supplied, and ONLY '
  'populated when the actor was a real CRM profile (status_changed_source '
  '= ''crm_manual''). Null for transitions driven by a website form, '
  'WhatsApp, or AI, and null before the first transition. ON DELETE '
  'RESTRICT, not CASCADE: a profile with slot status-change history '
  'cannot be hard-deleted, only deactivated (profiles.active) — matches '
  'every other profile reference in this schema. See requirement_slots_'
  'status_changed_by_source_check below.';
comment on column public.requirement_slots.status_changed_source is
  'Which channel/actor-type performed the slot''s last status transition: '
  'crm_manual, website_form, whatsapp, or ai. Mirrors dossier_documents.'
  'uploaded_source (crm_manual/website_form/whatsapp), extended with '
  '''ai'' — the first actor-type in this schema with no corresponding '
  'authenticated CRM profile at all. Every actor type writes through '
  'these exact same three columns; no duplicate status is ever tracked '
  'elsewhere. Null exactly when status_changed_at is null (no transition '
  'yet) — see requirement_slots_status_changed_source_pair_check and '
  'requirement_slots_status_changed_source_check below.';
comment on column public.requirement_slots.created_at is
  'When the slot was snapshotted from its requirement template — under '
  'the immediate, full-batch creation model (Milestone 10B architecture '
  'review), this is the same moment the owning application was created.';

-- Restricts status to the seven values the app currently understands,
-- without promoting it to a Postgres ENUM type — matches every other enum
-- in this schema. Guarded with the same re-runnable-migration
-- pg_constraint existence check used throughout this schema (Postgres has
-- no ADD CONSTRAINT IF NOT EXISTS syntax).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'requirement_slots_status_check'
      and conrelid = 'public.requirement_slots'::regclass
  ) then
    alter table public.requirement_slots
      add constraint requirement_slots_status_check
      check (status in ('pending', 'submitted', 'under_review', 'satisfied', 'rejected', 'waived', 'missing'));
  end if;
end $$;

-- status_changed_at is null if and only if status is still at its
-- untouched initial value ('pending') — 'pending' is only ever the
-- initial default in this lifecycle, never a transition target, so this
-- is a clean, symmetric invariant.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'requirement_slots_status_pending_pair_check'
      and conrelid = 'public.requirement_slots'::regclass
  ) then
    alter table public.requirement_slots
      add constraint requirement_slots_status_pending_pair_check
      check ((status = 'pending') = (status_changed_at is null));
  end if;
end $$;

-- status_changed_at and status_changed_source are always both null (no
-- transition yet) or both set (a transition happened, from some actor
-- type) — never one without the other. Unlike products/requirement_
-- templates' simple status_changed pair, status_changed_by_profile_id is
-- deliberately excluded from this pair — see the next two constraints.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'requirement_slots_status_changed_source_pair_check'
      and conrelid = 'public.requirement_slots'::regclass
  ) then
    alter table public.requirement_slots
      add constraint requirement_slots_status_changed_source_pair_check
      check ((status_changed_at is null) = (status_changed_source is null));
  end if;
end $$;

-- Restricts status_changed_source to the four actor-type values this app
-- currently understands, when present (null is allowed, before the first
-- transition).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'requirement_slots_status_changed_source_check'
      and conrelid = 'public.requirement_slots'::regclass
  ) then
    alter table public.requirement_slots
      add constraint requirement_slots_status_changed_source_check
      check (status_changed_source is null or status_changed_source in ('crm_manual', 'website_form', 'whatsapp', 'ai'));
  end if;
end $$;

-- status_changed_by_profile_id may only be populated when the transition
-- was actually performed by a real CRM profile — never for a website
-- form, WhatsApp, or AI-driven transition, even though those still record
-- status_changed_at/status_changed_source.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'requirement_slots_status_changed_by_source_check'
      and conrelid = 'public.requirement_slots'::regclass
  ) then
    alter table public.requirement_slots
      add constraint requirement_slots_status_changed_by_source_check
      check (status_changed_by_profile_id is null or status_changed_source = 'crm_manual');
  end if;
end $$;

-- Same requirement_kind vocabulary as requirement_templates_requirement_
-- kind_check, duplicated here for defense-in-depth even though every
-- value is copied from an already-validated template row.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'requirement_slots_requirement_kind_check'
      and conrelid = 'public.requirement_slots'::regclass
  ) then
    alter table public.requirement_slots
      add constraint requirement_slots_requirement_kind_check
      check (requirement_kind in (
        'document',
        'phone_verification',
        'apc_check',
        'visit',
        'internal_approval',
        'ai_review',
        'signature',
        'manual_confirmation'
      ));
  end if;
end $$;

-- Same format family as requirement_templates_code_format_check /
-- products_code_format_check, duplicated for the same defense-in-depth
-- reasoning.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'requirement_slots_code_format_check'
      and conrelid = 'public.requirement_slots'::regclass
  ) then
    alter table public.requirement_slots
      add constraint requirement_slots_code_format_check
      check (code ~ '^[a-z][a-z0-9_]{1,59}$');
  end if;
end $$;

-- Every slot's name must carry every UI locale this app currently renders
-- in (src/i18n/config.ts's LOCALES) — same invariant as requirement_
-- templates_name_locales_check, duplicated for defense-in-depth.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'requirement_slots_name_locales_check'
      and conrelid = 'public.requirement_slots'::regclass
  ) then
    alter table public.requirement_slots
      add constraint requirement_slots_name_locales_check
      check (name ? 'es' and name ? 'en');
  end if;
end $$;

-- Same locale-completeness invariant as name — description is NOT NULL
-- here (matching requirement_templates.description), so this is always
-- enforced unconditionally.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'requirement_slots_description_locales_check'
      and conrelid = 'public.requirement_slots'::regclass
  ) then
    alter table public.requirement_slots
      add constraint requirement_slots_description_locales_check
      check (description ? 'es' and description ? 'en');
  end if;
end $$;

-- The two real query shapes: one application's checklist in display order
-- (the eventual Execution UI's hot path), and one application's
-- outstanding/incomplete items by status.
create index if not exists requirement_slots_application_legacy_id_display_order_idx
  on public.requirement_slots (application_legacy_id, display_order);

create index if not exists requirement_slots_application_legacy_id_status_idx
  on public.requirement_slots (application_legacy_id, status);

-- Supports the reporting/auditing use case ("every slot ever generated
-- from this template") — Postgres does not auto-index foreign keys.
create index if not exists requirement_slots_requirement_template_id_idx
  on public.requirement_slots (requirement_template_id);

-- ============================================================================
-- Row Level Security
-- ============================================================================

-- Enabled with zero policies, same posture as every other real table in
-- this schema: fully locked to both `anon` and `authenticated` until a
-- real permissions model exists. Reads/writes go through the server-only
-- Supabase client in the meantime.
alter table public.requirement_slots enable row level security;

-- ============================================================================
-- service_role grants
-- ============================================================================

-- Select + insert + update — no delete. No case in this schema has ever
-- justified a DELETE grant (every "this shouldn't have happened" scenario
-- elsewhere is handled by deactivation/status change, never deletion) and
-- Requirement Slots are no exception, per the Milestone 10B architecture
-- review's explicit evaluation of this question.
grant select, insert, update on public.requirement_slots to service_role;
