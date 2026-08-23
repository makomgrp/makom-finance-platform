-- ============================================================================
-- MILESTONE 26B-9B — EMAIL ACTIVITY GOES THROUGH AN RPC, LIKE EVERY OTHER EVENT
-- ============================================================================
--
-- Found by the reply round-trip QA: a message was sent, linked to a customer,
-- and recorded — but no `email_sent` row appeared in their activity. The insert
-- was being refused silently.
--
-- THE CAUSE IS THE ARCHITECTURE WORKING AS INTENDED. `crm_events` grants
-- service_role SELECT only. Every event in this system — alert resolutions,
-- advisor assignments, profile updates — is written from inside a
-- SECURITY DEFINER function, which runs as the owner and therefore may insert.
-- That is what keeps an event and the mutation it describes in one reviewed
-- place, and what stops arbitrary application code writing history.
--
-- 26B-9B's first attempt wrote the event directly from the service layer, which
-- has no INSERT privilege. The right fix is NOT to grant one — that would open
-- the audit log to any code holding the service role, for the convenience of a
-- single caller. It is to give email the same treatment everything else gets.
--
-- NEVER THE BODY, only a subject and the id of the message it describes.
-- `crm_events` is append-only with no delete path, so a customer's words copied
-- into it could never be corrected or erased.
--
-- The branch is derived from the CLIENT inside the function rather than passed
-- in, exactly as record_alert_status_change does, so a caller cannot file an
-- event against a branch the customer does not belong to.
-- ============================================================================

create or replace function public.record_email_sent_event(
  p_email_id         uuid,
  p_client_id        uuid,
  p_application_id   uuid,
  p_subject          text,
  p_actor_profile_id uuid
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_branch_id uuid;
begin
  -- No customer means no customer activity. The message still exists in the
  -- mailbox; it simply has no dossier to appear in.
  if p_client_id is null then
    return null;
  end if;

  select branch_id into v_branch_id from public.clients where id = p_client_id;
  if not found then
    return null;
  end if;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value, branch_id
  ) values (
    'email_sent', 'email_message', p_email_id,
    p_client_id, p_application_id,
    p_actor_profile_id, 'human', 'crm_manual',
    null,
    -- Subject only. See the header.
    jsonb_build_object('subject', left(coalesce(p_subject, ''), 300)),
    v_branch_id
  );

  return p_email_id;
end;
$function$;

revoke all on function public.record_email_sent_event(uuid, uuid, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.record_email_sent_event(uuid, uuid, uuid, text, uuid)
  to service_role;
