-- ============================================================================
-- Milestone 20 — Append-only CRM audit trail
-- ============================================================================
--
-- PURPOSE. Several important CRM mutations overwrite their own history:
--
--   applications.status / status_changed_at / status_changed_by_profile_id
--   requirement_slots.status / status_changed_at / status_changed_by_profile_id
--   dossier_alerts.resolved_at / resolved_by_profile_id  (CLEARED on reactivate)
--   clients.status, clients.restricted, and every editable client field
--
-- Each is a single set of columns rewritten on every change, so an application
-- that went new -> in_review -> approved retains only the final write. There is
-- no history table and no trigger anywhere in this schema, so those earlier
-- transitions are gone permanently and CANNOT be reconstructed.
--
-- This migration does not attempt to. It creates the table and the five
-- functions that make every FUTURE transition durable. crm_events starts EMPTY
-- and is never backfilled — see the NO BACKFILL section below.
--
-- ----------------------------------------------------------------------------
-- WHY A NEW TABLE RATHER THAN EXTENDING automation_events
-- ----------------------------------------------------------------------------
-- automation_events is intake-pipeline telemetry: it is keyed on intake_id, it
-- carries a task_id placeholder for an engine that does not exist, its `actor`
-- is free text that is always 'system', and its whole vocabulary describes how
-- one application_intakes row progressed. A CRM audit trail is predominantly
-- about HUMANS and needs actor_profile_id as a real foreign key plus before/
-- after values. Widening automation_events would have left a table whose name,
-- comment and columns all contradicted most of its rows.
--
--   automation_events -> how an inbound intake progressed        (UNTOUCHED here)
--   crm_events        -> what happened to a client file, and who did it
--
-- ----------------------------------------------------------------------------
-- WHAT DELIBERATELY PRODUCES NO EVENT
-- ----------------------------------------------------------------------------
-- Facts already proven permanently by their own immutable row are NOT copied
-- here — duplicating them would create a second source of truth and make the
-- Dossier Activity feed render the same occurrence twice:
--
--   client created, application created, note created, alert raised,
--   evidence uploaded / replaced / reviewed, analysis generated / reviewed,
--   chat messages.
--
-- dossier_notes has no update path in the entire codebase; a replacement
-- evidence upload is a new row carrying replaces_evidence_id; an evidence
-- review is one-shot and never cleared. Those tables ARE the audit trail for
-- their own facts.
--
-- ----------------------------------------------------------------------------
-- NO BACKFILL — DELIBERATE
-- ----------------------------------------------------------------------------
-- This migration inserts ZERO rows. Overwritten transitions cannot be
-- recovered, and re-deriving the events that ARE still provable (from
-- applications/notes/alerts/dossier_documents) would only duplicate rows the
-- Activity feed already reads from those tables. History starts at deployment.
--
-- ----------------------------------------------------------------------------
-- ROLLBACK CAVEAT — READ BEFORE REVERSING
-- ----------------------------------------------------------------------------
-- While crm_events is empty, reversal is clean: drop the five functions, then
-- drop the table. ONCE REAL EVENTS EXIST, DROPPING THIS TABLE PERMANENTLY
-- DESTROYS THE ONLY COPY OF THAT HISTORY. After go-live the correct reversal
-- is to stop calling the functions — never to drop the table.
--
-- IDEMPOTENCY: every statement is naturally idempotent (create ... if not
-- exists / create or replace / revoke) or wrapped in a catalog existence
-- check, matching 20260817062939_milestone_16_security_floor.sql.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- A. The table
-- ----------------------------------------------------------------------------
create table if not exists public.crm_events (
  id uuid primary key default gen_random_uuid(),

  -- Closed vocabulary, CHECK-constrained rather than a native ENUM — this
  -- schema's universal convention (see applications_status_check,
  -- automation_events_event_type_check). Widening it later is a one-line
  -- additive change; a Postgres ENUM would not be.
  event_type text not null,

  -- Which table the event is about, so a row is self-describing without a
  -- join, plus the specific row.
  entity_type text not null,
  -- DELIBERATELY NO FOREIGN KEY: an audit row must outlive its subject, and a
  -- polymorphic reference cannot be constrained anyway. entity_id preserves
  -- the subject's identity even after client_id/application_id are nulled by
  -- the ON DELETE SET NULL rules below.
  entity_id uuid not null,

  -- The two query axes, denormalised on purpose so a client's Activity feed
  -- never has to join through applications to find its events.
  client_id uuid,
  application_id uuid,

  -- Who. NULL is a legitimate, meaningful value — see actor_kind.
  actor_profile_id uuid,
  actor_kind text not null,

  -- Which channel/actor-type. Reuses the existing ApplicationSource vocabulary
  -- already CHECK-constrained on applications, clients, requirement_slots and
  -- dossier_documents. No new vocabulary is introduced.
  source text not null,

  -- MINIMAL transition values only, never full row snapshots. See the privacy
  -- rule on client_profile_updated below.
  previous_value jsonb,
  new_value jsonb,

  occurred_at timestamptz not null default now(),

  -- --- Vocabularies ---------------------------------------------------------
  -- Eight values. The first five are written by this milestone; the last three
  -- are reserved so that wiring them later needs no constraint change:
  -- application_advisor_assigned and client_restriction_changed have no UI or
  -- Server Action caller today, and auditing an unreachable function would be
  -- premature.
  constraint crm_events_event_type_check check (event_type in (
    'application_status_changed',
    'requirement_status_changed',
    'alert_resolved',
    'alert_reactivated',
    'client_status_changed',
    'client_profile_updated',
    'application_advisor_assigned',
    'client_restriction_changed'
  )),

  constraint crm_events_entity_type_check check (entity_type in (
    'application',
    'requirement_slot',
    'dossier_alert',
    'client'
  )),

  -- Two values, because the architecture supports exactly two today.
  -- 'automation' / 'public_intake' are deliberately absent: nothing writes
  -- them, and shipping a vocabulary nothing can produce is not design.
  constraint crm_events_actor_kind_check check (actor_kind in ('human', 'system')),

  constraint crm_events_source_check check (source in (
    'crm_manual', 'website_form', 'whatsapp', 'email', 'ai'
  )),

  -- --- Pairing invariants ---------------------------------------------------
  -- A human event names its human; a system event never invents one.
  constraint crm_events_actor_pair_check check (
    (actor_kind = 'human'  and actor_profile_id is not null) or
    (actor_kind = 'system' and actor_profile_id is null)
  ),

  -- Mirrors applications_created_by_source_check / clients_created_by_source_
  -- check: a real CRM profile only ever acts through the CRM.
  constraint crm_events_actor_source_check check (
    actor_profile_id is null or source = 'crm_manual'
  ),

  -- --- Foreign keys ---------------------------------------------------------
  -- ON DELETE SET NULL, deliberately diverging from this schema's usual
  -- RESTRICT. RESTRICT would let an audit row BLOCK removing a client or
  -- profile, turning the trail into an operational obstacle and creating
  -- pressure to purge it. CASCADE would destroy history when an account is
  -- removed — the exact anti-pattern Milestone 16 rejected for
  -- profiles.auth_user_id. SET NULL keeps the event, its timestamp, its type
  -- and its before/after values forever, losing only the live link; entity_id
  -- still records which row it was about.
  constraint crm_events_client_id_fkey
    foreign key (client_id) references public.clients (id) on delete set null,
  constraint crm_events_application_id_fkey
    foreign key (application_id) references public.applications (id) on delete set null,
  constraint crm_events_actor_profile_id_fkey
    foreign key (actor_profile_id) references public.profiles (id) on delete set null
);

comment on table public.crm_events is
  'Append-only CRM audit trail (Milestone 20). One row per state transition '
  'whose history the business tables themselves overwrite — application and '
  'requirement-slot status, alert resolution/reactivation, client status and '
  'client profile edits. Rows are immutable historical facts: no UPDATE or '
  'DELETE path exists in the application, and service_role is granted neither '
  '(nor INSERT — see the grants below). The ONLY writers are the five '
  'SECURITY DEFINER functions in this migration, each of which performs the '
  'business mutation and the event append in ONE transaction. Facts that '
  'already have their own immutable row (client/application creation, notes, '
  'alerts raised, evidence uploaded/reviewed, analyses) are deliberately NOT '
  'duplicated here. Never backfilled: history starts at deployment.';

comment on column public.crm_events.entity_id is
  'The subject row. Deliberately unconstrained — an audit row must outlive its '
  'subject, and this stays meaningful after client_id/application_id are '
  'nulled by ON DELETE SET NULL.';

comment on column public.crm_events.previous_value is
  'MINIMAL transition value only — e.g. {"status":"in_review"} — never a full '
  'row snapshot. For client_profile_updated this is {"fields":[...]}: the '
  'NAMES of the changed fields and nothing else. Client PII (identification '
  'number, e-mail, phone, salary, birth date, nationality, address, position, '
  'employer) MUST NEVER be written here: this table is deliberately never '
  'deletable, so a value copied in is a value that can never be erased.';

comment on column public.crm_events.new_value is
  'See previous_value. Same minimal-value and no-PII rule.';


-- ----------------------------------------------------------------------------
-- B. Indexes — three, matched to real reads
-- ----------------------------------------------------------------------------
-- Deliberately NOT indexed: actor_profile_id (no per-actor screen exists),
-- event_type alone (low cardinality), occurred_at alone (covered by the
-- composites for every query that has a subject). Same restraint as
-- automation_events, which carries three.

-- The Dossier Activity query: one client, newest first.
create index if not exists crm_events_client_id_occurred_at_idx
  on public.crm_events (client_id, occurred_at desc);

-- Per-application history; the basis of any future time-in-state reporting.
create index if not exists crm_events_application_id_occurred_at_idx
  on public.crm_events (application_id, occurred_at desc);

-- "Everything that ever happened to this specific slot / alert / client".
create index if not exists crm_events_entity_occurred_at_idx
  on public.crm_events (entity_type, entity_id, occurred_at desc);


-- ----------------------------------------------------------------------------
-- C. Privileges — append-only, and NOT WRITABLE BY THE APPLICATION
-- ----------------------------------------------------------------------------
-- STRONGER THAN automation_events ON PURPOSE. That table grants
-- `select, insert` to service_role, so application code could append to it
-- directly. Here, INSERT is withheld: a future developer must not be able to
-- write supabase.from('crm_events').insert(...) and bypass the transactional
-- architecture, because an event appended in a separate HTTP request is
-- exactly the partial write this milestone exists to prevent.
--
-- HOW THE FUNCTIONS STILL INSERT: they are SECURITY DEFINER and owned by
-- `postgres`, which owns this table and therefore holds INSERT on it. A
-- SECURITY DEFINER function executes with its OWNER's privileges, not its
-- caller's, so the functions below can append while service_role cannot.
-- Verified against this project before writing: service_role is not a
-- superuser and holds no role memberships, so grants bind to it directly.
--
-- NOTE ON DEFAULTS: this project's default privileges for tables created by
-- `postgres` grant anon/authenticated/service_role only Dxtm (TRUNCATE,
-- REFERENCES, TRIGGER, MAINTAIN) — never INSERT/SELECT/UPDATE/DELETE. So the
-- single `grant select` below is the entire read surface, and the revokes are
-- what close the TRUNCATE that the default would otherwise leave open.

-- The server-side service layer reads the trail (the Dossier Activity feed).
grant select on public.crm_events to service_role;

-- Everything else is explicitly withheld. These revokes are mostly belt and
-- braces against the default ACL, but they make the intent unmissable and
-- visibly contradict any future accidental grant.
revoke insert, update, delete, truncate on public.crm_events from service_role;
revoke all on public.crm_events from anon;
revoke all on public.crm_events from authenticated;
revoke all on public.crm_events from public;


-- ============================================================================
-- D. The five atomic mutation functions
-- ============================================================================
--
-- ARCHITECTURE. Every function performs the business UPDATE and the crm_events
-- INSERT inside one PL/pgSQL body, which is one Postgres transaction: both
-- commit or neither does. This is the only way to get atomicity in this
-- application, because it reaches Postgres through PostgREST over HTTP — each
-- supabase-js call is its own transaction, so a service-layer "update then
-- insert event" could lose the event after the state already changed.
--
-- WHY NOT TRIGGERS. A trigger would see OLD/NEW for free and could not be
-- bypassed, but it CANNOT KNOW WHICH HUMAN ACTED: the application connects
-- with the service-role key, so auth.uid() is null for every CRM write, and
-- there is no session in which to SET LOCAL an actor before a PostgREST
-- request. Every actor_profile_id would be NULL, defeating the accountability
-- this table exists for. The actor is therefore an explicit parameter,
-- resolved by requireCapability() in the Server Action exactly as it already
-- is for every other write in this app.
--
-- WHERE TRANSITION LEGALITY LIVES. These functions deliberately do NOT
-- re-encode APPLICATION_STATUS_TRANSITIONS / REQUIREMENT_SLOT_STATUS_
-- TRANSITIONS in SQL. Those graphs are canonical in
-- src/lib/config/application.ts and src/lib/config/requirement-slot.ts, and
-- this schema's standing rule (see src/lib/auth/capabilities.ts's header) is
-- that a duplicated matrix is a second thing to forget to update. The caller
-- validates legality against the canonical graph and passes the status it
-- believes is current; the function's guarded predicate
-- (`where status = p_expected_status`) then makes the write race-safe in
-- exactly the way the existing services' `.eq("status", currentStatus)` guard
-- already does. A concurrent change makes the guard match zero rows, so
-- nothing is updated and no event is written.
--
-- RETURN CONTRACT. Each function returns the affected row's id, or NULL when
-- nothing changed. NULL is never an error in itself: the caller re-reads and
-- maps it to its existing result code, the same idiom
-- review_application_analysis already uses. Returning the id rather than the
-- row keeps every service's existing SELECT (including its PostgREST profile
-- embeds) untouched.
--
-- SECURITY. SECURITY DEFINER + `set search_path = public, pg_temp`, matching
-- create_application_analysis_snapshot and review_application_analysis. No
-- dynamic SQL anywhere, so no user-controlled identifier can reach the parser.
-- EXECUTE is revoked from PUBLIC and granted only to service_role, per the
-- Milestone 16 security floor.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- D1. Application status
-- ----------------------------------------------------------------------------
create or replace function public.record_application_status_change(
  p_application_id uuid,
  p_expected_status text,
  p_new_status text,
  p_source text,
  p_actor_profile_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_client_id uuid;
begin
  -- Guarded update: the predicate reproduces setApplicationStatus's
  -- `.eq("status", currentStatus)` exactly, so a concurrent transition makes
  -- this match zero rows rather than silently overwriting a change nobody
  -- validated.
  update public.applications
  set status = p_new_status,
      status_changed_at = now(),
      status_changed_by_profile_id = p_actor_profile_id,
      status_changed_source = p_source
  where id = p_application_id
    and status = p_expected_status
  returning client_id into v_client_id;

  -- Nothing changed: no row, or its status was not what the caller validated
  -- against. No event — an audit trail records what happened, not what was
  -- attempted.
  if v_client_id is null then
    return null;
  end if;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value
  ) values (
    'application_status_changed', 'application', p_application_id,
    v_client_id, p_application_id,
    p_actor_profile_id,
    case when p_actor_profile_id is null then 'system' else 'human' end,
    p_source,
    jsonb_build_object('status', p_expected_status),
    jsonb_build_object('status', p_new_status)
  );

  return p_application_id;
end;
$$;


-- ----------------------------------------------------------------------------
-- D2. Requirement slot status
-- ----------------------------------------------------------------------------
create or replace function public.record_requirement_slot_status_change(
  p_slot_id uuid,
  p_expected_status text,
  p_new_status text,
  p_source text,
  p_actor_profile_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_application_id uuid;
  v_client_id uuid;
begin
  update public.requirement_slots
  set status = p_new_status,
      status_changed_at = now(),
      status_changed_by_profile_id = p_actor_profile_id,
      status_changed_source = p_source
  where id = p_slot_id
    and status = p_expected_status
  returning application_id into v_application_id;

  if v_application_id is null then
    return null;
  end if;

  -- requirement_slots.application_id is NOT NULL and applications.client_id is
  -- NOT NULL, so both dimensions always resolve for a slot that exists.
  select client_id into v_client_id
  from public.applications
  where id = v_application_id;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value
  ) values (
    'requirement_status_changed', 'requirement_slot', p_slot_id,
    v_client_id, v_application_id,
    p_actor_profile_id,
    case when p_actor_profile_id is null then 'system' else 'human' end,
    p_source,
    jsonb_build_object('status', p_expected_status),
    jsonb_build_object('status', p_new_status)
  );

  return p_slot_id;
end;
$$;


-- ----------------------------------------------------------------------------
-- D3. Alert resolve / reactivate
-- ----------------------------------------------------------------------------
-- Reproduces setAlertStatus exactly, including the `.neq("active",
-- targetActive)` guard that makes a repeat call a no-op, and including the
-- clearing of the resolution episode on reactivation. That clearing is
-- precisely why this event matters: once an alert is reactivated the database
-- retains no evidence it was ever resolved.
create or replace function public.record_alert_status_change(
  p_alert_id uuid,
  p_target_active boolean,
  p_actor_profile_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_client_id uuid;
begin
  update public.dossier_alerts
  set active = p_target_active,
      resolved_at = case when p_target_active then null else now() end,
      resolved_by_profile_id = case when p_target_active then null else p_actor_profile_id end
  where id = p_alert_id
    and active <> p_target_active
  returning client_id into v_client_id;

  -- No row: either the alert does not exist or it is already in the target
  -- state. Both are no-ops in the existing service, and neither is an event.
  if v_client_id is null then
    return null;
  end if;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value
  ) values (
    case when p_target_active then 'alert_reactivated' else 'alert_resolved' end,
    'dossier_alert', p_alert_id,
    v_client_id, null,
    p_actor_profile_id,
    case when p_actor_profile_id is null then 'system' else 'human' end,
    'crm_manual',
    -- The guard above proves the prior value was the opposite of the target.
    jsonb_build_object('active', not p_target_active),
    jsonb_build_object('active', p_target_active)
  );

  return p_alert_id;
end;
$$;


-- ----------------------------------------------------------------------------
-- D4. Client status
-- ----------------------------------------------------------------------------
-- setClientStatus performs a blind UPDATE and therefore never knew the prior
-- value. The read moves inside the transaction here, which is the only place
-- it can be taken safely: `for update` holds the row so the value written to
-- previous_value is genuinely the value being replaced, not one that another
-- transaction has already changed.
create or replace function public.record_client_status_change(
  p_client_id uuid,
  p_new_status text,
  p_actor_profile_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_previous_status text;
begin
  select status into v_previous_status
  from public.clients
  where id = p_client_id
  for update;

  -- No such client. The caller maps NULL to its existing CLIENT_NOT_FOUND.
  if v_previous_status is null then
    return null;
  end if;

  -- Genuine no-op. The existing service treats a same-status write as a
  -- success, so this still returns the id — but it writes no event, because
  -- nothing changed and a trail of non-changes is noise, not history.
  if v_previous_status = p_new_status then
    return p_client_id;
  end if;

  update public.clients
  set status = p_new_status
  where id = p_client_id;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value
  ) values (
    'client_status_changed', 'client', p_client_id,
    p_client_id, null,
    p_actor_profile_id,
    case when p_actor_profile_id is null then 'system' else 'human' end,
    'crm_manual',
    jsonb_build_object('status', v_previous_status),
    jsonb_build_object('status', p_new_status)
  );

  return p_client_id;
end;
$$;


-- ----------------------------------------------------------------------------
-- D5. Client profile update
-- ----------------------------------------------------------------------------
-- ============================================================================
-- PRIVACY RULE — THE ONE THING THAT MUST NEVER BE RELAXED HERE
-- ============================================================================
-- This function records WHICH FIELDS changed. It NEVER records what they
-- changed from or to. Client PII — identification number, e-mail, phone,
-- salary, birth date, nationality, address, position, employer — is not
-- written to crm_events under any circumstance.
--
-- The reason is structural, not stylistic: crm_events is deliberately
-- append-only with no delete path, so any personal value copied into it can
-- never be corrected or erased. The event answers WHO changed the profile,
-- WHEN, and WHICH fields — which is what an audit trail is for. What the
-- values were is what the clients table is for.
--
-- Both previous_value and new_value carry the same {"fields":[...]} list: the
-- set of changed fields is a single fact about the edit, and inventing an
-- asymmetry would imply value-level detail that is deliberately absent.
-- ============================================================================
create or replace function public.record_client_profile_update(
  p_client_id uuid,
  p_full_name text,
  p_identification_type text,
  p_identification_number text,
  p_phone text,
  p_email text,
  p_address text,
  p_company_legacy_id text,
  p_position text,
  p_monthly_salary numeric,
  p_birth_date date,
  p_nationality text,
  p_observations text,
  p_actor_profile_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_current public.clients%rowtype;
  v_fields text[] := array[]::text[];
begin
  select * into v_current
  from public.clients
  where id = p_client_id
  for update;

  if v_current.id is null then
    return null;
  end if;

  -- `is distinct from` throughout: company_legacy_id and observations are
  -- nullable, and `<>` would evaluate to NULL rather than TRUE when one side
  -- is null, silently missing a real change.
  if v_current.full_name             is distinct from p_full_name             then v_fields := v_fields || 'fullName'; end if;
  if v_current.identification_type   is distinct from p_identification_type   then v_fields := v_fields || 'identificationType'; end if;
  if v_current.identification_number is distinct from p_identification_number then v_fields := v_fields || 'identificationNumber'; end if;
  if v_current.phone                 is distinct from p_phone                 then v_fields := v_fields || 'phone'; end if;
  if v_current.email                 is distinct from p_email                 then v_fields := v_fields || 'email'; end if;
  if v_current.address               is distinct from p_address               then v_fields := v_fields || 'address'; end if;
  if v_current.company_legacy_id     is distinct from p_company_legacy_id     then v_fields := v_fields || 'companyLegacyId'; end if;
  if v_current."position"            is distinct from p_position              then v_fields := v_fields || 'position'; end if;
  if v_current.monthly_salary        is distinct from p_monthly_salary        then v_fields := v_fields || 'monthlySalary'; end if;
  if v_current.birth_date            is distinct from p_birth_date            then v_fields := v_fields || 'birthDate'; end if;
  if v_current.nationality           is distinct from p_nationality           then v_fields := v_fields || 'nationality'; end if;
  if v_current.observations          is distinct from p_observations          then v_fields := v_fields || 'observations'; end if;

  -- Nothing genuinely changed. The existing service treats a no-change save as
  -- a success and returns the row, so this does too — without fabricating an
  -- audit event for an edit that did not happen.
  if array_length(v_fields, 1) is null then
    return p_client_id;
  end if;

  -- A duplicate (identification_type, identification_number) raises 23505 from
  -- clients_identification_type_identification_number_key exactly as it does
  -- today. The exception aborts this whole function, so neither the update nor
  -- the event is written, and the caller still sees SQLSTATE 23505 and maps it
  -- to DUPLICATE_IDENTIFICATION.
  update public.clients
  set full_name = p_full_name,
      identification_type = p_identification_type,
      identification_number = p_identification_number,
      phone = p_phone,
      email = p_email,
      address = p_address,
      company_legacy_id = p_company_legacy_id,
      "position" = p_position,
      monthly_salary = p_monthly_salary,
      birth_date = p_birth_date,
      nationality = p_nationality,
      observations = p_observations
  where id = p_client_id;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value
  ) values (
    'client_profile_updated', 'client', p_client_id,
    p_client_id, null,
    p_actor_profile_id,
    case when p_actor_profile_id is null then 'system' else 'human' end,
    'crm_manual',
    -- FIELD NAMES ONLY. No values. See the privacy rule above.
    jsonb_build_object('fields', to_jsonb(v_fields)),
    jsonb_build_object('fields', to_jsonb(v_fields))
  );

  return p_client_id;
end;
$$;


-- ----------------------------------------------------------------------------
-- E. Function privileges — Milestone 16 security floor
-- ----------------------------------------------------------------------------
-- A SECURITY DEFINER function runs as its owner (postgres). Leaving EXECUTE
-- available to PUBLIC on such a function is exactly the privilege-escalation
-- shape Milestone 16 removed from rls_auto_enable, so each one is revoked from
-- PUBLIC and granted only to the role the server actually uses.

revoke execute on function public.record_application_status_change(uuid, text, text, text, uuid) from public;
revoke execute on function public.record_requirement_slot_status_change(uuid, text, text, text, uuid) from public;
revoke execute on function public.record_alert_status_change(uuid, boolean, uuid) from public;
revoke execute on function public.record_client_status_change(uuid, text, uuid) from public;
revoke execute on function public.record_client_profile_update(uuid, text, text, text, text, text, text, text, text, numeric, date, text, text, uuid) from public;

revoke execute on function public.record_application_status_change(uuid, text, text, text, uuid) from anon, authenticated;
revoke execute on function public.record_requirement_slot_status_change(uuid, text, text, text, uuid) from anon, authenticated;
revoke execute on function public.record_alert_status_change(uuid, boolean, uuid) from anon, authenticated;
revoke execute on function public.record_client_status_change(uuid, text, uuid) from anon, authenticated;
revoke execute on function public.record_client_profile_update(uuid, text, text, text, text, text, text, text, text, numeric, date, text, text, uuid) from anon, authenticated;

grant execute on function public.record_application_status_change(uuid, text, text, text, uuid) to service_role;
grant execute on function public.record_requirement_slot_status_change(uuid, text, text, text, uuid) to service_role;
grant execute on function public.record_alert_status_change(uuid, boolean, uuid) to service_role;
grant execute on function public.record_client_status_change(uuid, text, uuid) to service_role;
grant execute on function public.record_client_profile_update(uuid, text, text, text, text, text, text, text, text, numeric, date, text, text, uuid) to service_role;
