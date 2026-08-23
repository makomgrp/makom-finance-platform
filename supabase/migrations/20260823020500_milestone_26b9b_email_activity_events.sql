-- ============================================================================
-- MILESTONE 26B-9B — EMAIL IN THE CUSTOMER'S ACTIVITY
-- ============================================================================
--
-- 26B-9A deliberately deferred this: extending a closed CHECK is a schema
-- change, and doing it for a feature that had no outbound half yet would have
-- been speculative. Now that ODL both receives and sends, "we wrote to them on
-- Tuesday" is part of a customer's operational history and belongs where the
-- rest of it already lives.
--
-- FOUR TYPES, AND NO MORE.
--   email_sent      — staff sent a message from the CRM
--   email_linked    — a message was attached to this customer by a person
--   email_unlinked   — that attachment was removed
--
-- `email_received` is deliberately ABSENT. Sync is a bulk, repeatable
-- operation: a 50-message import would write 50 activity rows, and pressing
-- Sync again next week would be indistinguishable noise. The milestone is
-- explicit that already-known mail must not generate events, and the honest
-- place for "what arrived" is the mailbox itself, which the dossier now shows
-- directly. Auto-linking is likewise silent — it is the machine's guess, not a
-- decision anybody made.
--
-- NEVER THE BODY. Same rule every other event in this table follows:
-- `crm_events` is append-only with no delete path, so a customer's message
-- copied into it could never be corrected or erased. The events carry a
-- subject and an id, which is enough to find the message and nothing more.
--
-- `entity_type` gains 'email_message' so an event can point at the row it
-- describes, exactly as alerts point at 'dossier_alert'.
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
    -- Milestone 26B-9B
    'email_sent', 'email_linked', 'email_unlinked'
  ])
);

alter table public.crm_events drop constraint if exists crm_events_entity_type_check;
alter table public.crm_events add constraint crm_events_entity_type_check check (
  entity_type = any (array[
    'application', 'requirement_slot', 'dossier_alert', 'client', 'profile', 'branch',
    -- Milestone 26B-9B
    'email_message'
  ])
);
