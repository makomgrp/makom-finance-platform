-- ============================================================================
-- MILESTONE 25B-2 — BRANCH MUTATION ENFORCEMENT (DATABASE DEFENCE IN DEPTH)
-- ============================================================================
--
-- Milestone 25B-1 made branch visibility real on READS. This migration puts the
-- SAME boundary underneath the WRITES, in the database, where a crafted request
-- cannot reach around it.
--
-- WHY THE APPLICATION LAYER IS NOT ENOUGH. Every operational Server Action now
-- re-resolves its target through a scoped read before mutating, which is
-- correct and produces the right error contract. But that check and the write
-- are two separate PostgREST calls, i.e. two separate transactions. A guard
-- living only up there is a TOCTOU window and, more importantly, it is one
-- forgotten line away from being absent. The RPC is the last line, and it is
-- the line that is actually atomic with the mutation.
--
-- WHAT THIS MIGRATION DOES NOT DO. It does NOT duplicate ROLE_CAPABILITIES in
-- PostgreSQL. The database here answers exactly one question — "may this actor
-- operate in this branch?" — which is branch-domain integrity, expressible with
-- roles, scope mode and memberships alone. WHAT the actor may do remains the
-- Server Action's requireCapability() decision and stays defined once, in
-- TypeScript.
--
-- It does NOT accept a branch scope from the caller. Every function below takes
-- only the actor's profile id — which the Server Action supplies from its own
-- getCurrentProfile() and never from the browser — and resolves that actor's
-- effective scope from database facts.
--
-- It does NOT implement transfers (25B-3) or any interactive branch context
-- (25C), and it creates no branch, membership, profile or event row.
-- ============================================================================


-- ============================================================================
-- 1. THE OPERATIONAL SCOPE PREDICATE
-- ============================================================================
--
-- Deliberately SEPARATE from profile_has_branch_scope(), which already exists
-- and must not change. That one is the STAFF-ADMINISTRATION predicate used by
-- the B1/B2/B5/B6 rules, and Milestone 25A-1 established that it stays
-- "scope-pure": it knows about branch_scope_mode and memberships and
-- deliberately knows NOTHING about the administrador role, because the
-- administrator exemptions in those rules are about who may MANAGE a subset,
-- not about who may SEE data. Folding the role into it would silently widen
-- five staff rules.
--
-- This function answers the OPERATIONAL question instead, and mirrors the
-- TypeScript resolver in src/lib/auth/get-current-profile.ts line for line:
--
--   administrador             -> NATIONAL, by role, with no membership needed.
--   branch_scope_mode national-> NATIONAL, when explicitly granted (B4).
--   otherwise                 -> explicit memberships, and NOTHING else.
--
-- NULL TARGET BRANCH = UNASSIGNED, and it is national-only. It is never
-- reinterpreted as "headquarters", "the default branch" or "the actor's own
-- branch" — inventing an owner for an ownerless row is how isolation dies
-- quietly.
--
-- NULL ACTOR = THE SYSTEM, and it is allowed. A null actor_profile_id is how
-- this schema has always represented an automated write with no human behind
-- it: public website intake and document ingestion both pass it, and
-- crm_events already stamps actor_kind = 'system' from exactly this test. Those
-- callers hold the service role and could write these tables directly
-- regardless, so refusing them here would break intake without adding any
-- security. Every human path passes auth.profile.id and can never be null.
--
-- An INACTIVE or MISSING actor profile gets FALSE. Fails closed.
create or replace function public.profile_has_operational_branch_scope(
  p_actor_profile_id uuid,
  p_branch_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select
    case
      when p_actor_profile_id is null then true
      else exists (
        select 1
        from public.profiles p
        where p.id = p_actor_profile_id
          and p.active
          and (
            p.role = 'administrador'
            or p.branch_scope_mode = 'national'
            or exists (
              select 1
              from public.profile_branch_memberships m
              where m.profile_id = p.id
                and m.branch_id = p_branch_id
            )
          )
      )
    end;
$function$;

comment on function public.profile_has_operational_branch_scope(uuid, uuid) is
  'MILESTONE 25B-2. May this actor operate on an operational entity owned by this branch? administrador => national by role; branch_scope_mode=national => national; otherwise explicit membership only. NULL branch (unassigned) is national-only. NULL actor is the system (public intake / ingestion) and is allowed. Inactive or unknown actor => false. Deliberately distinct from profile_has_branch_scope(), which is the staff-administration predicate and must stay scope-pure (see Milestone 25A-1).';

revoke all on function public.profile_has_operational_branch_scope(uuid, uuid) from public;
grant execute on function public.profile_has_operational_branch_scope(uuid, uuid) to service_role;


-- ============================================================================
-- 2. THE DENIAL CONTRACT
-- ============================================================================
--
-- Every function below signals a branch denial by RAISING with SQLSTATE 42501
-- (insufficient_privilege), and every operational service maps that code to its
-- existing NOT_FOUND result — never to a distinct "forbidden" code.
--
-- WHY NOT SIMPLY RETURN NULL. Most of these already return NULL for "nothing
-- matched", and for several that would have been a tidy fit. It is wrong for at
-- least one: record_alert_status_change returns NULL both for "no such alert"
-- AND for "already in the target state", and its service treats the latter as
-- success and reads the row back. A denial returning NULL there would have been
-- swallowed and the alert handed to a caller who may not see it. One uniform
-- signal across all seven is safer than six tidy fits and one silent hole.
--
-- WHY 42501 IS NOT AN EXISTENCE ORACLE HERE. The SQLSTATE never reaches the
-- browser. Each service maps it to the SAME public code it already returns for
-- a nonexistent row, so from outside, "in another branch" and "does not exist"
-- are indistinguishable.
--
-- ORDER MATTERS IN EVERY FUNCTION BELOW: resolve the target and its branch
-- FIRST, deny SECOND, mutate THIRD. A rejected mutation therefore leaves both
-- the business row and crm_events untouched.
-- ============================================================================


-- ============================================================================
-- 3. CLIENT MUTATIONS
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
  p_employer_name text,
  p_actor_profile_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_current public.clients%rowtype;
  v_fields text[] := array[]::text[];
begin
  select * into v_current
  from public.clients
  where id = p_client_id
  for update;

  if not found then
    return null;
  end if;

  -- MILESTONE 25B-2 — branch gate, before any write.
  if not public.profile_has_operational_branch_scope(p_actor_profile_id, v_current.branch_id) then
    raise exception 'Out of branch scope.' using errcode = '42501';
  end if;

  if v_current.full_name             is distinct from p_full_name             then v_fields := array_append(v_fields, 'fullName'); end if;
  if v_current.identification_type   is distinct from p_identification_type   then v_fields := array_append(v_fields, 'identificationType'); end if;
  if v_current.identification_number is distinct from p_identification_number then v_fields := array_append(v_fields, 'identificationNumber'); end if;
  if v_current.phone                 is distinct from p_phone                 then v_fields := array_append(v_fields, 'phone'); end if;
  if v_current.email                 is distinct from p_email                 then v_fields := array_append(v_fields, 'email'); end if;
  if v_current.address               is distinct from p_address               then v_fields := array_append(v_fields, 'address'); end if;
  if v_current.company_legacy_id     is distinct from p_company_legacy_id     then v_fields := array_append(v_fields, 'companyLegacyId'); end if;
  if v_current."position"            is distinct from p_position              then v_fields := array_append(v_fields, 'position'); end if;
  if v_current.monthly_salary        is distinct from p_monthly_salary        then v_fields := array_append(v_fields, 'monthlySalary'); end if;
  if v_current.birth_date            is distinct from p_birth_date            then v_fields := array_append(v_fields, 'birthDate'); end if;
  if v_current.nationality           is distinct from p_nationality           then v_fields := array_append(v_fields, 'nationality'); end if;
  if v_current.observations          is distinct from p_observations          then v_fields := array_append(v_fields, 'observations'); end if;
  if v_current.employer_name         is distinct from p_employer_name         then v_fields := array_append(v_fields, 'employerName'); end if;

  if array_length(v_fields, 1) is null then
    return p_client_id;
  end if;

  update public.clients
  set full_name             = p_full_name,
      identification_type   = p_identification_type,
      identification_number = p_identification_number,
      phone                 = p_phone,
      email                 = p_email,
      address               = p_address,
      company_legacy_id     = p_company_legacy_id,
      "position"            = p_position,
      monthly_salary        = p_monthly_salary,
      birth_date            = p_birth_date,
      nationality           = p_nationality,
      observations          = p_observations,
      employer_name         = p_employer_name
  where id = p_client_id;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value, branch_id
  ) values (
    'client_profile_updated', 'client', p_client_id,
    p_client_id, null,
    p_actor_profile_id,
    case when p_actor_profile_id is null then 'system' else 'human' end,
    'crm_manual',
    null,
    jsonb_build_object('changedFields', to_jsonb(v_fields)),
    -- MILESTONE 25B-2 — the ENTITY's branch, not the actor's.
    v_current.branch_id
  );

  return p_client_id;
end;
$function$;


create or replace function public.record_client_status_change(
  p_client_id uuid,
  p_new_status text,
  p_actor_profile_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_previous_status text;
  v_branch_id uuid;
begin
  select status, branch_id into v_previous_status, v_branch_id
  from public.clients
  where id = p_client_id
  for update;

  -- FOUND, not "is null" — Milestone 23A's lesson: SELECT INTO assigns NULL to
  -- EVERY target when no row matches, so a nullable column can never be used as
  -- a row-existence sentinel.
  if not found then
    return null;
  end if;

  if not public.profile_has_operational_branch_scope(p_actor_profile_id, v_branch_id) then
    raise exception 'Out of branch scope.' using errcode = '42501';
  end if;

  if v_previous_status = p_new_status then
    return p_client_id;
  end if;

  update public.clients
  set status = p_new_status
  where id = p_client_id;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value, branch_id
  ) values (
    'client_status_changed', 'client', p_client_id,
    p_client_id, null,
    p_actor_profile_id,
    case when p_actor_profile_id is null then 'system' else 'human' end,
    'crm_manual',
    jsonb_build_object('status', v_previous_status),
    jsonb_build_object('status', p_new_status),
    v_branch_id
  );

  return p_client_id;
end;
$function$;


create or replace function public.record_client_restriction_change(
  p_client_id uuid,
  p_restricted boolean,
  p_actor_profile_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_previous_restricted boolean;
  v_branch_id uuid;
begin
  select restricted, branch_id into v_previous_restricted, v_branch_id
  from public.clients
  where id = p_client_id
  for update;

  if not found then
    return null;
  end if;

  if not public.profile_has_operational_branch_scope(p_actor_profile_id, v_branch_id) then
    raise exception 'Out of branch scope.' using errcode = '42501';
  end if;

  if v_previous_restricted = p_restricted then
    return p_client_id;
  end if;

  update public.clients
  set restricted = p_restricted
  where id = p_client_id;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value, branch_id
  ) values (
    'client_restriction_changed', 'client', p_client_id,
    p_client_id, null,
    p_actor_profile_id,
    case when p_actor_profile_id is null then 'system' else 'human' end,
    'crm_manual',
    jsonb_build_object('restricted', v_previous_restricted),
    jsonb_build_object('restricted', p_restricted),
    v_branch_id
  );

  return p_client_id;
end;
$function$;


-- ============================================================================
-- 4. APPLICATION STATUS
-- ============================================================================
--
-- RESTRUCTURED, deliberately. The previous body was a single guarded UPDATE
-- whose RETURNING clause supplied client_id. That cannot work here: the branch
-- must be known BEFORE the write, or a denied caller would already have mutated
-- the row by the time we could check. So the row is locked and read first (FOR
-- UPDATE), the gate runs, and only then does the SAME guarded UPDATE run —
-- `and status = p_expected_status` is preserved exactly, so the
-- concurrent-transition protection is unchanged.
create or replace function public.record_application_status_change(
  p_application_id uuid,
  p_expected_status text,
  p_new_status text,
  p_source text,
  p_actor_profile_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_client_id uuid;
  v_branch_id uuid;
  v_current_status text;
begin
  select client_id, branch_id, status
    into v_client_id, v_branch_id, v_current_status
  from public.applications
  where id = p_application_id
  for update;

  if not found then
    return null;
  end if;

  if not public.profile_has_operational_branch_scope(p_actor_profile_id, v_branch_id) then
    raise exception 'Out of branch scope.' using errcode = '42501';
  end if;

  if v_current_status is distinct from p_expected_status then
    return null;
  end if;

  update public.applications
  set status = p_new_status,
      status_changed_at = now(),
      status_changed_by_profile_id = p_actor_profile_id,
      status_changed_source = p_source
  where id = p_application_id
    and status = p_expected_status;

  if not found then
    return null;
  end if;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value, branch_id
  ) values (
    'application_status_changed', 'application', p_application_id,
    v_client_id, p_application_id,
    p_actor_profile_id,
    case when p_actor_profile_id is null then 'system' else 'human' end,
    p_source,
    jsonb_build_object('status', p_expected_status),
    jsonb_build_object('status', p_new_status),
    v_branch_id
  );

  return p_application_id;
end;
$function$;


-- ============================================================================
-- 5. ADVISOR ASSIGNMENT — TWO INDEPENDENT QUESTIONS
-- ============================================================================
--
--   A. MAY THE ACTOR OPERATE ON THIS APPLICATION?
--      -> the ACTOR's effective branch scope vs the application's branch. A
--         gerente may assign only within their own branches, even though
--         `application:assign_advisor` is granted to them everywhere. A
--         delegated capability never creates data scope.
--
--   B. IS THIS ADVISOR ELIGIBLE FOR THIS APPLICATION?
--      -> the ADVISOR's OWN role, active flag, auth link and branch scope.
--         Never the actor's. An administrador assigning nationally still
--         cannot park a Colon-only advisor on a David file.
--
-- The Milestone 23B base invariant is preserved verbatim and the branch clause
-- is ADDITIONAL. Reusing profile_has_operational_branch_scope() for the advisor
-- does NOT make administradores or gerentes assignable: the role = 'asesor'
-- test above it already excluded them. For an UNASSIGNED (NULL branch)
-- application only a legitimately national asesor qualifies — the same rule the
-- directory applies in src/lib/services/profiles.ts.
create or replace function public.record_application_advisor_assignment(
  p_application_id uuid,
  p_advisor_profile_id uuid,
  p_actor_profile_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_previous_advisor uuid;
  v_client_id uuid;
  v_branch_id uuid;
begin
  select assigned_advisor_profile_id, client_id, branch_id
    into v_previous_advisor, v_client_id, v_branch_id
  from public.applications
  where id = p_application_id
  for update;

  if not found then
    return null;
  end if;

  -- (A) the ACTOR's authority over this application.
  if not public.profile_has_operational_branch_scope(p_actor_profile_id, v_branch_id) then
    raise exception 'Out of branch scope.' using errcode = '42501';
  end if;

  if p_advisor_profile_id is not null then
    -- (B.1) Milestone 23B base invariant — unchanged.
    if not exists (
      select 1 from public.profiles
      where id = p_advisor_profile_id
        and role = 'asesor'
        and active
        and auth_user_id is not null
    ) then
      raise exception
        'Profile % is not an assignable advisor (requires role = asesor, active = true, and a linked auth account).',
        p_advisor_profile_id
        using errcode = '22023';
    end if;

    -- (B.2) MILESTONE 25B-2 — the ADVISOR's own branch reach must cover this
    -- application. SAME public code as B.1: from outside, "not an advisor" and
    -- "not an advisor HERE" must look identical, or the error becomes a probe
    -- for which branch a given application belongs to.
    if not public.profile_has_operational_branch_scope(p_advisor_profile_id, v_branch_id) then
      raise exception
        'Profile % is not an assignable advisor (requires role = asesor, active = true, and a linked auth account).',
        p_advisor_profile_id
        using errcode = '22023';
    end if;
  end if;

  if v_previous_advisor is not distinct from p_advisor_profile_id then
    return p_application_id;
  end if;

  update public.applications
  set assigned_advisor_profile_id = p_advisor_profile_id
  where id = p_application_id;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value, branch_id
  ) values (
    'application_advisor_assigned', 'application', p_application_id,
    v_client_id, p_application_id,
    p_actor_profile_id,
    case when p_actor_profile_id is null then 'system' else 'human' end,
    'crm_manual',
    case
      when v_previous_advisor is null then null
      else jsonb_build_object('advisorProfileId', v_previous_advisor)
    end,
    case
      when p_advisor_profile_id is null then jsonb_build_object('advisorProfileId', null)
      else jsonb_build_object('advisorProfileId', p_advisor_profile_id)
    end,
    v_branch_id
  );

  return p_application_id;
end;
$function$;


-- ============================================================================
-- 6. REQUIREMENT SLOT STATUS — AUTHORIZED THROUGH ITS PARENT APPLICATION
-- ============================================================================
--
-- requirement_slots carries no branch_id and deliberately does not gain one.
-- Denormalising branch onto every child table would create a second source of
-- truth that a future transfer would have to keep in step, and any drift
-- between them would be an isolation hole. The parent is resolved here, inside
-- the same transaction as the write.
create or replace function public.record_requirement_slot_status_change(
  p_slot_id uuid,
  p_expected_status text,
  p_new_status text,
  p_source text,
  p_actor_profile_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_application_id uuid;
  v_client_id uuid;
  v_branch_id uuid;
  v_current_status text;
begin
  select s.application_id, s.status, a.client_id, a.branch_id
    into v_application_id, v_current_status, v_client_id, v_branch_id
  from public.requirement_slots s
  join public.applications a on a.id = s.application_id
  where s.id = p_slot_id
  for update of s;

  if not found then
    return null;
  end if;

  if not public.profile_has_operational_branch_scope(p_actor_profile_id, v_branch_id) then
    raise exception 'Out of branch scope.' using errcode = '42501';
  end if;

  if v_current_status is distinct from p_expected_status then
    return null;
  end if;

  update public.requirement_slots
  set status = p_new_status,
      status_changed_at = now(),
      status_changed_by_profile_id = p_actor_profile_id,
      status_changed_source = p_source
  where id = p_slot_id
    and status = p_expected_status;

  if not found then
    return null;
  end if;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value, branch_id
  ) values (
    'requirement_status_changed', 'requirement_slot', p_slot_id,
    v_client_id, v_application_id,
    p_actor_profile_id,
    case when p_actor_profile_id is null then 'system' else 'human' end,
    p_source,
    jsonb_build_object('status', p_expected_status),
    jsonb_build_object('status', p_new_status),
    -- Derived from the canonical parent application, never stored on the slot.
    v_branch_id
  );

  return p_slot_id;
end;
$function$;


-- ============================================================================
-- 7. ALERT STATUS — AUTHORIZED THROUGH ITS PARENT CLIENT
-- ============================================================================
create or replace function public.record_alert_status_change(
  p_alert_id uuid,
  p_target_active boolean,
  p_actor_profile_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_client_id uuid;
  v_branch_id uuid;
  v_current_active boolean;
begin
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
      resolved_by_profile_id = case when p_target_active then null else p_actor_profile_id end
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
    jsonb_build_object('active', p_target_active),
    -- Derived from the canonical parent client.
    v_branch_id
  );

  return p_alert_id;
end;
$function$;


-- ============================================================================
-- 8. STAFF OPERATION SCOPE
-- ============================================================================
--
-- Milestone 25A already solved this problem once, for branch-membership
-- management. assign_profile_branch / remove_profile_branch /
-- set_profile_primary_branch each enforce, for a NON-administrador actor: the
-- branch being touched is inside the actor's scope, the target does not hold
-- national scope, and the target has NO membership outside the actor's scope.
--
-- That third clause is the SUBSET rule, and it is the right one: a manager who
-- can reach branch A must not administer someone who also works in branch B,
-- because that person's employment is not wholly theirs to govern.
--
-- The gap Milestone 25B-2 closes is that update_staff_role and
-- set_staff_active_status — the two most consequential staff mutations — never
-- received it. A gerente holding delegated `user:set_role` could re-role, or
-- deactivate, a colleague in a branch they cannot even see. Rather than write a
-- second, subtly different rule, the existing one is lifted into a named
-- function and reused verbatim.
--
-- WHY A TARGET WITH NO MEMBERSHIPS PASSES. An empty membership set is a subset
-- of every scope, so a scopeless profile is manageable by any manager. That is
-- deliberate and it is what makes invitation work at all: create_staff_profile
-- necessarily produces a profile with zero memberships, and if the empty set
-- were treated as "outside every scope" the manager who just invited someone
-- could neither place them in a branch nor undo the mistake — the Milestone
-- 25A-1 deadlock, repeated. assign_profile_branch has relied on exactly this
-- reading since 25A; this migration reuses it rather than changing it.
--
-- WHY create_staff_profile IS NOT SCOPED. There is no target scope to check at
-- creation time — the profile does not exist yet and has no memberships. Every
-- step that gives the new profile any reach is already bounded:
-- assign_profile_branch confines it to the actor's own branches (B1), and only
-- an administrador may grant national scope (B4) or create an administrador
-- (A2). Adding a branch test to invitation would constrain nothing while
-- breaking the only path a manager has to staff their own office. Stated
-- explicitly rather than left as a silent exception.
--
-- A1-A8, B1-B6 and the M24A last-administrator guard all run exactly as before;
-- the new clause is additive and sits after them.
create or replace function public.staff_target_within_actor_branch_scope(
  p_actor_profile_id uuid,
  p_target_profile_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select
    exists (
      select 1 from public.profiles
      where id = p_actor_profile_id and active and role = 'administrador'
    )
    or (
      not exists (
        select 1 from public.profiles
        where id = p_target_profile_id and branch_scope_mode = 'national'
      )
      and not exists (
        select 1
        from public.profile_branch_memberships m
        where m.profile_id = p_target_profile_id
          and not public.profile_has_branch_scope(p_actor_profile_id, m.branch_id)
      )
    );
$function$;

comment on function public.staff_target_within_actor_branch_scope(uuid, uuid) is
  'MILESTONE 25B-2. May this actor administer this staff profile, on BRANCH grounds only? administrador => yes, nationally. Otherwise the target must not hold national scope and must have no membership outside the actor scope (the same subset rule assign_profile_branch has enforced since 25A). A target with no memberships passes, which is what makes invitation followed by assignment possible. Says nothing about capabilities.';

revoke all on function public.staff_target_within_actor_branch_scope(uuid, uuid) from public;
grant execute on function public.staff_target_within_actor_branch_scope(uuid, uuid) to service_role;


create or replace function public.update_staff_role(
  p_profile_id uuid,
  p_new_role text,
  p_actor_profile_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_previous_role text;
  v_target_active boolean;
  v_actor_role text;
  v_revoked record;
  v_other_admins int;
begin
  select role into v_actor_role
  from public.profiles
  where id = p_actor_profile_id and active;

  if not found then
    raise exception 'update_staff_role: actor is not an active profile'
      using errcode = '42501';
  end if;

  if p_profile_id = p_actor_profile_id then
    raise exception 'update_staff_role: an actor cannot change their own role'
      using errcode = '22023';
  end if;

  if p_new_role not in ('administrador', 'gerente', 'analista', 'asesor', 'consulta') then
    raise exception 'update_staff_role: invalid role "%"', p_new_role using errcode = '22023';
  end if;

  select role, active into v_previous_role, v_target_active
  from public.profiles
  where id = p_profile_id
  for update;

  if not found then
    return null;
  end if;

  if v_previous_role = 'administrador' and v_actor_role <> 'administrador' then
    raise exception 'update_staff_role: only an administrador may modify an administrador'
      using errcode = '42501';
  end if;

  if p_new_role = 'administrador' and v_actor_role <> 'administrador' then
    raise exception 'update_staff_role: only an administrador may assign the administrador role'
      using errcode = '42501';
  end if;

  -- MILESTONE 25B-2 — branch scope over the TARGET. Additive: it runs after
  -- every A-rule above, so administrador protection is unchanged.
  if not public.staff_target_within_actor_branch_scope(p_actor_profile_id, p_profile_id) then
    raise exception 'update_staff_role: target is outside the actor''s branch scope'
      using errcode = '42501';
  end if;

  if v_previous_role = p_new_role then
    return p_profile_id;
  end if;

  if v_previous_role = 'administrador' and v_target_active and p_new_role <> 'administrador' then
    perform pg_advisory_xact_lock(hashtext('odl:last_administrator_guard'));

    select count(*) into v_other_admins
    from public.profiles
    where role = 'administrador' and active and id <> p_profile_id;

    if v_other_admins = 0 then
      raise exception 'update_staff_role: cannot change the role of the last active administrador'
        using errcode = '55000';
    end if;
  end if;

  update public.profiles
  set role = p_new_role
  where id = p_profile_id;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value
  ) values (
    'user_role_changed', 'profile', p_profile_id, null, null,
    p_actor_profile_id, 'human', 'crm_manual',
    jsonb_build_object('role', v_previous_role),
    jsonb_build_object('role', p_new_role)
  );

  for v_revoked in
    delete from public.profile_capability_grants
    where profile_id = p_profile_id
    returning capability
  loop
    insert into public.crm_events (
      event_type, entity_type, entity_id, client_id, application_id,
      actor_profile_id, actor_kind, source, previous_value, new_value
    ) values (
      'user_capability_revoked', 'profile', p_profile_id, null, null,
      p_actor_profile_id, 'human', 'crm_manual',
      jsonb_build_object('capability', v_revoked.capability),
      null
    );
  end loop;

  return p_profile_id;
end;
$function$;


create or replace function public.set_staff_active_status(
  p_profile_id uuid,
  p_active boolean,
  p_actor_profile_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_previous_active boolean;
  v_target_role text;
  v_actor_role text;
  v_other_admins int;
begin
  select role into v_actor_role
  from public.profiles
  where id = p_actor_profile_id and active;

  if not found then
    raise exception 'set_staff_active_status: actor is not an active profile'
      using errcode = '42501';
  end if;

  if p_profile_id = p_actor_profile_id then
    raise exception 'set_staff_active_status: an actor cannot change their own active status'
      using errcode = '22023';
  end if;

  select active, role into v_previous_active, v_target_role
  from public.profiles
  where id = p_profile_id
  for update;

  if not found then
    return null;
  end if;

  if v_target_role = 'administrador' and v_actor_role <> 'administrador' then
    raise exception 'set_staff_active_status: only an administrador may modify an administrador'
      using errcode = '42501';
  end if;

  -- MILESTONE 25B-2 — branch scope over the TARGET. Additive, after the
  -- administrador protection above and before the last-administrator guard
  -- below, both of which are unchanged.
  if not public.staff_target_within_actor_branch_scope(p_actor_profile_id, p_profile_id) then
    raise exception 'set_staff_active_status: target is outside the actor''s branch scope'
      using errcode = '42501';
  end if;

  if v_previous_active = p_active then
    return p_profile_id;
  end if;

  if v_target_role = 'administrador' and not p_active then
    perform pg_advisory_xact_lock(hashtext('odl:last_administrator_guard'));

    select count(*) into v_other_admins
    from public.profiles
    where role = 'administrador' and active and id <> p_profile_id;

    if v_other_admins = 0 then
      raise exception 'set_staff_active_status: cannot deactivate the last active administrador'
        using errcode = '55000';
    end if;
  end if;

  update public.profiles
  set active = p_active
  where id = p_profile_id;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value
  ) values (
    case when p_active then 'user_reactivated' else 'user_deactivated' end,
    'profile', p_profile_id, null, null,
    p_actor_profile_id, 'human', 'crm_manual',
    jsonb_build_object('active', v_previous_active),
    jsonb_build_object('active', p_active)
  );

  return p_profile_id;
end;
$function$;


-- ============================================================================
-- 9. POSTURE PRESERVED
-- ============================================================================
-- Every function above keeps the exact posture it already had: SECURITY
-- DEFINER, owner postgres, `search_path = public, pg_temp`, and the same
-- argument list and return type — CREATE OR REPLACE, so existing grants are
-- carried over untouched and no dependent object is dropped.
--
-- service_role still has NO INSERT, UPDATE or DELETE on public.crm_events. The
-- audit trail remains append-only-by-privilege-withholding: these SECURITY
-- DEFINER functions are the only writers, which is why branch attribution
-- cannot be forged from the application layer even though the application layer
-- holds the service key.
