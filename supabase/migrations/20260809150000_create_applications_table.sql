-- ============================================================================
-- applications
-- ============================================================================
--
-- Purpose: the Application Engine's identity + lifecycle table (Milestone
-- 11 — see the Milestone 11 architecture review and its follow-up critical
-- review on requested_amount/requested_term_months, both approved before
-- this migration was written). An Application is a client's request for a
-- specific Product — "client cl-001 wants $50,000 over 36 months for a
-- Personal Loan" — the central entity every other module (Requirement
-- Slots, and later Document Evidence, Workflow, AI Rules) hangs off of via
-- foreign key. It is deliberately a thin, stable anchor: identity, the
-- original request, and a minimal execution lifecycle — nothing else.
--
-- Scope (deliberately minimal — see the architecture review's "what
-- belongs inside vs. outside Applications" and "fields deliberately
-- deferred" sections):
--   - No approved_amount, approved_term_months, interest_rate,
--     monthly_payment, or any underwriting-terms field. Those are set by
--     the LENDER during a future evaluation/approval process, not stated
--     by the client at creation — genuinely different data, genuinely
--     different owner, explicitly deferred to a future capability.
--   - No workflow/approval-stage fields, no AI scoring fields, no
--     communication log — none of that exists yet, and none of it belongs
--     on this row when it does (future child tables reference
--     application_id, this table doesn't grow to meet them).
--   - No requirement-completion / "documents pending" field — that is
--     always derived live from requirement_slots, never duplicated here
--     (the exact redundancy already rejected for requirement_slots.
--     product_id).
--   - No institution_id — inherited transitively through product_id, same
--     as requirement_templates and requirement_slots.
--   - No Row Level Security policies yet — same posture as every other
--     real table in this schema: RLS is enabled but left fully locked.
--     Reads/writes go through the server-only Supabase client
--     (src/lib/supabase/server.ts).
--
-- application_number: system-generated, human-readable case reference
-- (e.g. "ODL-2026-000123"), matching the existing demo data's format.
-- Generated via a dedicated sequence + a column DEFAULT expression, not
-- application-side "count + 1" logic — nextval() on a Postgres sequence is
-- atomic under concurrent transactions by construction (two simultaneous
-- inserts can never receive the same value), which a SELECT-max-then-
-- insert approach cannot guarantee without an explicit table lock. The
-- year component reflects the actual creation year but the numeric
-- component is a single global counter that never resets — a per-year-
-- resetting sequence (restarting at 000001 every January) was considered
-- and deliberately deferred: it requires a year-boundary trigger or a
-- scheduled job, real added complexity with no demonstrated business need
-- yet, whereas a global counter is simpler, has zero rollover edge cases,
-- and still produces a unique, stable, human-readable, ODL-style
-- reference. If per-year resetting is ever required, that is a purely
-- additive future change to the sequence/default expression, not a
-- redesign of this column.
--
-- product_id: NOT NULL, ON DELETE RESTRICT, and — unlike every other
-- foreign key in this table — has no update path anywhere in the service
-- layer. Immutable by deliberate design, not oversight: requirement_slots
-- are snapshotted once from the application's product at creation time
-- (see requirement_slots.application_id below), and if product_id could
-- change afterward, every existing slot would silently reference the
-- wrong product's requirements with no mechanism to reconcile them (slots
-- are never deleted or bulk-recreated). If a client's request genuinely
-- needs a different product, the correct model is: cancel this
-- Application, create a new one for the new product — never mutate
-- product_id in place. See the architecture review's Product Relationship
-- section.
--
-- requested_amount / requested_term_months: the client's ORIGINAL
-- request, immutable forever once set — a snapshot fact, not a live
-- value, exactly like product_id above. Deliberately distinct from (and
-- not to be confused with) any future approved_amount/approved_term_
-- months: those represent what the LENDER later determines, are edited
-- during underwriting, and belong to a separate, still-deferred
-- capability. requested_amount uses numeric(12,2) for exact decimal
-- currency arithmetic (never float). requested_term_months's upper
-- sanity bound of 360 (30 years, in months) covers the longest realistic
-- term across every product in the current catalog, including Mortgage —
-- a defense-in-depth sanity check only, not a business rule; product-
-- specific min/max bounds are explicitly out of scope here, deferred to a
-- future Product financial-settings capability (see requested_term_
-- months's CHECK constraint below).
--
-- created_by_profile_id / created_source: mirrors requirement_slots'
-- multi-actor pattern (crm_manual/website_form/whatsapp/ai) rather than
-- products/requirement_templates' CRM-only audit pair, because
-- Applications — like Requirement Slots — will eventually be created by
-- channels with no corresponding authenticated CRM profile at all
-- (a future website intake form, a WhatsApp flow). created_by_profile_id
-- is populated ONLY when created_source = 'crm_manual' — see
-- applications_created_by_source_check below.
--
-- status: the application's own 5-value execution lifecycle — new,
-- in_review, approved, not_eligible, cancelled. Deliberately narrower
-- than the existing demo LoanStatus vocabulary (which also has
-- pendiente_documentos and documentacion_completa): those two describe
-- exactly what requirement_slots now tracks authoritatively, and keeping
-- them as a separately-tracked Application status would recreate a dual-
-- source-of-truth problem (the same class of redundancy already rejected
-- for requirement_slots.product_id). "Pending documents" / "documentation
-- complete" are UI-layer computations over requirement_slots' statuses,
-- never a stored column here. approved / not_eligible / cancelled are
-- treated as terminal (no outgoing transitions) — deliberately
-- conservative for this first implementation, same posture already used
-- for requirement_slots' satisfied/waived. See the architecture review's
-- Lifecycle section and src/lib/config/application.ts's
-- APPLICATION_STATUS_TRANSITIONS for the exact legal-transition graph
-- enforced at the service layer.
--
-- status_changed_at / status_changed_by_profile_id / status_changed_
-- source: the same three-column audit trio as requirement_slots, for the
-- same reason (status can legitimately be changed by a non-CRM actor).
-- Both status_changed_at and status_changed_source are null exactly when
-- status is still at its untouched initial value ('new');
-- status_changed_by_profile_id may additionally be null even after a
-- real transition, whenever the actor was not CRM staff. See
-- applications_status_new_pair_check, applications_status_changed_
-- source_pair_check, and applications_status_changed_by_source_check
-- below.
--
-- assigned_advisor_profile_id: the one genuinely editable, non-audited
-- business fact on this table — which advisor currently owns the case.
-- Reassignment is a normal, frequent business operation with no legality
-- graph (unlike status), so it carries no accompanying audit-trail
-- columns; only the approved core field list is implemented here (see
-- the architecture review's "fields deliberately deferred" section for
-- why a dedicated assigned_at/assigned_by pair was not added).
--
-- client_legacy_id: a DELIBERATE, TEMPORARY bridge to the existing
-- demo-data client ids (e.g. "cl-001"), following the exact same pattern
-- already used by dossier_notes/dossier_alerts/dossier_documents'
-- client_legacy_id and (until this same migration set) requirement_
-- slots.application_legacy_id. Per the architecture review: when a real
-- clients table eventually lands, this column should be fully REPLACED by
-- a real client_id uuid foreign key — not kept alongside one — following
-- the identical evolution path this milestone is itself executing for
-- requirement_slots.application_legacy_id (see the companion migrations
-- 20260809150100 / 20260809150300). Not validated at the database level;
-- the creating service layer is responsible for it, matching every other
-- legacy-id bridge precedent in this schema.

create sequence if not exists public.applications_number_seq;

create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  application_number text not null default (
    'ODL-' || to_char(now(), 'YYYY') || '-' ||
    lpad(nextval('public.applications_number_seq')::text, 6, '0')
  ),
  client_legacy_id text not null,
  product_id uuid not null references public.products(id) on delete restrict,
  requested_amount numeric(12, 2) not null,
  requested_term_months integer not null,
  created_at timestamptz not null default now(),
  created_by_profile_id uuid references public.profiles(id) on delete restrict,
  created_source text not null default 'crm_manual',
  status text not null default 'new',
  status_changed_at timestamptz,
  status_changed_by_profile_id uuid references public.profiles(id) on delete restrict,
  status_changed_source text,
  assigned_advisor_profile_id uuid references public.profiles(id) on delete restrict,
  unique (application_number)
);

-- Ties the sequence's lifecycle to the column it backs (the same
-- ownership a `generated always as identity` column would set up
-- automatically) — purely a hygiene measure so the sequence cannot become
-- an orphaned object if this column or table is ever dropped; has no
-- effect on the numbers it generates.
alter sequence public.applications_number_seq owned by public.applications.application_number;

comment on table public.applications is
  'The Application Engine''s identity + lifecycle table (Milestone 11). '
  'A client''s request for a specific Product — the central entity every '
  'other module (Requirement Slots, and later Document Evidence, '
  'Workflow, AI Rules) hangs off of via foreign key. Deliberately thin: '
  'identity, the original request, and a minimal execution lifecycle '
  'only. See the Milestone 11 architecture review and its critical-review '
  'follow-up on requested_amount/requested_term_months for the full '
  'reasoning behind every column and every deliberately-absent field.';
comment on column public.applications.application_number is
  'System-generated, human-readable case reference (e.g. '
  '"ODL-2026-000123"), via a dedicated sequence + DEFAULT expression — '
  'never application-side "count + 1" logic, which is race-prone under '
  'concurrent inserts. See this migration''s header comment for why the '
  'numeric component is a single global counter rather than a '
  'per-year-resetting one. Format is additionally guarded by '
  'applications_application_number_format_check as defense-in-depth, '
  'matching the same discipline already applied to products.code and '
  'requirement_templates.code / requirement_slots.code, even though the '
  'only call path that writes this column relies solely on the DEFAULT '
  'above.';
comment on column public.applications.client_legacy_id is
  'TEMPORARY bridge to the existing demo-data client ids (e.g. '
  '"cl-001") — the Client module has no Supabase table yet. Explicitly '
  'NOT meant to be permanent: once a real clients table exists, this '
  'column should be fully replaced by a real client_id uuid foreign key, '
  'not kept alongside one — see this migration''s header comment. Not '
  'validated at the database level; the creating service layer validates '
  'it.';
comment on column public.applications.product_id is
  'Immutable — no update path exists anywhere in the service layer. See '
  'this migration''s header comment for why product switching is '
  'deliberately unsupported (it would silently invalidate every existing '
  'requirement_slots row snapshotted from the original product). ON '
  'DELETE RESTRICT: products are never hard-deleted in this schema, only '
  'moved to inactive, so this never faces a dangling reference in '
  'practice.';
comment on column public.applications.requested_amount is
  'The client''s originally-requested loan amount, immutable forever '
  'once set. numeric(12,2) for exact decimal currency arithmetic. '
  'Deliberately distinct from any future approved_amount (lender-'
  'determined, editable, a separate deferred capability). See '
  'applications_requested_amount_check below.';
comment on column public.applications.requested_term_months is
  'The client''s originally-requested loan term in months, immutable '
  'forever once set. Deliberately distinct from any future '
  'approved_term_months. See applications_requested_term_months_check '
  'below for the sanity bound and its reasoning.';
comment on column public.applications.created_at is
  'When the application was created.';
comment on column public.applications.created_by_profile_id is
  'Who created the application — populated ONLY when created_source = '
  '''crm_manual''. Null for applications originated by a website form, '
  'WhatsApp, or AI, which have no corresponding authenticated CRM '
  'profile. ON DELETE RESTRICT: a profile that has created applications '
  'cannot be hard-deleted, only deactivated (profiles.active). See '
  'applications_created_by_source_check below.';
comment on column public.applications.created_source is
  'Which channel/actor-type created the application: crm_manual, '
  'website_form, whatsapp, or ai. Mirrors requirement_slots.status_'
  'changed_source exactly. See applications_created_source_check below.';
comment on column public.applications.status is
  'One of new / in_review / approved / not_eligible / cancelled — the '
  'application''s own execution lifecycle, independent from products.'
  'status and requirement_templates.status (both configuration '
  'lifecycles, not execution ones). Deliberately does NOT include '
  '"pending documents" / "documentation complete" — those are computed '
  'live from requirement_slots, never stored here. approved / '
  'not_eligible / cancelled are terminal in this first implementation. '
  'See applications_status_check below and src/lib/config/application.ts '
  'for the enforced transition graph.';
comment on column public.applications.status_changed_at is
  'When the application''s status last transitioned. Null exactly when '
  'status is still ''new'' (its untouched initial value) — see '
  'applications_status_new_pair_check below.';
comment on column public.applications.status_changed_by_profile_id is
  'Who performed the application''s last status transition — always the '
  'caller''s own getCurrentProfile().id, never client-supplied, and ONLY '
  'populated when the actor was a real CRM profile (status_changed_'
  'source = ''crm_manual''). ON DELETE RESTRICT, matching every other '
  'profile reference in this schema. See applications_status_changed_by_'
  'source_check below.';
comment on column public.applications.status_changed_source is
  'Which channel/actor-type performed the application''s last status '
  'transition. Null exactly when status_changed_at is null (no '
  'transition yet). See applications_status_changed_source_pair_check '
  'and applications_status_changed_source_check below.';
comment on column public.applications.assigned_advisor_profile_id is
  'Which advisor currently owns this case — freely reassignable, no '
  'transition-legality graph (unlike status). Nullable: a new '
  'application may be unassigned. No accompanying audit-trail columns by '
  'deliberate design — see this migration''s header comment. ON DELETE '
  'RESTRICT, matching every other profile reference in this schema.';

-- Restricts application_number to the ODL-YYYY-NNNNNN format the DEFAULT
-- expression above always produces (a 4-digit year, a hyphen, then a
-- 6-digit zero-padded sequence number) — defense-in-depth only, matching
-- the same format-CHECK discipline already applied to every other
-- human-facing identifier column in this schema (products.code,
-- requirement_templates.code, requirement_slots.code), even though the
-- only call path that writes this column
-- (src/lib/services/applications.ts#createApplication) never supplies it
-- explicitly and always relies on the DEFAULT.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'applications_application_number_format_check'
      and conrelid = 'public.applications'::regclass
  ) then
    alter table public.applications
      add constraint applications_application_number_format_check
      check (application_number ~ '^ODL-[0-9]{4}-[0-9]{6}$');
  end if;
end $$;

-- Guards a positive requested amount only — no product-specific min/max
-- bound, which is explicitly out of scope (a future Product
-- financial-settings capability, not this milestone).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'applications_requested_amount_check'
      and conrelid = 'public.applications'::regclass
  ) then
    alter table public.applications
      add constraint applications_requested_amount_check
      check (requested_amount > 0);
  end if;
end $$;

-- 360 months (30 years) — see this migration's header comment for why
-- this specific bound was chosen (the longest realistic term across the
-- current product catalog, including Mortgage).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'applications_requested_term_months_check'
      and conrelid = 'public.applications'::regclass
  ) then
    alter table public.applications
      add constraint applications_requested_term_months_check
      check (requested_term_months > 0 and requested_term_months <= 360);
  end if;
end $$;

-- Restricts created_source to the four actor-type values this app
-- currently understands — same vocabulary as requirement_slots.status_
-- changed_source.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'applications_created_source_check'
      and conrelid = 'public.applications'::regclass
  ) then
    alter table public.applications
      add constraint applications_created_source_check
      check (created_source in ('crm_manual', 'website_form', 'whatsapp', 'ai'));
  end if;
end $$;

-- created_by_profile_id may only be populated when the application was
-- actually created by a real CRM profile — never for a website form,
-- WhatsApp, or AI-originated application.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'applications_created_by_source_check'
      and conrelid = 'public.applications'::regclass
  ) then
    alter table public.applications
      add constraint applications_created_by_source_check
      check (created_by_profile_id is null or created_source = 'crm_manual');
  end if;
end $$;

-- Restricts status to the five values the app currently understands,
-- without promoting it to a Postgres ENUM type — matches every other
-- enum-shaped column in this schema.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'applications_status_check'
      and conrelid = 'public.applications'::regclass
  ) then
    alter table public.applications
      add constraint applications_status_check
      check (status in ('new', 'in_review', 'approved', 'not_eligible', 'cancelled'));
  end if;
end $$;

-- status_changed_at is null if and only if status is still at its
-- untouched initial value ('new') — mirrors requirement_slots_status_
-- pending_pair_check exactly, with 'new' playing the same role 'pending'
-- plays there.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'applications_status_new_pair_check'
      and conrelid = 'public.applications'::regclass
  ) then
    alter table public.applications
      add constraint applications_status_new_pair_check
      check ((status = 'new') = (status_changed_at is null));
  end if;
end $$;

-- status_changed_at and status_changed_source are always both null (no
-- transition yet) or both set — status_changed_by_profile_id is
-- deliberately excluded from this pair, same split as requirement_slots.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'applications_status_changed_source_pair_check'
      and conrelid = 'public.applications'::regclass
  ) then
    alter table public.applications
      add constraint applications_status_changed_source_pair_check
      check ((status_changed_at is null) = (status_changed_source is null));
  end if;
end $$;

-- Restricts status_changed_source to the four actor-type values, when
-- present.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'applications_status_changed_source_check'
      and conrelid = 'public.applications'::regclass
  ) then
    alter table public.applications
      add constraint applications_status_changed_source_check
      check (status_changed_source is null or status_changed_source in ('crm_manual', 'website_form', 'whatsapp', 'ai'));
  end if;
end $$;

-- status_changed_by_profile_id may only be populated when the transition
-- was actually performed by a real CRM profile.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'applications_status_changed_by_source_check'
      and conrelid = 'public.applications'::regclass
  ) then
    alter table public.applications
      add constraint applications_status_changed_by_source_check
      check (status_changed_by_profile_id is null or status_changed_source = 'crm_manual');
  end if;
end $$;

-- The real query shapes: one client's applications, one product's
-- applications, and the CRM list/kanban views (every application, newest
-- first, optionally filtered by status).
create index if not exists applications_client_legacy_id_idx
  on public.applications (client_legacy_id);

create index if not exists applications_product_id_idx
  on public.applications (product_id);

create index if not exists applications_status_created_at_idx
  on public.applications (status, created_at);

create index if not exists applications_assigned_advisor_profile_id_idx
  on public.applications (assigned_advisor_profile_id);

-- ============================================================================
-- Row Level Security
-- ============================================================================

-- Enabled with zero policies, same posture as every other real table in
-- this schema: fully locked to both `anon` and `authenticated` until a
-- real permissions model exists. Reads/writes go through the server-only
-- Supabase client in the meantime.
alter table public.applications enable row level security;

-- ============================================================================
-- service_role grants
-- ============================================================================

-- Select + insert + update — no delete. Applications are never hard-
-- deleted, only moved to a terminal status (cancelled/not_eligible) —
-- matches the "never delete" posture already applied to every other real
-- table in this schema.
grant select, insert, update on public.applications to service_role;
