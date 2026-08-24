-- ============================================================================
-- MILESTONE 26B-17 — AN EMAIL THE SYSTEM SENT ON ITS OWN
-- ============================================================================
--
-- `crm_events` already speaks every word this needs: `email_sent` is in the
-- event vocabulary, `email_message` is in the entity vocabulary, `website_form`
-- is in the source vocabulary, and `actor_kind` already admits 'system'. NONE
-- OF THOSE CHECK CONSTRAINTS ARE TOUCHED HERE and none needed to be.
--
-- What could not express it was the writer. `record_email_sent_event` hardcoded
-- `'human', 'crm_manual'`, which is exactly right for the CRM's compose box —
-- a person picked the recipient and wrote the words. The portal's confirmation
-- has neither: no employee chose to send it and no employee wrote it. Passing a
-- null profile into the old function would have failed `actor_pair_check`, and
-- passing a real employee's id would have signed their name to something they
-- never wrote.
--
-- ----------------------------------------------------------------------------
-- ONE WRITER, NOT TWO
-- ----------------------------------------------------------------------------
-- The alternative was a second RPC for system sends. That would mean two places
-- deciding what an `email_sent` event looks like, free to drift, and a reader
-- of the activity feed would have to know which one produced a given row. The
-- function instead takes the actor as it really is and derives the rest:
--
--   actor_profile_id IS NULL  -> actor_kind 'system'
--   actor_profile_id NOT NULL -> actor_kind 'human'
--
-- which is precisely what `crm_events_actor_pair_check` demands, now enforced
-- in one place instead of assumed by every caller.
--
-- `p_source` defaults to 'crm_manual' so the existing five-argument call from
-- the Correo module keeps its exact previous behaviour. It has to be a
-- parameter rather than a constant because `crm_events_actor_source_check`
-- forbids a human actor from claiming any source but 'crm_manual' — the
-- function asserts that rather than trusting callers to remember it.
--
-- SECURITY DEFINER and the service_role-only grant are preserved unchanged:
-- `service_role` holds SELECT on crm_events and nothing more, so this function
-- remains the only door through which the application can append audit history.
-- ============================================================================

drop function if exists public.record_email_sent_event(uuid, uuid, uuid, text, uuid);

create function public.record_email_sent_event(
  p_email_id uuid,
  p_client_id uuid,
  p_application_id uuid,
  p_subject text,
  p_actor_profile_id uuid,
  p_source text default 'crm_manual'
) returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_branch_id uuid;
  v_actor_kind text;
begin
  -- No customer means no customer activity to append to. Unchanged.
  if p_client_id is null then
    return null;
  end if;

  select branch_id into v_branch_id from public.clients where id = p_client_id;
  if not found then
    return null;
  end if;

  v_actor_kind := case when p_actor_profile_id is null then 'system' else 'human' end;

  -- Refuse rather than write a row the CHECK would reject anyway, so a caller
  -- that gets this wrong learns why instead of seeing a bare constraint name.
  if p_actor_profile_id is not null and p_source is distinct from 'crm_manual' then
    raise exception
      'record_email_sent_event: a human actor may only record source crm_manual, got %', p_source
      using errcode = '22023';
  end if;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value, branch_id
  ) values (
    'email_sent', 'email_message', p_email_id,
    p_client_id, p_application_id,
    p_actor_profile_id, v_actor_kind, coalesce(p_source, 'crm_manual'),
    null,
    jsonb_build_object('subject', left(coalesce(p_subject, ''), 300)),
    v_branch_id
  );

  return p_email_id;
end;
$function$;

revoke all on function public.record_email_sent_event(uuid, uuid, uuid, text, uuid, text) from public;
grant execute on function public.record_email_sent_event(uuid, uuid, uuid, text, uuid, text) to service_role;
