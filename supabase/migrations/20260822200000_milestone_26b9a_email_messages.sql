-- ============================================================================
-- MILESTONE 26B-9A — SYNCHRONISED MAILBOX
-- ============================================================================
--
-- ODL works out of one cPanel mailbox (prestamo@odlfinanciera.com) reached over
-- IMAP. This is the CRM's own copy of what arrived there: read-only ingestion,
-- never a second mail server.
--
-- ----------------------------------------------------------------------------
-- IDEMPOTENCY IS THE WHOLE POINT OF THIS TABLE'S KEYS
-- ----------------------------------------------------------------------------
-- Sync is a button a person presses, so it WILL be pressed twice. Two
-- independent unique constraints make a duplicate unrepresentable rather than
-- merely unlikely:
--
--   (mailbox, folder, uid_validity, imap_uid)
--       Always available. UIDVALIDITY is part of the key because an IMAP UID is
--       only unique WITHIN a validity epoch — if the server ever reissues the
--       mailbox, UIDs restart from 1 and a key without it would collide across
--       two genuinely different messages.
--
--   (mailbox, message_id) WHERE message_id IS NOT NULL
--       Catches the same RFC message arriving under a new UID (a re-delivery,
--       or a folder the customer moved it through). Partial, because a
--       malformed message may carry no Message-ID at all and NULLs must not
--       collapse into one another — those rows fall back to the UID key.
--
-- ----------------------------------------------------------------------------
-- LINKAGE IS A CLAIM ABOUT IDENTITY, SO ITS STATES ARE CONSTRAINED
-- ----------------------------------------------------------------------------
-- `match_status` and `linked_client_id` cannot disagree: a linked status
-- requires a client, and an unlinked or ambiguous one forbids it. `ambiguous`
-- is deliberately NOT a link — it records that several accessible clients share
-- the sender address, which is a question for a human, not an answer.
--
-- MANUAL WINS AND SAYS SO. If staff correct an automatic match the row becomes
-- `manual_linked` and keeps who did it and when, so "the computer decided this"
-- and "a person decided this" never look alike.
--
-- ----------------------------------------------------------------------------
-- NO BRANCH COLUMN, ON PURPOSE
-- ----------------------------------------------------------------------------
-- An unlinked message belongs to nobody yet — it may be a supplier, a stranger
-- or spam — so it has no branch to be scoped by. A LINKED message derives its
-- scope from the client it points at, exactly as dossier_alerts does. Scope is
-- therefore enforced by joining to `clients`, and the unlinked queue is
-- restricted by capability instead.
-- ============================================================================

create table if not exists public.email_messages (
  id uuid primary key default gen_random_uuid(),

  -- WHERE IT CAME FROM ------------------------------------------------------
  mailbox      text   not null,
  folder       text   not null default 'INBOX',
  imap_uid     bigint not null,
  uid_validity bigint not null,
  message_id   text,

  -- 9A ingests only. `direction` exists so 26B-9B's sent mail lands in the
  -- same timeline rather than a parallel table.
  direction text not null default 'inbound'
    check (direction in ('inbound', 'outbound')),

  -- WHAT IT SAYS ------------------------------------------------------------
  from_address text not null,
  from_name    text,
  to_addresses text[] not null default '{}',
  cc_addresses text[] not null default '{}',
  subject      text,
  body_text    text,
  body_html    text,
  received_at  timestamptz not null,

  has_attachments  boolean not null default false,
  attachment_count integer not null default 0 check (attachment_count >= 0),

  -- WHO IT IS ABOUT ---------------------------------------------------------
  linked_client_id      uuid references public.clients(id)      on delete restrict,
  linked_application_id uuid references public.applications(id) on delete restrict,
  match_status text not null default 'unlinked'
    check (match_status in ('unlinked', 'auto_linked', 'manual_linked', 'ambiguous')),
  linked_by_profile_id uuid references public.profiles(id) on delete restrict,
  linked_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A status and a link that contradict each other would make every downstream
  -- read ambiguous, so the pair is constrained rather than merely conventional.
  constraint email_messages_link_state_check check (
    (match_status in ('unlinked', 'ambiguous') and linked_client_id is null)
    or
    (match_status in ('auto_linked', 'manual_linked') and linked_client_id is not null)
  ),

  -- A manual decision is attributable by definition.
  constraint email_messages_manual_attribution_check check (
    match_status <> 'manual_linked'
    or (linked_by_profile_id is not null and linked_at is not null)
  ),

  -- An application link only means something alongside the client it belongs
  -- to. 9A never sets this; the constraint keeps 9B honest.
  constraint email_messages_application_requires_client_check check (
    linked_application_id is null or linked_client_id is not null
  )
);

create unique index if not exists email_messages_mailbox_uid_key
  on public.email_messages (mailbox, folder, uid_validity, imap_uid);

create unique index if not exists email_messages_mailbox_message_id_key
  on public.email_messages (mailbox, message_id)
  where message_id is not null;

-- The inbox is read newest-first, and the two operational filters are the
-- unlinked queue and one client's correspondence.
create index if not exists email_messages_received_at_idx
  on public.email_messages (received_at desc);
create index if not exists email_messages_match_status_idx
  on public.email_messages (match_status);
create index if not exists email_messages_linked_client_idx
  on public.email_messages (linked_client_id)
  where linked_client_id is not null;

-- ============================================================================
-- ATTACHMENTS — METADATA ONLY IN 26B-9A
-- ============================================================================
--
-- Filename, type and size, and deliberately NOT the bytes. Downloading
-- attachments means deciding where they live and who may open them, and doing
-- that badly is how an unverified file becomes loan evidence. Nothing here can
-- become requirement-slot evidence: there is no storage path to promote and no
-- foreign key to a requirement slot. See 26B-9B.
-- ============================================================================

create table if not exists public.email_attachments (
  id uuid primary key default gen_random_uuid(),
  email_message_id uuid not null
    references public.email_messages(id) on delete cascade,
  filename   text,
  mime_type  text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  created_at timestamptz not null default now()
);

create index if not exists email_attachments_message_idx
  on public.email_attachments (email_message_id);

-- ============================================================================
-- SYNC STATE — ONE ROW PER MAILBOX, AND NO CREDENTIALS
-- ============================================================================
--
-- Enough to answer "when did this last work?" on the Email page, and nothing
-- more. ODL has one operational mailbox; this is not a provider platform.
--
-- THE PASSWORD IS NOT HERE AND NEVER WILL BE. It lives in the server
-- environment only. This table stores outcomes, not credentials.
-- ============================================================================

create table if not exists public.email_sync_state (
  mailbox text primary key,
  last_attempt_at    timestamptz,
  last_success_at    timestamptz,
  last_imported_count integer,
  last_skipped_count  integer,
  /** A short machine code such as 'auth_failed' — never a raw server string. */
  last_error_code text,
  updated_at timestamptz not null default now()
);

-- RLS ON, ZERO POLICIES — the project-wide posture. Every read and write goes
-- through server code holding the service role; the browser reaches none of
-- these tables directly.
alter table public.email_messages   enable row level security;
alter table public.email_attachments enable row level security;
alter table public.email_sync_state  enable row level security;

revoke all on public.email_messages    from anon, authenticated;
revoke all on public.email_attachments from anon, authenticated;
revoke all on public.email_sync_state  from anon, authenticated;
