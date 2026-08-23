-- ============================================================================
-- MILESTONE 26B-10 — REVIEW EVENTS, AND THE ONES DELIBERATELY ABSENT
-- ============================================================================
--
-- Three event types, chosen because each marks a moment somebody downstream
-- needs to be able to find:
--
--   application_review_recommended — a named person put their name to a
--                                    recommendation about this loan
--   application_review_completed   — the review was declared finished
--   application_review_reopened    — a finished review was reopened, and why
--
-- WHAT IS NOT HERE, AND WHY THAT IS THE POINT
--
-- There is no `review_started` and no per-checklist-item event. A reviewer
-- works through roughly twenty items and revises them as documents arrive; one
-- event per tick would bury the three entries above under dozens of
-- "identity_document_reviewed: pending -> verified" lines, and an activity feed
-- nobody can read is worse than one that records less. Each item row already
-- carries `updated_by_profile_id` and `updated_at`, so who touched what is
-- never lost — it simply is not shouted into the customer's timeline.
--
-- The milestone asks for a meaningful event model rather than completeness, and
-- this is that judgement made explicitly.
--
-- NEVER THE FREE TEXT. The reopen REASON is the one exception and is included
-- because a reopening without a stated cause is unauditable — but observation
-- bodies, checklist notes and recommendation notes stay in their own tables.
-- `crm_events` is append-only with no delete path, so anything copied into it
-- could never be corrected or erased.
--
-- `entity_type` gains 'application_review' so an event can point at the review
-- it describes, exactly as email events point at 'email_message'.
-- ============================================================================

alter table public.crm_events drop constraint if exists crm_events_event_type_check;
alter table public.crm_events add constraint crm_events_event_type_check check (
  event_type = any (array[
    'application_status_changed', 'requirement_status_changed',
    'alert_resolved', 'alert_reactivated',
    'client_status_changed', 'client_profile_updated',
    'application_advisor_assigned', 'client_restriction_changed',
    'user_invited', 'user_role_changed', 'user_deactivated', 'user_reactivated',
    'user_capability_granted', 'user_capability_revoked',
    'branch_created', 'branch_updated', 'branch_deactivated',
    'profile_branch_assigned', 'profile_branch_removed', 'profile_branch_scope_changed',
    'client_branch_transferred', 'application_branch_transferred',
    'email_sent', 'email_linked', 'email_unlinked',
    -- Milestone 26B-10
    'application_review_recommended',
    'application_review_completed',
    'application_review_reopened'
  ])
);

alter table public.crm_events drop constraint if exists crm_events_entity_type_check;
alter table public.crm_events add constraint crm_events_entity_type_check check (
  entity_type = any (array[
    'application', 'requirement_slot', 'dossier_alert', 'client', 'profile', 'branch',
    'email_message',
    -- Milestone 26B-10
    'application_review'
  ])
);

-- ============================================================================
-- WRITING THOSE EVENTS
-- ============================================================================
--
-- Through a SECURITY DEFINER function, because `crm_events` grants service_role
-- SELECT only — every event in this system is written from inside one, and
-- 26B-9B proved what happens otherwise: the insert is silently refused and the
-- activity simply never appears. The fix then was to add an RPC rather than
-- widen the grant, and the same reasoning applies here.
--
-- The branch is derived from the APPLICATION inside the function rather than
-- passed in, so a caller cannot file an event against a branch the application
-- does not belong to.
-- ============================================================================

create or replace function public.record_application_review_event(
  p_event_type       text,
  p_review_id        uuid,
  p_application_id   uuid,
  p_actor_profile_id uuid,
  p_payload          jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_client_id uuid;
  v_branch_id uuid;
begin
  if p_event_type not in (
    'application_review_recommended',
    'application_review_completed',
    'application_review_reopened'
  ) then
    raise exception 'record_application_review_event: unsupported event type'
      using errcode = '22023';
  end if;

  select a.client_id, a.branch_id
    into v_client_id, v_branch_id
    from public.applications a
   where a.id = p_application_id;

  if not found then
    return null;
  end if;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value, branch_id
  ) values (
    p_event_type, 'application_review', p_review_id,
    v_client_id, p_application_id,
    p_actor_profile_id, 'human', 'crm_manual',
    null, coalesce(p_payload, '{}'::jsonb),
    v_branch_id
  );

  return p_review_id;
end;
$function$;

revoke all on function public.record_application_review_event(text, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_application_review_event(text, uuid, uuid, uuid, jsonb)
  to service_role;
