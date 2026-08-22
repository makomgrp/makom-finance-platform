-- ============================================================================
-- MILESTONE 26B-8 — RESOLVING AN ALERT NOW REQUIRES A REASON
-- ============================================================================
--
-- Extends record_alert_status_change with the resolution note. Everything the
-- function already did is unchanged: the branch gate, the no-op guard, the
-- single statement that keeps `active` and the resolution columns consistent
-- with dossier_alerts_resolution_state_check, and the append-only event.
--
-- THE NOTE IS MANDATORY ON RESOLVE and rejected on reactivate. Enforced here
-- rather than only in the Server Action for the usual reason: this function is
-- the one place the write actually happens, so it is the only place the rule
-- cannot be routed around.
--
-- THE NOTE SURVIVES REACTIVATION. `resolved_at` and `resolved_by_profile_id`
-- are cleared when an alert is reopened — they describe the current resolution
-- episode, and there no longer is one. The note is different: it is why the
-- alert was last stood down, and someone reopening it is precisely the person
-- who needs to read that. It is therefore left in place.
--
-- THE EVENT RECORDS THAT A NOTE EXISTS, NEVER ITS TEXT. `crm_events` is
-- append-only with no delete path, so free text copied into it could never be
-- corrected or erased — and an alert note can quite reasonably name a person
-- or describe an accusation. The same rule record_client_profile_update
-- follows, and the reason neither writes values.
-- ============================================================================

create or replace function public.record_alert_status_change(
  p_alert_id uuid,
  p_target_active boolean,
  p_actor_profile_id uuid,
  p_resolution_note text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_client_id uuid;
  v_branch_id uuid;
  v_current_active boolean;
  v_note text;
begin
  v_note := nullif(btrim(coalesce(p_resolution_note, '')), '');

  -- Clearing a risk flag without saying why is the case this milestone exists
  -- to close.
  if not p_target_active and v_note is null then
    raise exception 'record_alert_status_change: a resolution note is required'
      using errcode = '22023';
  end if;

  -- Reopening is not a resolution and carries no note of its own; the previous
  -- one is retained untouched below.
  if p_target_active and v_note is not null then
    raise exception 'record_alert_status_change: a resolution note cannot accompany a reactivation'
      using errcode = '22023';
  end if;

  select al.client_id, al.active, c.branch_id
    into v_client_id, v_current_active, v_branch_id
  from public.dossier_alerts al
  join public.clients c on c.id = al.client_id
  where al.id = p_alert_id
  for update of al;

  if not found then
    return null;
  end if;

  if not public.profile_has_operational_branch_scope(p_actor_profile_id, v_branch_id) then
    raise exception 'Out of branch scope.' using errcode = '42501';
  end if;

  -- Already in the target state: a no-op, exactly as before. No event.
  if v_current_active = p_target_active then
    return null;
  end if;

  update public.dossier_alerts
  set active = p_target_active,
      resolved_at = case when p_target_active then null else now() end,
      resolved_by_profile_id = case when p_target_active then null else p_actor_profile_id end,
      -- Set on resolve; left exactly as it was on reactivate.
      resolution_note = case when p_target_active then resolution_note else v_note end
  where id = p_alert_id
    and active <> p_target_active;

  if not found then
    return null;
  end if;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value, branch_id
  ) values (
    case when p_target_active then 'alert_reactivated' else 'alert_resolved' end,
    'dossier_alert', p_alert_id,
    v_client_id, null,
    p_actor_profile_id,
    case when p_actor_profile_id is null then 'system' else 'human' end,
    'crm_manual',
    jsonb_build_object('active', not p_target_active),
    jsonb_build_object('active', p_target_active, 'hasResolutionNote', v_note is not null),
    -- Derived from the canonical parent client.
    v_branch_id
  );

  return p_alert_id;
end;
$function$;

-- The 3-argument signature is replaced, not kept alongside: leaving it would
-- leave a way to resolve an alert without a note.
drop function if exists public.record_alert_status_change(uuid, boolean, uuid);

revoke all on function public.record_alert_status_change(uuid, boolean, uuid, text)
  from public, anon, authenticated;
grant execute on function public.record_alert_status_change(uuid, boolean, uuid, text)
  to service_role;
