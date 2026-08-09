-- ============================================================================
-- DEVELOPMENT-ONLY seed data for the dossier alerts module
-- ============================================================================
--
-- This is fixture data for local/dev verification of the alerts read/
-- write/resolve path (reload persistence, open vs. resolved states,
-- resolution-metadata round-trip) — it is NOT part of the application's
-- real data model and MUST be deleted before production delivery. Do not
-- build any logic that assumes this data exists.
--
-- Removal before production:
--   delete from public.dossier_alerts
--   where id in (
--     '9b2f6d3b-2c2b-4c9c-ae2b-0a3f7f9d0201',
--     '9b2f6d3b-2c2b-4c9c-ae2b-0a3f7f9d0202'
--   );
--
-- Seeds two alerts on client "cl-001" (Juan Pérez — the same client used
-- throughout the Notes dev seed and the Auth migration's own live
-- verification), authored by the two real dev profiles already used
-- across prior milestones:
--   Gabriel Herrera (u-001)
--   Marisol Duarte  (u-002)
--
-- One OPEN alert (created by Gabriel, active = true, both resolution
-- fields null) and one RESOLVED alert (created by Marisol, resolved by
-- Gabriel — deliberately a different person than the creator, to prove
-- resolved_by_profile_id is independent of created_by_profile_id) —
-- exercises both valid shapes of dossier_alerts_resolution_state_check
-- from day one.
--
-- Author/resolver are resolved from the existing demo "u-00N" identifiers
-- via profiles.legacy_id — the same one-time boundary lookup used by
-- seed_dossier_notes_dev.sql. client_legacy_id is stored as-is ("cl-001")
-- per the Milestone 7 architecture review — there is no real clients
-- table yet to resolve it against.
--
-- Alert ids are fixed, real UUIDs (not left to gen_random_uuid()) purely
-- so this script is safely re-runnable via `on conflict (id) do nothing`
-- — they carry no other meaning.
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
    raise exception 'Dossier alerts dev seed aborted: expected exactly 1 profile with legacy_id = ''u-001'' (Gabriel), found %', v_count;
  end if;

  select count(*) into v_count from public.profiles where legacy_id = 'u-002';
  if v_count <> 1 then
    raise exception 'Dossier alerts dev seed aborted: expected exactly 1 profile with legacy_id = ''u-002'' (Marisol), found %', v_count;
  end if;
end $$;

-- Open alert — created by Gabriel, never resolved.
insert into public.dossier_alerts (
  id, client_legacy_id, created_by_profile_id, type, level, reason, observation,
  active, created_at, resolved_at, resolved_by_profile_id
)
select
  '9b2f6d3b-2c2b-4c9c-ae2b-0a3f7f9d0201',
  'cl-001',
  gabriel.id,
  'revision_especial',
  'medio',
  'Seed de desarrollo: alerta abierta para verificar estado activo.',
  'Observación de prueba para el seed de desarrollo.',
  true,
  now() - interval '3 hours',
  null,
  null
from public.profiles gabriel
where gabriel.legacy_id = 'u-001'
on conflict (id) do nothing;

-- Resolved alert — created by Marisol, resolved by Gabriel.
insert into public.dossier_alerts (
  id, client_legacy_id, created_by_profile_id, type, level, reason, observation,
  active, created_at, resolved_at, resolved_by_profile_id
)
select
  '9b2f6d3b-2c2b-4c9c-ae2b-0a3f7f9d0202',
  'cl-001',
  marisol.id,
  'informacion_pendiente',
  'bajo',
  'Seed de desarrollo: alerta resuelta para verificar estado resuelto.',
  null,
  false,
  now() - interval '5 hours',
  now() - interval '1 hours',
  gabriel.id
from public.profiles marisol
cross join (select id from public.profiles where legacy_id = 'u-001') as gabriel
where marisol.legacy_id = 'u-002'
on conflict (id) do nothing;

commit;
