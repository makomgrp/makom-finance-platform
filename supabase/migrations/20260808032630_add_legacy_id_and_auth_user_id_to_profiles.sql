-- Prepares `profiles` for (a) a gradual, non-destructive migration off the
-- static demo data, and (b) a future Supabase Auth integration — without
-- implementing either yet. `profiles.id` remains the real, independently
-- generated UUID primary key; nothing about it changes here.

alter table public.profiles
  add column legacy_id text unique,
  add column auth_user_id uuid unique;

comment on column public.profiles.legacy_id is
  'Temporary bridge to the existing demo-data string ids (e.g. "u-001"), '
  'so demo records elsewhere in the app can keep referencing these people '
  'by their old id while the rest of the schema migrates gradually. Not '
  'meant to be permanent — drop once nothing references it anymore.';

comment on column public.profiles.auth_user_id is
  'Reserved for linking a profile to its Supabase Auth identity '
  '(auth.users.id), once Auth is implemented. Intentionally not a foreign '
  'key yet — see the migration plan for why.';

-- No RLS policy is added here on purpose. `profiles` stays fully locked to
-- both `anon` and `authenticated` — this is an internal financial CRM's
-- staff directory (names, emails, roles), and it should not be readable
-- directly from the browser before real authentication exists. The
-- pre-auth Settings > Users screen reads this table through a server-only
-- Supabase client instead (see the migration plan) that bypasses RLS
-- deliberately and only ever runs on the server.
