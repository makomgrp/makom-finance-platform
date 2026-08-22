-- ============================================================================
-- MILESTONE 26B-6C — CHANGING A STAFF MEMBER'S CRM LANGUAGE
-- ============================================================================
--
-- Sibling of set_staff_auto_assignment (26B-6B) and shaped deliberately like
-- it: one column, one guard set, one audited write, no-op stays a no-op.
--
-- `profiles` grants service_role SELECT only, so a direct UPDATE from server
-- code cannot work and must not be made to work by widening the grant. That
-- narrow grant is what keeps every staff mutation inside a reviewed
-- SECURITY DEFINER function where the role, scope and audit rules live
-- together. This is that function for preferred_language.
--
-- ----------------------------------------------------------------------------
-- ES / EN ONLY
-- ----------------------------------------------------------------------------
-- The column's domain is wider than the CRM's: `preferred_language` also drives
-- chat translation, where 'fr' is meaningful and two live profiles hold it.
-- The CRM INTERFACE ships exactly two locales (src/i18n/config.ts), so this
-- control — which exists to set the language a colleague reads the CRM in —
-- accepts exactly those two. It deliberately does not become a general
-- language editor: silently rewriting a French speaker's chat language while
-- an administrator believed they were switching a UI would be a different
-- change than the one they asked for.
--
-- WHY IT IS NOT ROLE-GATED IN HERE. Unlike set_staff_role, changing a display
-- language grants no access and can escalate no privilege, so the rule that
-- matters is the caller's capability (`user:set_language`) plus branch scope,
-- both applied exactly as the sibling applies them. Actor liveness and scope
-- are still enforced here rather than trusted from the action.
-- ============================================================================

create or replace function public.set_staff_preferred_language(
  p_profile_id       uuid,
  p_language         text,
  p_actor_profile_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_actor_role text;
  v_previous   text;
begin
  select role into v_actor_role
    from public.profiles
   where id = p_actor_profile_id and active;

  if not found then
    raise exception 'set_staff_preferred_language: actor is not an active profile'
      using errcode = '42501';
  end if;

  if p_language is null or p_language not in ('es', 'en') then
    raise exception 'set_staff_preferred_language: language must be es or en'
      using errcode = '22023';
  end if;

  select preferred_language into v_previous
    from public.profiles
   where id = p_profile_id
     for update;

  if not found then
    return null;
  end if;

  -- Same branch-scope rule every other staff mutation applies to its target.
  if not public.staff_target_within_actor_branch_scope(p_actor_profile_id, p_profile_id) then
    raise exception 'set_staff_preferred_language: target is outside the actor''s branch scope'
      using errcode = '42501';
  end if;

  if v_previous = p_language then
    return p_profile_id;
  end if;

  update public.profiles
     set preferred_language = p_language
   where id = p_profile_id;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value
  ) values (
    -- Reuses the existing profile-update event type, exactly as
    -- set_staff_auto_assignment does; the values say what changed.
    'client_profile_updated',
    'profile', p_profile_id, null, null,
    p_actor_profile_id, 'human', 'crm_manual',
    jsonb_build_object('preferredLanguage', v_previous),
    jsonb_build_object('preferredLanguage', p_language)
  );

  return p_profile_id;
end;
$function$;

revoke all on function public.set_staff_preferred_language(uuid, text, uuid)
  from public, anon, authenticated;

grant execute on function public.set_staff_preferred_language(uuid, text, uuid)
  to service_role;
