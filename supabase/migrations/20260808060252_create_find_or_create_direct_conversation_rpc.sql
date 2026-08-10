-- ============================================================================
-- find_or_create_direct_conversation(profile_a, profile_b)
-- ============================================================================
--
-- Why it exists
-- -------------
-- Creating a direct (1:1) conversation is really three writes: the
-- conversation row, and a conversation_members row for each participant.
-- Doing those as three independent statements from application code risks
-- a partial write — e.g. the conversation gets created but one member row
-- fails to insert, leaving an orphaned conversation nobody can find their
-- way back into. This function makes all three one atomic unit, callable
-- from the server-only chat service as a single RPC.
--
-- Atomicity guarantee
-- --------------------
-- A PL/pgSQL function body executes as part of the single statement that
-- calls it — there is no sub-transaction boundary inside this function.
-- If anything raises an unhandled exception partway through (the final
-- conversation_members insert, for instance), every effect the function
-- already had — including the earlier conversations insert — rolls back
-- automatically. Either the complete operation lands, or none of it does.
--
-- Race safety
-- -----------
-- Two concurrent calls for the same profile pair are safe: the pair is
-- normalized (least/greatest) before touching the table, the insert relies
-- on the existing conversations_direct_pair_unique partial index via
-- `on conflict ... do nothing`, and if this call's insert is the one that
-- gets skipped (because a concurrent call won the race), a re-select picks
-- up whichever row actually won. Both calls return the same conversation id.
--
-- Why SECURITY INVOKER
-- ---------------------
-- This function only ever needs privileges service_role already holds
-- directly (insert/select on conversations, insert on
-- conversation_members) — there's no reason for it to run as an elevated
-- owner identity. SECURITY DEFINER is how privilege-escalation bugs happen
-- when it isn't actually needed, so it's deliberately not used here.
-- `set search_path = public, pg_temp` is standard defense-in-depth for any
-- plpgsql function regardless of definer/invoker, not a signal that this
-- one is unusually risky.
--
-- Why PUBLIC execute is revoked
-- -------------------------------
-- Postgres grants EXECUTE on new functions to PUBLIC by default — unlike
-- tables, which start with no grants at all. Left alone, that would let
-- anyone holding the publishable key call this function directly via
-- PostgREST's /rest/v1/rpc/find_or_create_direct_conversation endpoint and
-- create conversations between arbitrary profile pairs straight from the
-- browser, bypassing the server-only boundary entirely. The whole
-- CREATE FUNCTION + REVOKE + GRANT sequence below is wrapped in one
-- transaction specifically so there is never a window — not even between
-- two statements in this migration — where the default PUBLIC grant is
-- live.
--
-- Current intended caller
-- ------------------------
-- The server-only chat service (src/lib/services/chat.ts, using
-- SUPABASE_SECRET_KEY via src/lib/supabase/server.ts) — the same
-- server-only boundary already proven for Settings > Users. Only
-- service_role is granted EXECUTE. Not intended to be called by `anon` or
-- `authenticated` at any point while RLS remains fully locked on these
-- tables.
--
-- This is an internal database primitive, not a public API. It must never
-- be called directly from browser/client code — the PUBLIC execute revoke
-- below is what makes that unenforceable path actually impossible, not
-- just a convention. The only sanctioned caller is the server-only chat
-- service, via the service_role connection.

begin;

create or replace function public.find_or_create_direct_conversation(
  profile_a uuid,
  profile_b uuid
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_low uuid := least(profile_a, profile_b);
  v_high uuid := greatest(profile_a, profile_b);
  v_conversation_id uuid;
  v_profile_count int;
begin
  if profile_a = profile_b then
    raise exception 'find_or_create_direct_conversation: profile_a and profile_b must be different profiles';
  end if;

  -- Validate both profiles actually exist before attempting any insert —
  -- a bad id here is a caller bug (e.g. a failed legacy_id resolution
  -- upstream), and should fail loudly here rather than produce a
  -- conversation/membership row pointing at nothing.
  select count(*) into v_profile_count
  from public.profiles
  where id in (profile_a, profile_b);

  if v_profile_count <> 2 then
    raise exception 'find_or_create_direct_conversation: profile_a (%) and profile_b (%) must both reference existing profiles', profile_a, profile_b;
  end if;

  -- Fast path: the conversation already exists.
  select id into v_conversation_id
  from public.conversations
  where type = 'direct'
    and direct_member_low = v_low
    and direct_member_high = v_high;

  if v_conversation_id is not null then
    return v_conversation_id;
  end if;

  -- Not found — create it. ON CONFLICT handles the race where another
  -- concurrent call creates the same pair between our SELECT above and
  -- this INSERT: our insert is skipped rather than erroring, and the
  -- re-SELECT below picks up whichever row actually won.
  insert into public.conversations (type, direct_member_low, direct_member_high)
  values ('direct', v_low, v_high)
  on conflict (direct_member_low, direct_member_high) where type = 'direct'
  do nothing
  returning id into v_conversation_id;

  if v_conversation_id is null then
    select id into v_conversation_id
    from public.conversations
    where type = 'direct'
      and direct_member_low = v_low
      and direct_member_high = v_high;
  end if;

  if v_conversation_id is null then
    raise exception 'find_or_create_direct_conversation: failed to resolve conversation for pair (%, %)', v_low, v_high;
  end if;

  insert into public.conversation_members (conversation_id, profile_id)
  values (v_conversation_id, profile_a), (v_conversation_id, profile_b)
  on conflict (conversation_id, profile_id) do nothing;

  return v_conversation_id;
end;
$$;

revoke execute on function public.find_or_create_direct_conversation(uuid, uuid) from public;
grant execute on function public.find_or_create_direct_conversation(uuid, uuid) to service_role;

commit;
