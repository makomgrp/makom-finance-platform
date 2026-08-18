-- ============================================================================
-- DEVELOPMENT-ONLY seed data for the dossier notes module
-- ============================================================================
--
-- This is fixture data for local/dev verification of the notes read/write
-- path (reload persistence, empty vs. populated states) — it is NOT part
-- of the application's real data model and MUST be deleted before
-- production delivery. Do not build any logic that assumes this data
-- exists.
--
-- Removal before production:
--   delete from public.dossier_notes
--   where id in (
--     '7a1e5c2a-1b1a-4b8b-9d1a-9a2f6f8c9101',
--     '7a1e5c2a-1b1a-4b8b-9d1a-9a2f6f8c9102'
--   );
--
-- Seeds two notes on client "cl-001" (Juan Pérez — the client used
-- throughout the Auth migration's own live verification), authored by the
-- two real dev profiles already used across prior milestones:
--   Gabriel Herrera (u-001)
--   Marisol Duarte  (u-002)
--
-- Author is resolved from the existing demo "u-00N" identifier via
-- profiles.legacy_id — the same one-time boundary lookup used by
-- seed_chat_dev.sql. client_legacy_id is stored as-is ("cl-001") per the
-- Milestone 6 architecture review — there is no real clients table yet to
-- resolve it against.
--
-- Note ids are fixed, real UUIDs (not left to gen_random_uuid()) purely so
-- this script is safely re-runnable via `on conflict (id) do nothing` —
-- they carry no other meaning.
--
-- Wrapped in a single transaction with a preflight check, so a missing
-- prerequisite profile aborts the whole seed instead of leaving partial
-- data behind.

begin;

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.profiles where legacy_id = 'u-001';
  if v_count <> 1 then
    raise exception 'Dossier notes dev seed aborted: expected exactly 1 profile with legacy_id = ''u-001'' (Gabriel), found %', v_count;
  end if;

  select count(*) into v_count from public.profiles where legacy_id = 'u-002';
  if v_count <> 1 then
    raise exception 'Dossier notes dev seed aborted: expected exactly 1 profile with legacy_id = ''u-002'' (Marisol), found %', v_count;
  end if;
end $$;

insert into public.dossier_notes (id, client_legacy_id, author_profile_id, body, type, priority, created_at)
select
  '7a1e5c2a-1b1a-4b8b-9d1a-9a2f6f8c9101',
  'cl-001',
  gabriel.id,
  'Seed de desarrollo: nota persistente de prueba para verificar recarga.',
  'seguimiento',
  'media',
  now() - interval '2 hours'
from public.profiles gabriel
where gabriel.legacy_id = 'u-001'
on conflict (id) do nothing;

insert into public.dossier_notes (id, client_legacy_id, author_profile_id, body, type, priority, created_at)
select
  '7a1e5c2a-1b1a-4b8b-9d1a-9a2f6f8c9102',
  'cl-001',
  marisol.id,
  'Seed de desarrollo: segunda nota para verificar orden cronológico.',
  'general',
  'baja',
  now() - interval '1 hour'
from public.profiles marisol
where marisol.legacy_id = 'u-002'
on conflict (id) do nothing;

commit;
