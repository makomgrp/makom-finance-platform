-- ============================================================================
-- MILESTONE 26B-9B — THE SAME TIMELINE, BOTH DIRECTIONS
-- ============================================================================
--
-- 26B-9A shaped `email_messages` around what IMAP hands you: every row had an
-- IMAP UID, a UIDVALIDITY and a received_at, all NOT NULL. An email ODL SENDS
-- has none of those — it was never in a folder and was never received — so the
-- table has to describe both halves of a conversation rather than only the
-- half that arrives.
--
-- ONE TABLE, NOT TWO. A reply belongs directly under the message it answers,
-- and a customer's correspondence is one list. Splitting sent mail into its own
-- table would mean every read that matters became a UNION, and the two halves
-- would drift.
--
-- ----------------------------------------------------------------------------
-- occurred_at IS THE ORDERING KEY
-- ----------------------------------------------------------------------------
-- Inbound rows are ordered by when they arrived, outbound by when they left.
-- Rather than teach every query that rule, a STORED generated column resolves
-- it once. Generated rather than a plain column so it cannot fall out of step
-- with the two values it is derived from.
--
-- ----------------------------------------------------------------------------
-- IDEMPOTENCY FOR SENDING IS NOT THE SAME PROBLEM AS FOR SYNCING
-- ----------------------------------------------------------------------------
-- Re-importing a message twice is harmless and invisible. Sending twice puts a
-- second real email in a customer's mailbox, and no later cleanup can retract
-- it. `send_key` is a caller-supplied token, unique, so a double-submitted form
-- collides at the database instead of at a customer.
-- ============================================================================

-- An outbound message has no IMAP identity. NULLs do not collide in a unique
-- index, so many outbound rows coexist under the existing key; the index is
-- made partial anyway so its intent is stated rather than inferred.
alter table public.email_messages alter column imap_uid     drop not null;
alter table public.email_messages alter column uid_validity drop not null;
alter table public.email_messages alter column received_at  drop not null;

drop index if exists public.email_messages_mailbox_uid_key;
create unique index email_messages_mailbox_uid_key
  on public.email_messages (mailbox, folder, uid_validity, imap_uid)
  where imap_uid is not null;

alter table public.email_messages
  add column if not exists sent_at    timestamptz,
  add column if not exists bcc_addresses text[] not null default '{}',
  add column if not exists sent_by_profile_id uuid references public.profiles(id) on delete restrict,
  -- What this message answers, and what it forwards. Two columns rather than a
  -- thread table: the CRM only needs to know "this reply belongs to that
  -- message", not to reconstruct arbitrary conversation trees.
  add column if not exists reply_to_email_id       uuid references public.email_messages(id) on delete set null,
  add column if not exists forwarded_from_email_id uuid references public.email_messages(id) on delete set null,
  -- The RFC header actually emitted, kept so the stored record matches the mail
  -- that left rather than being re-derived later.
  add column if not exists in_reply_to text,
  add column if not exists send_key text;

-- A row must be one thing or the other, and must carry the timestamp that
-- direction implies. Without this an outbound row with no sent_at would sort
-- to the bottom of every list and look like a bug in the UI.
alter table public.email_messages
  drop constraint if exists email_messages_direction_shape_check;
alter table public.email_messages
  add constraint email_messages_direction_shape_check check (
    (direction = 'inbound'  and received_at is not null)
    or
    (direction = 'outbound' and sent_at is not null and imap_uid is null)
  );

-- Generated, so it cannot disagree with the columns it summarises.
alter table public.email_messages
  add column if not exists occurred_at timestamptz
  generated always as (coalesce(sent_at, received_at)) stored;

create index if not exists email_messages_occurred_at_idx
  on public.email_messages (occurred_at desc);

-- THE DOUBLE-SEND GUARD. Partial because only outbound rows carry a key.
create unique index if not exists email_messages_send_key_key
  on public.email_messages (send_key)
  where send_key is not null;

create index if not exists email_messages_reply_to_idx
  on public.email_messages (reply_to_email_id)
  where reply_to_email_id is not null;

comment on column public.email_messages.send_key is
  'Caller-supplied idempotency token for outbound sends. Unique, so a double-submitted compose collides here rather than delivering twice.';
