-- ============================================================================
-- Milestone 24A — Last-administrator guard
-- ============================================================================
--
-- CORRECTIVE MIGRATION. 20260818042204_milestone_24_delegated_permissions
-- deployed successfully and is immutable deployment history: it is NOT
-- amended, rewritten or re-run. This migration replaces two function bodies
-- and changes nothing else — the same posture Milestones 20A, 23A and 23B took.
--
-- ----------------------------------------------------------------------------
-- THE RISK
-- ----------------------------------------------------------------------------
-- Milestone 24 protects administrators FROM OTHERS: A1 stops a delegated
-- manager modifying one, A3/A4 stop anyone modifying themselves. What it does
-- not stop is administrators removing each other, or the last one, entirely:
--
--   * an administrador deactivating the only other administrador
--   * an administrador demoting the only other administrador to gerente
--
-- Either leaves ODL with ZERO active administrators. That state is
-- unrecoverable from inside the product: `user:manage_permissions` is
-- administrador-only and non-delegatable by design, `user:set_role` cannot
-- assign the administrador role except from an administrador (A2), and every
-- staff RPC requires an active actor. Nobody could restore access — recovery
-- would mean direct database surgery.
--
-- ODL is about to scale to multiple branches with multiple administrators, so
-- this stops being theoretical the moment the second administrador exists.
--
-- ----------------------------------------------------------------------------
-- THE INVARIANT
-- ----------------------------------------------------------------------------
-- No operation may result in `count(profiles where role='administrador' and
-- active) = 0`. Two operations can reduce that population:
--
--   set_staff_active_status  active administrador -> inactive
--   update_staff_role        active administrador -> any non-administrador role
--
-- When the target is the LAST active administrador, both are rejected: no
-- mutation, no grant revocation, no crm_events row. Reactivation, promotion to
-- administrador, and every change to a non-administrador are untouched.
--
-- Deliberately NOT enforced with a CHECK constraint or a trigger: the rule is
-- about a TABLE-WIDE aggregate across rows, which a row CHECK cannot see, and a
-- trigger would fire on paths (future migrations, data repair) where an
-- operator may legitimately need to move rows around. Enforcing it in the two
-- RPCs that are the only supported way to change these columns keeps the rule
-- exactly where the mutation is.
--
-- ----------------------------------------------------------------------------
-- CONCURRENCY — WHY AN ADVISORY LOCK
-- ----------------------------------------------------------------------------
-- A naive `if (select count(*) ... ) > 1 then proceed` is a textbook race. Two
-- administradores, A and B, each in their own transaction, each demoting the
-- other: both count TWO active administradores, both conclude "another one
-- exists", both commit, and the platform ends with ZERO. The count is read
-- before either write is visible to the other, so no amount of care in the
-- SELECT fixes it.
--
-- Options considered:
--
--   1. FOR UPDATE on every active administrador row, ORDER BY id. Correct, but
--      it depends on lock-acquisition order matching the sort to avoid
--      deadlock, which is an implementation detail rather than a guarantee —
--      and it interacts with the `for update` this function already takes on
--      the target row.
--   2. SERIALIZABLE isolation. Correct, but it would have to be set by every
--      caller, and PostgREST does not give the application that control per
--      request.
--   3. A transaction-scoped ADVISORY LOCK. One line, no deadlock possible
--      (a single lock key can never be acquired out of order), automatically
--      released on commit OR rollback, and it needs nothing from the caller.
--
-- CHOSEN: (3). The trade-off is that these operations serialize globally — but
-- they are administrative acts measured in a handful per month, not per second,
-- so the contention cost is exactly zero in practice and the correctness
-- guarantee is absolute.
--
-- The lock is taken ONLY on the paths that can reduce the administrador
-- population. Demoting an asesor, deactivating a gerente, or any no-op never
-- touches it, so ordinary staff administration is completely unaffected.
--
-- With the lock held, the second transaction blocks until the first commits,
-- then re-reads and correctly sees that it would now be removing the last one.
--
-- ----------------------------------------------------------------------------
-- ERROR CODE
-- ----------------------------------------------------------------------------
-- SQLSTATE 55000 (object_not_in_prerequisite_state) — a standard code, and an
-- honest description: the system is not in a state where this operation is
-- permitted. Deliberately DISTINCT from 42501 (the actor is not allowed) and
-- 22023 (the arguments are invalid), because this is neither: the caller is a
-- legitimate administrador passing legitimate arguments, and the answer is
-- still no. The service layer maps it to LAST_ADMINISTRATOR so the UI can say
-- something true instead of "update failed".
--
-- ----------------------------------------------------------------------------
-- GUARD ORDERING — WHY IT SITS WHERE IT DOES
-- ----------------------------------------------------------------------------
-- AFTER the A1-A4 authorization and self-modification checks, so an
-- unauthorized caller still gets 42501 and learns nothing about how many
-- administradores exist. AFTER the no-op check, so re-saving an unchanged value
-- never trips it. BEFORE any UPDATE, INSERT or grant revocation, so a rejection
-- leaves the database byte-identical.
--
-- DELIBERATELY UNCHANGED in both functions: signature, return type, SECURITY
-- DEFINER, owner, search_path, execute privileges, the `for update` target
-- lock, A1/A2/A3/A4, no-op semantics, previous-value capture, the crm_events
-- insert shape and event types, actor/source attribution, and — in
-- update_staff_role — the Milestone 24 revoke-all-grants-on-role-change
-- behaviour.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- A. update_staff_role — + last-administrator guard on demotion
-- ----------------------------------------------------------------------------
create or replace function public.update_staff_role(
  p_profile_id uuid,
  p_new_role text,
  p_actor_profile_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

  -- A3.
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

  -- A1.
  if v_previous_role = 'administrador' and v_actor_role <> 'administrador' then
    raise exception 'update_staff_role: only an administrador may modify an administrador'
      using errcode = '42501';
  end if;

  -- A2.
  if p_new_role = 'administrador' and v_actor_role <> 'administrador' then
    raise exception 'update_staff_role: only an administrador may assign the administrador role'
      using errcode = '42501';
  end if;

  -- Genuine no-op: success, no event, grants left alone.
  if v_previous_role = p_new_role then
    return p_profile_id;
  end if;

  -- MILESTONE 24A. Only reached when an ACTIVE administrador is being demoted
  -- — an inactive one contributes nothing to the active population, so
  -- demoting them cannot reduce it.
  if v_previous_role = 'administrador' and v_target_active and p_new_role <> 'administrador' then
    -- Serializes every administrador-reducing operation. Transaction-scoped:
    -- released automatically on COMMIT or ROLLBACK, so a rejected or failed
    -- call leaves nothing behind.
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

  -- Milestone 24 behaviour, unchanged: a role change revokes every additional
  -- grant, one audited event each, in this same transaction.
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
$$;


-- ----------------------------------------------------------------------------
-- B. set_staff_active_status — + last-administrator guard on deactivation
-- ----------------------------------------------------------------------------
-- REACTIVATION IS UNAFFECTED: it can only ever increase the administrador
-- population, so the guard is scoped to p_active = false.
create or replace function public.set_staff_active_status(
  p_profile_id uuid,
  p_active boolean,
  p_actor_profile_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

  -- A4.
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

  -- A1.
  if v_target_role = 'administrador' and v_actor_role <> 'administrador' then
    raise exception 'set_staff_active_status: only an administrador may modify an administrador'
      using errcode = '42501';
  end if;

  if v_previous_active = p_active then
    return p_profile_id;
  end if;

  -- MILESTONE 24A. Only on a true -> false transition for an administrador.
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
$$;


-- ----------------------------------------------------------------------------
-- C. Execute privileges — unchanged posture, restated
-- ----------------------------------------------------------------------------
revoke execute on function public.update_staff_role(uuid, text, uuid) from public;
revoke execute on function public.set_staff_active_status(uuid, boolean, uuid) from public;

revoke execute on function public.update_staff_role(uuid, text, uuid) from anon, authenticated;
revoke execute on function public.set_staff_active_status(uuid, boolean, uuid) from anon, authenticated;

grant execute on function public.update_staff_role(uuid, text, uuid) to service_role;
grant execute on function public.set_staff_active_status(uuid, boolean, uuid) to service_role;
