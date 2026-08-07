# Chat module architecture — demo phase and Supabase plan

This document describes how the current in-memory demo chat (`/chat`) is
structured and how it will be wired to Supabase and a real translation
provider in a later phase. Nothing described here is installed or configured
yet — this is a plan, not migrations.

## Current state (this phase)

- All chat state lives in `ChatView` (`src/components/chat/chat-view.tsx`)
  component state, seeded from `src/lib/demo-data/chat.ts`. It resets on page
  reload. No `localStorage` persistence — that was intentionally avoided so
  nobody mistakes it for a real data store.
- `src/lib/services/translation.ts` defines the `translateMessage()` contract
  the UI already calls conceptually. Its current body is a demo mock: same
  language passes through, cross-language always resolves to `pending` (never
  a fabricated translation).
- Preloaded demo messages carry hand-written translations directly on the
  message object (`translations.en/es/fr`) so the UI has real bilingual
  content to demonstrate, without pretending a live API produced them.

## Future Supabase schema

```
profiles
  id                uuid primary key references auth.users(id)
  full_name         text
  role              text
  preferred_language text  -- 'en' | 'es' | 'fr' | ... (SupportedLanguage)
  active            boolean

conversations
  id           uuid primary key
  created_at   timestamptz

conversation_members
  conversation_id  uuid references conversations(id)
  user_id          uuid references profiles(id)
  primary key (conversation_id, user_id)

messages
  id               uuid primary key
  conversation_id  uuid references conversations(id)
  sender_id        uuid references profiles(id)
  original_text    text
  original_language text
  created_at       timestamptz
  read_at          timestamptz null

message_translations
  message_id   uuid references messages(id)
  language     text
  text         text
  primary key (message_id, language)
```

Notes on the mapping from the current TypeScript types
(`src/types/chat-message.ts`):

- `ChatMessage.translations` (an in-memory `Partial<Record<SupportedLanguage, string>>`)
  becomes the `message_translations` table — one row per language, populated
  lazily as translations complete instead of all at once.
- `ChatMessage.recipientId` exists in the demo model because chat is 1:1 only.
  With `conversation_members` in place, "recipient" becomes "the other member
  of this conversation" and the explicit field can be dropped.
- `readAt` moves from a single column on `messages` to either a column (as
  sketched above, fine for 1:1) or a `message_reads(message_id, user_id, read_at)`
  join table if group chat is ever introduced (out of scope today).

## Row Level Security (RLS) — backend responsibility

None of this is implemented on the frontend today; the current UI only
filters `USERS` by `active` client-side as a UX nicety, **not** as security.
Real enforcement must happen in Postgres via RLS once Supabase is connected:

1. **Membership-only reads**: a `select` policy on `messages` and
   `message_translations` that joins through `conversation_members` and
   requires `auth.uid()` to be a member of the message's conversation.
2. **Inactive users cannot send**: an `insert` policy on `messages` requiring
   the sender's `profiles.active = true`.
3. **No blanket admin access**: administrators do **not** get an RLS bypass
   for private conversation content. If support/moderation access is ever
   needed, it should be an explicit, audited exception — not a default.
4. **Translations follow the same membership rule** as their parent message.

## Real translation provider (connected)

`translateMessage()` in `src/lib/services/translation.ts` now calls DeepL for
every message composed live during a session (preloaded demo messages are
untouched — they keep their hand-written `translations`). The call chain:

- `translateMessage()` runs in the browser (it's imported from the "use
  client" `chat-view.tsx`) but never touches DeepL directly. It `fetch()`s
  our own `POST /api/translate` Route Handler (`src/app/api/translate/route.ts`).
- The Route Handler is the only code that reads `process.env.DEEPL_API_KEY`
  and calls DeepL's Free-tier endpoint (`api-free.deepl.com`). The key never
  reaches the client bundle or a browser request.
- `source_lang` is intentionally omitted on the DeepL call — the server lets
  DeepL auto-detect the actual written language rather than trusting the
  sender's configured `preferredLanguage`, so a message typed in a different
  language than configured still translates correctly. When the detected
  language differs from `originalLanguage`, it's stored on the message as
  `detectedLanguage` (additive — `originalLanguage` keeps its original
  meaning everywhere else).
- On send, the message is shown immediately with empty `translations`; the
  DeepL request happens in the background and patches `translations` in on
  success. The UI shows "Traduciendo…" while in flight and "Traducción no
  disponible" (with a retry) on failure — the original message is never
  lost either way.
- Once Supabase is connected, `message_translations` rows replace the
  in-memory `translations` map, and the Route Handler's response becomes the
  thing that gets persisted instead of a `setState` call — no change to the
  DeepL call itself.

## Not in this phase (unchanged from the spec)

Groups/channels, calls, voice notes, document upload via chat, push
notifications, WhatsApp integration, and any Supabase/real-AI wiring are all
explicitly deferred — this module is scoped to 1:1 private chat with
multi-language display only.
