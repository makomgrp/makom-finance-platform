-- ============================================================================
-- DEVELOPMENT-ONLY seed data for the chat module
-- ============================================================================
--
-- This is fixture data for local/dev verification of the read path, the
-- send path, and the real DeepL translation pipeline — it is NOT part of
-- the application's real data model and MUST be deleted before production
-- delivery. Do not build any logic that assumes this data exists.
--
-- Seeds two direct conversations:
--   Gabriel Herrera (u-001, en) <-> Marisol Duarte (u-002, es)
--   Gabriel Herrera (u-001, en) <-> Lucía Batista   (u-005, fr)
--
-- Only ORIGINAL messages are seeded. No message_translations rows are
-- inserted here on purpose — translations must come from the real DeepL
-- flow when these conversations are opened in the running app, so this
-- seed data doubles as an end-to-end test of the actual translation
-- pipeline, not a copy of pre-written text.
--
-- Sender/recipient are resolved from the existing demo "u-00N" identifiers
-- via profiles.legacy_id — the same one-time boundary lookup the chat
-- migration plan uses everywhere else. Message ids are fixed, real UUIDs
-- (not left to gen_random_uuid()) purely so this script is safely
-- re-runnable via `on conflict (id) do nothing` — they carry no other
-- meaning.
--
-- Wrapped in a single transaction with a preflight check, so a missing
-- prerequisite profile aborts the whole seed instead of leaving partial
-- data behind.

begin;

-- ----------------------------------------------------------------------------
-- Preflight validation
-- ----------------------------------------------------------------------------
-- Aborts the entire transaction (nothing below runs) unless each required
-- profile exists exactly once. Guards against both a missing profile and an
-- unexpected duplicate legacy_id.

do $$
declare
  v_count int;
begin
  select count(*) into v_count from public.profiles where legacy_id = 'u-001';
  if v_count <> 1 then
    raise exception 'Chat dev seed aborted: expected exactly 1 profile with legacy_id = ''u-001'' (Gabriel), found %', v_count;
  end if;

  select count(*) into v_count from public.profiles where legacy_id = 'u-002';
  if v_count <> 1 then
    raise exception 'Chat dev seed aborted: expected exactly 1 profile with legacy_id = ''u-002'' (Marisol), found %', v_count;
  end if;

  select count(*) into v_count from public.profiles where legacy_id = 'u-005';
  if v_count <> 1 then
    raise exception 'Chat dev seed aborted: expected exactly 1 profile with legacy_id = ''u-005'' (Lucía), found %', v_count;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- Conversations
-- ----------------------------------------------------------------------------

insert into public.conversations (type, direct_member_low, direct_member_high)
select
  'direct',
  least(gabriel.id, marisol.id),
  greatest(gabriel.id, marisol.id)
from
  (select id from public.profiles where legacy_id = 'u-001') as gabriel,
  (select id from public.profiles where legacy_id = 'u-002') as marisol
on conflict (direct_member_low, direct_member_high) where type = 'direct' do nothing;

insert into public.conversations (type, direct_member_low, direct_member_high)
select
  'direct',
  least(gabriel.id, lucia.id),
  greatest(gabriel.id, lucia.id)
from
  (select id from public.profiles where legacy_id = 'u-001') as gabriel,
  (select id from public.profiles where legacy_id = 'u-005') as lucia
on conflict (direct_member_low, direct_member_high) where type = 'direct' do nothing;

-- ----------------------------------------------------------------------------
-- Conversation members
-- ----------------------------------------------------------------------------

insert into public.conversation_members (conversation_id, profile_id)
select c.id, p.id
from public.conversations c
join public.profiles gabriel on gabriel.legacy_id = 'u-001'
join public.profiles marisol on marisol.legacy_id = 'u-002'
join public.profiles p on p.id in (gabriel.id, marisol.id)
where least(gabriel.id, marisol.id) = c.direct_member_low
  and greatest(gabriel.id, marisol.id) = c.direct_member_high
  and c.type = 'direct'
on conflict (conversation_id, profile_id) do nothing;

insert into public.conversation_members (conversation_id, profile_id)
select c.id, p.id
from public.conversations c
join public.profiles gabriel on gabriel.legacy_id = 'u-001'
join public.profiles lucia on lucia.legacy_id = 'u-005'
join public.profiles p on p.id in (gabriel.id, lucia.id)
where least(gabriel.id, lucia.id) = c.direct_member_low
  and greatest(gabriel.id, lucia.id) = c.direct_member_high
  and c.type = 'direct'
on conflict (conversation_id, profile_id) do nothing;

-- ----------------------------------------------------------------------------
-- Messages — Gabriel <-> Marisol (en <-> es), originals only
-- ----------------------------------------------------------------------------

insert into public.messages (id, conversation_id, sender_profile_id, original_text, original_language, created_at)
select
  '60afbee0-e9f5-4540-8340-b8ed1016762a',
  c.id,
  gabriel.id,
  'Please review Juan Perez''s application before noon.',
  'en',
  now() - interval '2 days'
from public.conversations c
join public.profiles gabriel on gabriel.legacy_id = 'u-001'
join public.profiles marisol on marisol.legacy_id = 'u-002'
where least(gabriel.id, marisol.id) = c.direct_member_low
  and greatest(gabriel.id, marisol.id) = c.direct_member_high
  and c.type = 'direct'
on conflict (id) do nothing;

insert into public.messages (id, conversation_id, sender_profile_id, original_text, original_language, created_at)
select
  '930a535c-264c-49e0-b714-c853e4dce80d',
  c.id,
  marisol.id,
  'Entendido, la reviso ahora mismo.',
  'es',
  now() - interval '2 days' + interval '7 minutes'
from public.conversations c
join public.profiles gabriel on gabriel.legacy_id = 'u-001'
join public.profiles marisol on marisol.legacy_id = 'u-002'
where least(gabriel.id, marisol.id) = c.direct_member_low
  and greatest(gabriel.id, marisol.id) = c.direct_member_high
  and c.type = 'direct'
on conflict (id) do nothing;

insert into public.messages (id, conversation_id, sender_profile_id, original_text, original_language, created_at)
select
  '519b7615-7285-4e03-8f1c-2168e21e1d54',
  c.id,
  marisol.id,
  'Ya aprobé la solicitud de Juan Pérez. Puedes revisar el expediente cuando quieras.',
  'es',
  now() - interval '1 days'
from public.conversations c
join public.profiles gabriel on gabriel.legacy_id = 'u-001'
join public.profiles marisol on marisol.legacy_id = 'u-002'
where least(gabriel.id, marisol.id) = c.direct_member_low
  and greatest(gabriel.id, marisol.id) = c.direct_member_high
  and c.type = 'direct'
on conflict (id) do nothing;

-- ----------------------------------------------------------------------------
-- Messages — Gabriel <-> Lucía (en <-> fr), originals only
-- ----------------------------------------------------------------------------

insert into public.messages (id, conversation_id, sender_profile_id, original_text, original_language, created_at)
select
  '97dac2ee-23a1-45bd-9d71-263e8a9289fe',
  c.id,
  lucia.id,
  'Veuillez vérifier les documents d''Ana Gómez avant demain.',
  'fr',
  now() - interval '3 days'
from public.conversations c
join public.profiles gabriel on gabriel.legacy_id = 'u-001'
join public.profiles lucia on lucia.legacy_id = 'u-005'
where least(gabriel.id, lucia.id) = c.direct_member_low
  and greatest(gabriel.id, lucia.id) = c.direct_member_high
  and c.type = 'direct'
on conflict (id) do nothing;

insert into public.messages (id, conversation_id, sender_profile_id, original_text, original_language, created_at)
select
  'aad93015-1888-4709-9836-10d682526135',
  c.id,
  gabriel.id,
  'Got it, I''ll check them this afternoon.',
  'en',
  now() - interval '3 days' + interval '65 minutes'
from public.conversations c
join public.profiles gabriel on gabriel.legacy_id = 'u-001'
join public.profiles lucia on lucia.legacy_id = 'u-005'
where least(gabriel.id, lucia.id) = c.direct_member_low
  and greatest(gabriel.id, lucia.id) = c.direct_member_high
  and c.type = 'direct'
on conflict (id) do nothing;

insert into public.messages (id, conversation_id, sender_profile_id, original_text, original_language, created_at)
select
  '6193ca49-e0ed-4514-95ba-a90311395123',
  c.id,
  lucia.id,
  'Merci beaucoup ! Je commence l''évaluation aujourd''hui.',
  'fr',
  now() - interval '18 hours'
from public.conversations c
join public.profiles gabriel on gabriel.legacy_id = 'u-001'
join public.profiles lucia on lucia.legacy_id = 'u-005'
where least(gabriel.id, lucia.id) = c.direct_member_low
  and greatest(gabriel.id, lucia.id) = c.direct_member_high
  and c.type = 'direct'
on conflict (id) do nothing;

-- No message_translations rows are inserted. Opening either conversation in
-- the running app (once the read/translation-persistence path is wired up)
-- should trigger real DeepL calls and populate them from there.

commit;
