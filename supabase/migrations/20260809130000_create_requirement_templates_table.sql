-- ============================================================================
-- requirement_templates
-- ============================================================================
--
-- Purpose: the Requirement Engine's foundation table (Milestone 10A — see
-- the Milestone 10 architecture review, approved before this migration was
-- written). A Requirement Template describes something a Product requires
-- ("Personal Loan requires a Salary Letter") — a template/class, one level
-- below Product exactly the way Product is one level below Application. A
-- requirement is NOT necessarily a document — see requirement_kind below.
--
-- Scope (deliberately minimal — see the architecture review's "Requirement
-- Template model" section):
--   - Identity + business content + classification + lifecycle + display
--     ordering only. No validation configuration (MIME types, size limits,
--     file counts — meaningless for most requirement kinds and deferred to
--     a future kind-specific config table once Evidence exists to validate
--     against), no shared evidence-catalog reference (deferred until real
--     cross-product duplication is observed), no institution_id (inherited
--     transitively through product_id — see the architecture review's
--     multi-tenancy section; Product itself doesn't have this column yet
--     either).
--   - No relationship to Requirement Slots or Evidence yet. Those are
--     Milestone 10B and later — this table has zero knowledge of either, by
--     design, matching the same "Product should have zero knowledge of its
--     children" discipline already applied one layer up.
--   - Does NOT touch dossier_documents. The Document Engine migration
--     (dossier_documents becoming Document Evidence, referencing a future
--     requirement_slot_id) is explicitly out of scope here and, per the
--     architecture review, cannot even begin until real Requirement Slots
--     exist — a hard dependency, not a preference.
--   - No Row Level Security policies yet — same posture as every other real
--     table in this schema (profiles, chat, dossier_notes, dossier_alerts,
--     dossier_documents, products): RLS is enabled but left fully locked.
--     Reads/writes go through the server-only Supabase client
--     (src/lib/supabase/server.ts).
--
-- product_id: not null, on delete restrict — every requirement template
-- must belong to exactly one product, and a product with requirement
-- templates can never be hard-deleted (matches products' own "never
-- deleted, only deactivated" posture, transitively).
--
-- code: unique PER PRODUCT (product_id, code), deliberately NOT globally
-- unique like products.code. A requirement code is only ever meaningful in
-- the context of its own product (e.g. a future WhatsApp flow resolves
-- "personal_loan" first, then looks up "salary_letter" within that
-- product's requirements) — nothing should stop two unrelated products from
-- both defining a requirement coded "salary_letter". See the architecture
-- review §3.
--
-- name AND description are both locale-keyed JSON objects, both NOT NULL,
-- following exactly the same shape, reasoning, and mandatory locale-
-- completeness constraint pattern as products.name (see that migration's
-- comments) — business-editable content an administrator sets at runtime,
-- never routed through next-intl's static, deploy-time message catalogs.
-- Unlike products.short_description, description here is NOT optional:
-- every requirement template must explain itself in both locales. Must
-- carry every locale in src/i18n/config.ts's LOCALES ("es", "en") — see
-- requirement_templates_name_locales_check /
-- requirement_templates_description_locales_check below.
--
-- requirement_kind: a small, code-owned, CHECK-constrained vocabulary —
-- deliberately NOT free text the way products.code is. The reasoning is the
-- mirror image of why products.code was left open: the test that justified
-- products.code's freedom is "is the application code agnostic to this
-- value?" — Product identity passes that test, requirement_kind fails it by
-- definition, since it's exactly the axis the UI must branch on to render
-- the right input (an upload widget vs. a phone-verification checkbox vs.
-- an approval record) and the axis a future Evidence layer must branch on
-- to know what shape of proof to expect. Widening this list later is a
-- single, idempotent-guarded CHECK constraint change, never an ENUM type
-- migration — same convention as every other enum in this schema. See the
-- architecture review §4.
--
-- required: a genuine business toggle (required vs. optional), freely
-- editable after creation — unlike code and requirement_kind, which are
-- treated as effectively locked identity/classification facts once a
-- template exists (enforced at the Server Action layer, not by a database
-- constraint, matching how products.code's immutability is purely
-- conventional).
--
-- display_order: presentation-only ordering of ONE product's requirements
-- relative to each other — a distinct axis from products.display_order
-- (which orders products relative to each other), sharing only the column
-- name and the same sparse-gap convention. Never conflate the two.
--
-- status / status_changed_at / status_changed_by_profile_id: identical
-- shape, transition graph (draft -> active -> inactive -> active,
-- active -> draft deliberately illegal), and audit-pair discipline as
-- products.status and its companions — see that migration's comments for
-- the full reasoning, which applies unchanged here. "inactive" means
-- excluded from new applications' future requirement-slot sets going
-- forward; it is an even safer deactivation than products' own, since a
-- future Requirement Slot will snapshot a template's defining facts at
-- creation time and never consult the template's live status again
-- afterward (see the architecture review's snapshot/versioning section).

create table if not exists public.requirement_templates (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete restrict,
  code text not null,
  name jsonb not null,
  description jsonb not null,
  requirement_kind text not null,
  required boolean not null default true,
  display_order integer not null default 10,
  status text not null default 'draft',
  status_changed_at timestamptz,
  status_changed_by_profile_id uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (product_id, code)
);

comment on table public.requirement_templates is
  'The Requirement Engine''s foundation table (Milestone 10A). Describes '
  'something a Product requires (a document, a phone verification, an '
  'internal approval, ...) — a template/class, not a per-application '
  'instance. Deliberately minimal — see the Milestone 10 architecture '
  'review for the full "what belongs here" reasoning. Requirement Slots '
  'and Evidence (Milestone 10B and later) will be separate tables '
  'referencing this one''s id — this table has no knowledge of either.';
comment on column public.requirement_templates.product_id is
  'The owning product. ON DELETE RESTRICT: a product with requirement '
  'templates can never be hard-deleted, only deactivated — matches every '
  'other parent reference in this schema.';
comment on column public.requirement_templates.code is
  'Stable, human-assigned identifier, unique per product (see the '
  'unique (product_id, code) constraint above) — deliberately NOT globally '
  'unique like products.code, since a requirement code is only ever '
  'meaningful in the context of its own product. Practically immutable by '
  'convention once created, same posture as products.code, enforced at '
  'the Server Action layer, not by a database constraint.';
comment on column public.requirement_templates.name is
  'Locale-keyed display name, e.g. {"es": "Carta de trabajo", "en": '
  '"Salary Letter"}. Business-editable content, deliberately NOT routed '
  'through next-intl''s static message catalogs — same shape and reasoning '
  'as products.name. Must carry every locale in src/i18n/config.ts''s '
  'LOCALES ("es", "en") — see requirement_templates_name_locales_check.';
comment on column public.requirement_templates.description is
  'Locale-keyed description, same shape and reasoning as name (see that '
  'column''s comment) — business-editable content, never routed through '
  'next-intl. Not nullable: every requirement template must define a '
  'description in both locales, same as name. Must carry every locale in '
  'src/i18n/config.ts''s LOCALES ("es", "en") — see '
  'requirement_templates_description_locales_check.';
comment on column public.requirement_templates.requirement_kind is
  'What kind of evidence this requirement expects: document, '
  'phone_verification, apc_check, visit, internal_approval, ai_review, '
  'signature, or manual_confirmation. Plain text + CHECK, not a Postgres '
  'ENUM type — matches every other enum in this schema. Deliberately '
  'code-owned and closed (unlike products.code), because the application '
  'is never agnostic to this value: it is exactly what determines how the '
  'requirement is rendered and, later, what shape of Evidence satisfies '
  'it. See requirement_templates_requirement_kind_check below and the '
  'architecture review §4. Practically immutable by convention once '
  'created, enforced at the Server Action layer, not by a database '
  'constraint.';
comment on column public.requirement_templates.required is
  'true = required, false = optional. A genuine, freely-editable business '
  'toggle — unlike code and requirement_kind, this is not treated as a '
  'locked identity fact.';
comment on column public.requirement_templates.display_order is
  'Presentation-only ordering of this PRODUCT''s requirements relative to '
  'each other — a distinct axis from products.display_order (which orders '
  'products relative to each other). Same sparse-gap convention (10, 20, '
  '30, ...), different scope: never conflate the two.';
comment on column public.requirement_templates.status is
  'One of draft / active / inactive. Identical semantics and transition '
  'graph to products.status (draft->active->inactive->active only; '
  'active->draft deliberately illegal, enforced at the Server Action '
  'layer). "inactive" means excluded from new applications'' future '
  'requirement-slot sets going forward — never affects anything that '
  'already snapshotted this template''s facts. See '
  'requirement_templates_status_check below.';
comment on column public.requirement_templates.status_changed_at is
  'When the template''s status last transitioned. Null until the first '
  'transition (never set at creation). Mirrors products.status_changed_at.';
comment on column public.requirement_templates.status_changed_by_profile_id is
  'Who performed the template''s last status transition — always the '
  'caller''s own getCurrentProfile().id, never client-supplied. Null until '
  'the first transition. ON DELETE RESTRICT, not CASCADE: a profile with '
  'requirement-template status-change history cannot be hard-deleted, '
  'only deactivated (profiles.active) — matches every other profile '
  'reference in this schema.';
comment on column public.requirement_templates.created_at is
  'When the requirement template row was created (i.e. entered draft '
  'status).';

-- Restricts status to the three values the app currently understands,
-- without promoting it to a Postgres ENUM type — matches the products /
-- dossier_notes / dossier_alerts / dossier_documents precedent. Guarded
-- with the same re-runnable-migration pg_constraint existence check used
-- throughout this schema (Postgres has no ADD CONSTRAINT IF NOT EXISTS
-- syntax).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'requirement_templates_status_check'
      and conrelid = 'public.requirement_templates'::regclass
  ) then
    alter table public.requirement_templates
      add constraint requirement_templates_status_check
      check (status in ('draft', 'active', 'inactive'));
  end if;
end $$;

-- The initial requirement_kind vocabulary, exactly as named in the
-- Milestone 10 architecture review. Widening this list later is a single
-- DROP CONSTRAINT + ADD CONSTRAINT, not a schema-wide ENUM migration.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'requirement_templates_requirement_kind_check'
      and conrelid = 'public.requirement_templates'::regclass
  ) then
    alter table public.requirement_templates
      add constraint requirement_templates_requirement_kind_check
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

-- Lowercase snake_case, reasonable length bound — same format family as
-- products_code_format_check. Does not prevent a rename, only malformed
-- values.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'requirement_templates_code_format_check'
      and conrelid = 'public.requirement_templates'::regclass
  ) then
    alter table public.requirement_templates
      add constraint requirement_templates_code_format_check
      check (code ~ '^[a-z][a-z0-9_]{1,59}$');
  end if;
end $$;

-- Every requirement template's name must carry every UI locale this app
-- currently renders in (src/i18n/config.ts's LOCALES) — prevents a
-- requirement ever displaying blank in a supported locale. Same reasoning
-- as products_name_locales_check.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'requirement_templates_name_locales_check'
      and conrelid = 'public.requirement_templates'::regclass
  ) then
    alter table public.requirement_templates
      add constraint requirement_templates_name_locales_check
      check (name ? 'es' and name ? 'en');
  end if;
end $$;

-- Every requirement template's description must carry every UI locale
-- this app currently renders in (src/i18n/config.ts's LOCALES) — same
-- invariant as requirement_templates_name_locales_check, now applied
-- unconditionally since description is no longer nullable.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'requirement_templates_description_locales_check'
      and conrelid = 'public.requirement_templates'::regclass
  ) then
    alter table public.requirement_templates
      add constraint requirement_templates_description_locales_check
      check (description ? 'es' and description ? 'en');
  end if;
end $$;

-- status_changed_at and status_changed_by_profile_id are always both null
-- (no transition yet) or both set — never one without the other. Mirrors
-- products_status_changed_pair_check.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'requirement_templates_status_changed_pair_check'
      and conrelid = 'public.requirement_templates'::regclass
  ) then
    alter table public.requirement_templates
      add constraint requirement_templates_status_changed_pair_check
      check ((status_changed_at is null) = (status_changed_by_profile_id is null));
  end if;
end $$;

-- The two real query shapes: one product's requirements in display order
-- (the admin "Requisitos" screen), and one product's ACTIVE requirements in
-- display order (what a future application-creation flow, website form, or
-- WhatsApp intake will actually query).
create index if not exists requirement_templates_product_id_display_order_idx
  on public.requirement_templates (product_id, display_order);

create index if not exists requirement_templates_product_id_status_idx
  on public.requirement_templates (product_id, status);

-- ============================================================================
-- Row Level Security
-- ============================================================================

-- Enabled with zero policies, same posture as every other real table in
-- this schema: fully locked to both `anon` and `authenticated` until a real
-- permissions model exists. Reads/writes go through the server-only
-- Supabase client in the meantime.
alter table public.requirement_templates enable row level security;

-- ============================================================================
-- service_role grants
-- ============================================================================

-- Select + insert + update — no delete. Requirement templates are never
-- hard-deleted, only moved to inactive (see the status comment above) —
-- matches the "never delete" posture already applied to every other real
-- table in this schema.
grant select, insert, update on public.requirement_templates to service_role;
