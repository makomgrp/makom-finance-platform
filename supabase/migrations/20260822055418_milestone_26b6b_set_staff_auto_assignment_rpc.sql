-- ============================================================================
-- MILESTONE 26B-6B — CHANGING ROTATION PARTICIPATION GOES THROUGH AN RPC
-- ============================================================================
--
-- `profiles` grants service_role SELECT and nothing else, on purpose: every
-- staff mutation in this system passes through a SECURITY DEFINER function that
-- performs its own checks and writes its own audit row in the same transaction.
-- A first attempt at this feature updated the table directly and was refused by
-- exactly that grant — which is the design working. Granting UPDATE on
-- `profiles` to fix it would have opened every column on every profile to
-- direct writes and dismantled the discipline for one boolean.
--
-- So this follows set_staff_active_status: same actor checks, same branch-scope
-- rule over the target, same atomic audit append.
--
-- WHAT IT DELIBERATELY DOES NOT DO: touch existing ownership. Removing someone
-- from the rotation stops FUTURE leads reaching them and leaves every lead they
-- already hold exactly where it is — which is what covering a holiday needs.
create or replace function public.set_staff_auto_assignment(
  p_profile_id uuid,
  p_enabled boolean,
  p_actor_profile_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_actor_role text;
  v_target_role text;
  v_previous boolean;
begin
  select role into v_actor_role
    from public.profiles
   where id = p_actor_profile_id and active;

  if not found then
    raise exception 'set_staff_auto_assignment: actor is not an active profile'
      using errcode = '42501';
  end if;

  select role, auto_assignment_enabled
    into v_target_role, v_previous
    from public.profiles
   where id = p_profile_id
     for update;

  if not found then
    return null;
  end if;

  -- ONLY AN ADVISOR CAN BE IN AN ADVISOR ROTATION. Enforced here rather than
  -- trusted from the UI, so a re-roled profile can never carry a stale `true`
  -- that would quietly put a manager into the pool.
  if v_target_role <> 'asesor' then
    raise exception 'set_staff_auto_assignment: only an asesor may receive automatic leads'
      using errcode = '22023';
  end if;

  -- Same branch-scope rule every other staff mutation applies to its target.
  if not public.staff_target_within_actor_branch_scope(p_actor_profile_id, p_profile_id) then
    raise exception 'set_staff_auto_assignment: target is outside the actor''s branch scope'
      using errcode = '42501';
  end if;

  -- No-op stays a no-op, and writes no event. Repeated clicks do not fill the
  -- timeline with identical entries.
  if v_previous = p_enabled then
    return p_profile_id;
  end if;

  update public.profiles
     set auto_assignment_enabled = p_enabled
   where id = p_profile_id;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value
  ) values (
    -- Reuses the existing profile-update event type rather than extending the
    -- vocabulary for one boolean; the values say exactly what changed.
    'client_profile_updated',
    'profile', p_profile_id, null, null,
    p_actor_profile_id, 'human', 'crm_manual',
    jsonb_build_object('autoAssignmentEnabled', v_previous),
    jsonb_build_object('autoAssignmentEnabled', p_enabled)
  );

  return p_profile_id;
end;
$function$;

comment on function public.set_staff_auto_assignment(uuid, boolean, uuid) is
  'MILESTONE 26B-6B. Adds or removes one advisor from automatic lead '
  'distribution, with the same actor and branch-scope checks as every other '
  'staff mutation, and an audit row written in the same transaction. Does not '
  'affect leads the advisor already owns.';

revoke all on function public.set_staff_auto_assignment(uuid, boolean, uuid) from public;
revoke all on function public.set_staff_auto_assignment(uuid, boolean, uuid) from anon;
revoke all on function public.set_staff_auto_assignment(uuid, boolean, uuid) from authenticated;
grant execute on function public.set_staff_auto_assignment(uuid, boolean, uuid) to service_role;
