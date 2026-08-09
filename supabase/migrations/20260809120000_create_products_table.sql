-- ============================================================================
-- products
-- ============================================================================
--
-- Purpose: the Product Engine's identity + lifecycle table (Milestone 9A —
-- see the Milestone 9 architecture review and its follow-up stress-test
-- review, both approved before this migration was written). A Product is a
-- configurable financial product a financial institution offers (Personal
-- Loan, Mortgage, ...) — a template, not a transaction. It is NOT a loan
-- application; Applications will reference a product_id once the
-- Applications module itself is migrated (Milestone 11), not before.
--
-- Scope (deliberately minimal — see the architecture review's "what belongs
-- inside Product / what belongs elsewhere / what should never be stored
-- inside Product"):
--   - Identity + lifecycle + display ordering only. No commercial boundary
--     fields (currency, min/max amount, min/max term), no institution_id
--     (no institutions table exists yet — this app is still single-tenant
--     ODL), no metadata JSONB. All explicitly deferred, all purely additive
--     to add later — see the architecture review's extensibility analysis.
--   - No relationship to Requirement Templates, Workflow Templates,
--     Communication Templates, AI Rules, or Applications yet. Those are all
--     future CHILD tables that will reference product_id — this table has
--     zero knowledge of any of them, by design (see the Milestone 9
--     stress-test review, Q1: "Product should have zero knowledge of its
--     children").
--   - No Row Level Security policies yet — same posture already used for
--     every real table in this schema (profiles, chat, dossier_notes,
--     dossier_alerts, dossier_documents): RLS is enabled but left fully
--     locked. Reads/writes go through the server-only Supabase client
--     (src/lib/supabase/server.ts).
--
-- code vs name vs id: three separate identity concerns, deliberately kept
-- separate (see the architecture review §2). `id` is invisible internal FK
-- plumbing. `code` is the stable, human-assigned, machine-referenceable key
-- every future external surface (website form URLs, WhatsApp flow
-- configuration, integration mappings) will hold onto — practically
-- immutable by social contract, not database enforcement (a rename is a
-- rare, deliberate action that would break those surfaces silently; no
-- technical lock is placed on it, matching the architecture review's
-- reasoning). `name`/`short_description` are what a human reads, freely
-- editable, and localized.
--
-- Unlike every other enum-shaped column in this schema (profiles.role,
-- dossier_notes.type, dossier_alerts.type, dossier_documents.type — all
-- plain text + CHECK, matching a small, code-owned, rarely-changing
-- vocabulary), `code` is deliberately NOT constrained to a fixed list. It
-- is free text with only a format + uniqueness constraint, because Products
-- are the one thing in this system meant to be added by a business
-- administrator without a code change — constraining it to an enum would
-- silently reintroduce the "programming, not configuration" problem this
-- milestone exists to eliminate. See the architecture review §5.
--
-- name / short_description are locale-keyed JSON objects (e.g.
-- {"es": "Préstamo Personal", "en": "Personal Loan"}), not routed through
-- next-intl's static message catalogs. next-intl's JSON files are a
-- developer, deploy-time mechanism for fixed UI chrome; Product text is
-- business content a non-developer administrator must be able to edit at
-- runtime. Only the two locales this app's UI actually renders in today
-- (see src/i18n/config.ts's LOCALES — "es"/"en") are required; this is
-- deliberately narrower than SupportedLanguage (src/types/user.ts), which
-- also includes "fr" for chat message translation only — an unrelated
-- concept. Adding a UI locale later is a config-level LOCALES change plus a
-- data backfill, not a schema change (see products_name_locales_check /
-- products_short_description_locales_check below).
--
-- status_changed_at / status_changed_by_profile_id mirror the exact
-- "one pair, always overwritten together on the relevant transition, actor
-- always derived server-side via getCurrentProfile(), never client-
-- supplied" pattern already established twice in this schema (dossier_
-- alerts' resolved_at/resolved_by_profile_id, dossier_documents' reviewed_
-- at/reviewed_by_profile_id) — both null until the product's first status
-- transition (never set at creation), then always overwritten together on
-- every subsequent transition.

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name jsonb not null,
  short_description jsonb,
  status text not null default 'draft',
  display_order integer not null default 10,
  status_changed_at timestamptz,
  status_changed_by_profile_id uuid references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

comment on table public.products is
  'The Product Engine''s identity + lifecycle table (Milestone 9A). A '
  'Product is a configurable financial product template (Personal Loan, '
  'Mortgage, ...), not a loan application. Deliberately minimal — see the '
  'Milestone 9 architecture review for the full "what belongs inside '
  'Product" reasoning. Requirement Templates, Workflow Templates, '
  'Communication Templates, AI Rules, and (eventually) Applications will '
  'all be separate tables referencing this one''s id — this table has no '
  'knowledge of any of them.';
comment on column public.products.code is
  'Stable, human-assigned, machine-referenceable identifier (e.g. '
  '"personal_loan") — the key every future external surface (website '
  'forms, WhatsApp flows, integration mappings) will hold onto. Practically '
  'immutable by social contract, not database enforcement: renaming after '
  'external surfaces reference it silently breaks them. Deliberately free '
  'text with only a format + uniqueness constraint (see '
  'products_code_format_check below), NOT a fixed enum like every other '
  'taxonomy in this schema (profiles.role, dossier_notes.type, ...) — '
  'Products must be addable by a business administrator without a code '
  'change. Global uniqueness only for now (single-tenant ODL); becomes '
  'unique-per-institution once a future institution_id column lands — a '
  'known, tracked future migration, not modeled here (see the architecture '
  'review''s multi-tenancy section).';
comment on column public.products.name is
  'Locale-keyed display name, e.g. {"es": "Préstamo Personal", "en": '
  '"Personal Loan"}. Business-editable content, deliberately NOT routed '
  'through next-intl''s static message catalogs (those are a developer, '
  'deploy-time mechanism for fixed UI chrome, not business content an '
  'administrator edits at runtime). Must carry every locale in src/i18n/'
  'config.ts''s LOCALES ("es", "en") — see products_name_locales_check.';
comment on column public.products.short_description is
  'Locale-keyed short description, same shape and reasoning as name, for '
  'presentation on future website forms / WhatsApp intake. Nullable — a '
  'draft product may not have one yet. When present, must carry every '
  'locale in LOCALES, same as name — see '
  'products_short_description_locales_check.';
comment on column public.products.status is
  'One of draft / active / inactive. draft = being configured, not '
  'selectable anywhere client-facing. active = live, selectable everywhere. '
  'inactive = retired, cannot be newly selected, but every existing '
  'reference to it (future Applications) must keep working unchanged — '
  'never deleted. Legal transitions: draft->active, active->inactive, '
  'inactive->active (reactivation). active->draft is deliberately NOT '
  'legal — enforced at the Server Action layer '
  '(src/app/(app)/configuracion/actions.ts), not by a database constraint, '
  'matching how dossier_documents_status_transitionable is enforced '
  'app-side today. See products_status_check below for the allowed value '
  'set.';
comment on column public.products.display_order is
  'Presentation-only ordering for product pickers (CRM, future website '
  'form, future WhatsApp menu) — carries no workflow, priority, or '
  'business-rule meaning. Sparse-gap convention (10, 20, 30, ...) so '
  'inserting a product between two others is a single-row update, not a '
  'renumber of everything after it.';
comment on column public.products.status_changed_at is
  'When the product''s status last transitioned. Null until the first '
  'transition (never set at creation, since every product starts in draft '
  'by default with no transition having happened yet). Mirrors dossier_'
  'alerts.resolved_at / dossier_documents.reviewed_at — describes the '
  'current/most recent transition only, not a full history.';
comment on column public.products.status_changed_by_profile_id is
  'Who performed the product''s last status transition — always the '
  'caller''s own getCurrentProfile().id, never client-supplied. Null until '
  'the first transition, same lifecycle as status_changed_at. ON DELETE '
  'RESTRICT, not CASCADE: a profile with product status-change history '
  'cannot be hard-deleted, only deactivated (profiles.active) — matches '
  'every other profile reference in this schema.';
comment on column public.products.created_at is
  'When the product row was created (i.e. entered draft status).';

-- Restricts status to the three values the app currently understands,
-- without promoting it to a Postgres ENUM type — matches the dossier_notes
-- / dossier_alerts / dossier_documents precedent. Guarded with the same
-- re-runnable-migration pg_constraint existence check used throughout this
-- schema (Postgres has no ADD CONSTRAINT IF NOT EXISTS syntax).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'products_status_check'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_status_check
      check (status in ('draft', 'active', 'inactive'));
  end if;
end $$;

-- Lowercase snake_case, reasonable length bound — the format a code-owned
-- identifier (URLs, WhatsApp flow config, integration mappings) should
-- always have. Does not prevent a rename, only malformed values.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'products_code_format_check'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_code_format_check
      check (code ~ '^[a-z][a-z0-9_]{1,59}$');
  end if;
end $$;

-- Every product's name must carry every UI locale this app currently
-- renders in (src/i18n/config.ts's LOCALES) — prevents a product ever
-- displaying blank in a supported locale. Deliberately does not reference
-- SupportedLanguage's broader list (which includes "fr" for chat message
-- translation only, an unrelated concept) — only the UI's actual locales.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'products_name_locales_check'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_name_locales_check
      check (name ? 'es' and name ? 'en');
  end if;
end $$;

-- Same locale-completeness invariant as name, but only enforced when a
-- short_description is actually present (the column itself stays nullable
-- — a draft product may not have written one yet).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'products_short_description_locales_check'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_short_description_locales_check
      check (short_description is null or (short_description ? 'es' and short_description ? 'en'));
  end if;
end $$;

-- status_changed_at and status_changed_by_profile_id are always both null
-- (no transition yet) or both set (at least one transition has happened) —
-- never one without the other. Mirrors dossier_alerts_resolution_state_
-- check's "always write both together" discipline, one pair instead of two
-- states.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'products_status_changed_pair_check'
      and conrelid = 'public.products'::regclass
  ) then
    alter table public.products
      add constraint products_status_changed_pair_check
      check ((status_changed_at is null) = (status_changed_by_profile_id is null));
  end if;
end $$;

-- The two real query shapes: the CRM admin list (every product, in display
-- order, regardless of status) and, once future website/WhatsApp/
-- Application-creation flows exist, "active products, in display order"
-- specifically — recommended in the architecture review's extensibility
-- analysis even though nothing queries it that way yet.
create index if not exists products_display_order_idx
  on public.products (display_order);

create index if not exists products_status_display_order_idx
  on public.products (status, display_order);

-- ============================================================================
-- Row Level Security
-- ============================================================================

-- Enabled with zero policies, same posture as every other real table in
-- this schema: fully locked to both `anon` and `authenticated` until a real
-- permissions model exists. Reads/writes go through the server-only
-- Supabase client in the meantime.
alter table public.products enable row level security;

-- ============================================================================
-- service_role grants
-- ============================================================================

-- Select + insert + update — no delete. Products are never hard-deleted,
-- only moved to inactive (see the status comment above) — matches the
-- "never delete" posture already applied to every other real table in this
-- schema.
grant select, insert, update on public.products to service_role;
