-- ============================================================================
-- Persistent, multi-user, multilingual internal chat
-- ============================================================================
--
-- Overall purpose
-- ----------------
-- This is the relational replacement for src/lib/demo-data/chat.ts — the
-- static, in-memory demo data the chat UI currently reads. It creates the
-- four tables needed for real persistence, multi-user delivery, and
-- multilingual translation of 1:1 conversations: conversations,
-- conversation_members, messages, message_translations.
--
-- Scope (deliberately small — see CHAT_ARCHITECTURE.md and the chat
-- architecture review for the full reasoning behind each boundary):
--   - Direct (1:1) conversations only. No group chat yet.
--   - No message attachments, reactions, voice notes, video calls,
--     presence, or typing indicators yet.
--   - No editing or deleting messages yet.
--   - No Row Level Security policies yet — Supabase Auth doesn't exist in
--     this app yet, so RLS is enabled but left fully locked (see the RLS
--     section below). Reads/writes go through a server-only Supabase
--     client in the meantime, the same pattern already proven for
--     Settings > Users (src/lib/supabase/server.ts).
--
-- Identity: every table stores plain `profiles.id` UUIDs — never
-- `legacy_id`. `legacy_id` exists solely to bridge the CRM's older demo
-- screens (clients, applications, alerts, documents, notes) that still
-- hardcode ids like "u-001"; this chat schema is new and has no such
-- dependents, so it never references `legacy_id` at all. Translating a
-- demo "u-00N" id into a real `profiles.id` happens as a single lookup at
-- the application boundary, not in this schema.
--
-- Reuse: nothing in this migration is finance- or ODL-specific. It's meant
-- to be reused as-is (schema and code) across future Makom deployments —
-- each customer gets its own isolated Supabase project/database (see the
-- chat architecture review for the cross-product-reuse vs. multi-tenancy
-- decision), not a shared database with a tenant column. If Makom Finance
-- is ever turned into a true multi-tenant product, that's a separate,
-- later migration — not something this schema tries to anticipate today.
--
-- Future planned extensions are called out table-by-table below, at the
-- point each one would actually attach — so a future developer can see
-- not just what exists today, but where the deliberately-deferred pieces
-- (group chat, read receipts, message editing/deletion, attachments,
-- alternate translation providers) are expected to land.

-- ============================================================================
-- conversations
-- ============================================================================
--
-- Purpose: one row per conversation. Holds a stable identity — its `id`
-- stays valid even if every message under it is later deleted, and even
-- if participants are deactivated.

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'direct',
  direct_member_low uuid,
  direct_member_high uuid,
  created_at timestamptz not null default now()
);

comment on table public.conversations is
  'A conversation between profiles. Only "direct" (1:1) is used today; '
  '"type" exists so "group" can be added later without restructuring this '
  'table.';
comment on column public.conversations.type is
  '''direct'' or (later) ''group''. Only ''direct'' is created by the app today.';
comment on column public.conversations.direct_member_low is
  'Lower of the two participant profile ids (sorted). Only set when '
  'type = ''direct'' — exists purely to let the database prevent duplicate '
  '1:1 conversations between the same pair; unused for future group chat.';
comment on column public.conversations.direct_member_high is
  'Higher of the two participant profile ids (sorted). See direct_member_low.';

-- Enforces that the app always stores the pair in normalized (low < high)
-- order — without this, (A,B) and (B,A) would both pass the unique index
-- below as "different" pairs, silently allowing duplicate conversations.
alter table public.conversations
  add constraint conversations_direct_pair_ordered
  check (
    type <> 'direct'
    or (
      direct_member_low is not null
      and direct_member_high is not null
      and direct_member_low < direct_member_high
    )
  );

-- The actual duplicate-prevention: two direct conversations can never exist
-- for the same normalized pair. Enforced atomically by Postgres on insert,
-- so it's race-safe even if both participants try to start a chat at once.
create unique index conversations_direct_pair_unique
  on public.conversations (direct_member_low, direct_member_high)
  where type = 'direct';

-- Future planned extensions:
--   - Group chat: add 'group' as a second `type` value. `direct_member_low/
--     high` simply stay null for those rows; group membership is already
--     fully expressed by conversation_members without any change there.
--   - A `title`/`avatar_url` column would likely arrive alongside group
--     chat (1:1 conversations don't need either — the other member's own
--     profile serves that purpose). Not added now because there's no
--     group-chat consumer yet.

-- ============================================================================
-- conversation_members
-- ============================================================================
--
-- Purpose: junction table — which profiles belong to which conversation,
-- and (for unread counts) when each of them last read it.

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_at timestamptz,
  primary key (conversation_id, profile_id)
);

comment on table public.conversation_members is
  'Junction table: which profiles belong to which conversation. Already '
  'shaped to support group chat later — nothing here is 1:1-specific.';
comment on column public.conversation_members.last_read_at is
  'When this member last opened this conversation. Sufficient for unread '
  'counts (messages created after this timestamp, from someone else) — a '
  'separate message_reads table is deferred until per-message read '
  'receipts are actually needed.';

-- The primary key alone doesn't efficiently serve "list my conversations"
-- (profile_id isn't its leading column) — this index is what makes that
-- query fast.
create index conversation_members_profile_id_idx
  on public.conversation_members (profile_id);

-- Future planned extensions:
--   - Per-message read receipts (e.g. "seen by" in a future group chat):
--     add a separate message_reads(message_id, profile_id, read_at) table
--     rather than overloading last_read_at, which should stay a cheap,
--     single-row-per-member summary.
--   - A `role` column (e.g. 'member' / 'admin') would only matter once
--     group chat needs membership permissions — not meaningful for 1:1.

-- ============================================================================
-- messages
-- ============================================================================
--
-- Purpose: the original text a sender typed, preserved permanently.
-- Deliberately does not carry translated text or per-language state —
-- that's message_translations' job, kept separate so the original is
-- never at risk of being overwritten or conflated with a derived copy.

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_profile_id uuid not null references public.profiles(id) on delete restrict,
  original_text text not null,
  original_language text not null,
  detected_source_language text,
  created_at timestamptz not null default now()
);

comment on table public.messages is
  'The original message text, preserved permanently. Translations live '
  'separately in message_translations — never overwritten or duplicated '
  'here.';
comment on column public.messages.id is
  'Defaults to gen_random_uuid() as a safety net (e.g. for seeding), but '
  'production sends generate this client-side (crypto.randomUUID()) and '
  'pass it explicitly, so the client can recognize the realtime echo of '
  'its own optimistic insert instead of appending a duplicate.';
comment on column public.messages.sender_profile_id is
  'ON DELETE RESTRICT, not CASCADE: a profile with message history cannot '
  'be hard-deleted, only deactivated (profiles.active) — matches how this '
  'app already treats deactivation elsewhere, and keeps "originals are '
  'permanent" actually true.';
comment on column public.messages.original_language is
  'Plain text, not an enum — matches profiles.role / preferred_language. '
  'Adding a supported language never requires a migration.';
comment on column public.messages.detected_source_language is
  'What DeepL actually detected, when it differs from original_language '
  '(e.g. the sender typed in a different language than their configured '
  'preference). Informational only — original_language keeps its meaning '
  'everywhere else.';

-- The hot path: loading one conversation's history in order.
create index messages_conversation_id_created_at_idx
  on public.messages (conversation_id, created_at);

-- Future planned extensions:
--   - Editing: add a nullable `edited_at timestamptz`. Deferred rather
--     than added speculatively now — it's a trivial, zero-risk column to
--     add the moment editing is actually built.
--   - Soft deletion: add a nullable `deleted_at timestamptz`, same
--     reasoning as edited_at. A hard DELETE is not the intended mechanism
--     even later, to keep translation/read-count history consistent.
--   - Attachments: a separate message_attachments(message_id,
--     storage_path, ...) table referencing messages.id — purely additive,
--     nothing here needs to change to support it.
--   - Reactions: same shape as attachments — an additive
--     message_reactions(message_id, profile_id, emoji) table later.

-- ============================================================================
-- message_translations
-- ============================================================================
--
-- Purpose: cached translations of a message's original_text, one row per
-- (message, target language). This is what makes "one original -> many
-- translations" possible without reshaping `messages` itself, and what
-- lets a translation be reused instead of re-requested from the provider.

create table if not exists public.message_translations (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages(id) on delete cascade,
  target_language text not null,
  translated_text text not null,
  provider text not null default 'deepl',
  created_at timestamptz not null default now(),
  unique (message_id, target_language)
);

comment on table public.message_translations is
  'One original message can have many cached translations. Absence of a '
  'row means "not translated yet" — a failed translation attempt is never '
  'persisted here, only confirmed successes, so a retry is just re-running '
  'the same request.';
comment on column public.message_translations.provider is
  'Which provider produced this translation (default ''deepl'' today). A '
  'column, not a hardcoded assumption — a different provider later is a '
  'new value, not a schema change.';

-- No extra index needed: the unique constraint above already indexes
-- (message_id, target_language), which also serves "all translations for
-- message X" efficiently since message_id is its leading column.

-- Future planned extensions:
--   - Additional providers (e.g. an in-house/AI-assistant translation
--     path): just a new `provider` value on new rows — no schema change.
--   - Quality/confidence metadata from a provider, if one is ever
--     supplied, would be an additive nullable column here, not a new
--     table.

-- ============================================================================
-- Row Level Security
-- ============================================================================

-- Enabled with zero policies on all four tables, same posture as profiles:
-- fully locked to both `anon` and `authenticated` until real Supabase Auth
-- exists to enforce per-user membership checks correctly. Reads and writes
-- go through the server-only Supabase client in the meantime (see
-- src/lib/supabase/server.ts) — the same pattern already proven for
-- Settings > Users.
--
-- Future planned extension: once Supabase Auth exists, replace this with
-- real per-user policies — conversations/messages/message_translations
-- readable only by conversation_members of that conversation; messages
-- insertable only where sender_profile_id = the caller's own profile.
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_translations enable row level security;

-- ============================================================================
-- service_role grants
-- ============================================================================

-- Learned from profiles: this project does not automatically grant
-- service_role table privileges on newly created tables, so it has to be
-- explicit here or every server-side read/write 403s with "permission
-- denied" the same way profiles did before its grant was added. Least
-- privilege per table, not a blanket ALL — matches what the current
-- server-only chat layer actually needs to do:
--   conversations:         find/create           -> select, insert
--   conversation_members:  find/create, mark read -> select, insert, update
--   messages:               send/read              -> select, insert
--   message_translations:   cache/read              -> select, insert
grant select, insert on public.conversations to service_role;
grant select, insert, update on public.conversation_members to service_role;
grant select, insert on public.messages to service_role;
grant select, insert on public.message_translations to service_role;
