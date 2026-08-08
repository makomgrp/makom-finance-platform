-- Milestone 2 of the Supabase Auth migration: adds the first — and, for
-- this milestone, the only — RLS policy on `profiles`. Deliberately narrow:
-- an authenticated user may SELECT their own profile row and nothing else.
--
-- This exists specifically to unblock src/lib/auth/get-current-profile.ts,
-- whose query (profiles where auth_user_id = auth.uid()) would otherwise
-- always come back empty even for a fully valid session — `profiles` has
-- had RLS enabled with zero policies since it was created, so every read
-- through the Authenticated Server Client returned nothing regardless of
-- who was asking. This policy is the minimum needed to make that query
-- return real data for the caller's own row, nothing more.
--
-- Explicitly NOT included, on purpose, and deferred to the later per-table
-- RLS milestone:
--   - No policy letting a user read anyone else's profile row (e.g. for
--     Settings > Users' "list everyone" view — that screen keeps reading
--     through the Admin Client for now, per the Auth migration plan).
--   - No INSERT/UPDATE/DELETE policy on `profiles` at all.
--   - No policy on any other table — conversations, conversation_members,
--     messages, and message_translations all remain fully locked to both
--     `anon` and `authenticated`, exactly as before this migration.
-- `anon` continues to get nothing from `profiles`, exactly as before.

create policy "profiles_select_own"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = auth_user_id);

comment on policy "profiles_select_own" on public.profiles is
  'Milestone 2 of the Supabase Auth migration: lets a signed-in user read '
  'only their own profiles row (auth.uid() = auth_user_id). Deliberately '
  'the only profiles policy for now — see the Auth migration plan before '
  'adding another.';
