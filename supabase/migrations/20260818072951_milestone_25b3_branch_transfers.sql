-- ============================================================================
-- MILESTONE 25B-3 — BRANCH TRANSFERS
-- ============================================================================
--
-- 25B-1 made branch visibility real on reads. 25B-2 put the same boundary under
-- the writes. This migration adds the one operation that deliberately CROSSES
-- the boundary: moving an operational record from one branch to another.
--
-- A transfer is the only mutation in this system whose whole point is to change
-- who can see a record. That makes it the most dangerous operation in the
-- branch model and the one with the strictest authorization: the actor must be
-- able to operate in the branch the record is LEAVING **and** the branch it is
-- ARRIVING IN. Reaching only one side is not enough — moving a file out of a
-- branch you cannot see is exfiltration, and moving one into a branch you
-- cannot see is dumping.
--
-- TWO INDEPENDENT OWNERSHIP FACTS, TWO INDEPENDENT OPERATIONS. clients.branch_id
-- and applications.branch_id are separate by design (25A), so transferring a
-- client does NOT move that client's applications and transferring an
-- application does NOT move its client. There is deliberately no bulk
-- "move everything" path: a coordinated multi-transfer, if ODL ever wants one,
-- is a UI that calls these two functions explicitly, never a hidden cascade.
--
-- WHAT THIS MIGRATION DOES NOT DO. It adds no event type (25A already defined
-- client_branch_transferred and application_branch_transferred), no unassignment
-- path, no automatic advisor reassignment, no child-row movement, no Storage
-- change, no membership change, and no interactive branch context (25C).
-- ============================================================================


-- ============================================================================
-- 1. CLIENT TRANSFER
-- ============================================================================
--
-- ORDER OF OPERATIONS, and why each step sits where it does:
--
--   1. Lock the client row (FOR UPDATE). Every 25B-2 client mutation takes the
--      same lock on the same row, so a transfer cannot interleave with a status
--      change, a restriction change, a profile edit, or another transfer.
--   2. Read the SOURCE branch from the locked row — never from the caller.
--   3. Reject a nonexistent client by returning NULL, the idiom every other
--      function in this schema uses, which the service maps to its existing
--      NOT_FOUND. No detail leaks.
--   4. Validate the DESTINATION: it must exist and be ACTIVE, and it is locked
--      FOR SHARE so a concurrent deactivation cannot commit between this check
--      and ours. See section 3 on why FOR SHARE and not an advisory lock.
--   5. Authorize BOTH SIDES.
--   6. Detect the no-op and return before writing anything.
--   7. Update, then insert exactly one audit event.
--
-- Steps 4 and 5 both fail as "invalid destination" (22023) when the problem is
-- the destination, and as 42501 when the problem is the actor's reach over the
-- SOURCE. That split is deliberate and explained in section 4.
create or replace function public.transfer_client_branch(
  p_client_id uuid,
  p_destination_branch_id uuid,
  p_actor_profile_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_source_branch_id uuid;
begin
  -- A transfer is always a deliberate human act carrying `branch:transfer`.
  -- There is no automated transfer path, and a NULL actor would additionally
  -- read as "the system" in profile_has_operational_branch_scope() and skip the
  -- scope test entirely. Refuse it outright rather than leave that door ajar.
  if p_actor_profile_id is null then
    raise exception 'transfer_client_branch: an actor profile is required'
      using errcode = '42501';
  end if;

  -- DESTINATION MUST BE A REAL, ACTIVE BRANCH. NULL is not an "unassign"
  -- shortcut: unassignment is a different product decision and is not
  -- authorized in this milestone.
  if p_destination_branch_id is null then
    raise exception 'transfer_client_branch: destination branch is required'
      using errcode = '22023';
  end if;

  select branch_id into v_source_branch_id
  from public.clients
  where id = p_client_id
  for update;

  if not found then
    return null;
  end if;

  -- Destination existence + active, locked FOR SHARE so it cannot be
  -- deactivated out from under this transaction.
  perform 1
  from public.branches
  where id = p_destination_branch_id
    and active
  for share;

  if not found then
    raise exception 'transfer_client_branch: destination branch does not exist or is inactive'
      using errcode = '22023';
  end if;

  -- SOURCE SIDE. A NULL source is UNASSIGNED and is national-only, which falls
  -- out of the predicate rather than needing its own branch here: an
  -- administrador (national by role) may route legacy and public-intake records
  -- into a real branch, and a branch-scoped user may not touch them at all.
  if not public.profile_has_operational_branch_scope(p_actor_profile_id, v_source_branch_id) then
    raise exception 'transfer_client_branch: source is outside the actor''s branch scope'
      using errcode = '42501';
  end if;

  -- DESTINATION SIDE. Deliberately the SAME code as "destination does not exist
  -- or is inactive": a caller must not be able to tell an active branch they
  -- cannot reach from one that is not there. Delegating `branch:transfer` grants
  -- the ACTION, never the reach — a gerente still moves records only between
  -- branches they already hold.
  if not public.profile_has_operational_branch_scope(p_actor_profile_id, p_destination_branch_id) then
    raise exception 'transfer_client_branch: destination branch does not exist or is inactive'
      using errcode = '22023';
  end if;

  -- NO-OP. Already there: no write, no event, no noise in the activity feed.
  if v_source_branch_id is not distinct from p_destination_branch_id then
    return p_client_id;
  end if;

  update public.clients
  set branch_id = p_destination_branch_id
  where id = p_client_id;

  -- THE EVENT IS STAMPED TO THE SOURCE BRANCH. This event records a departure,
  -- and it is the last thing that happened while the record still belonged to
  -- the source. Every later event stamps the destination on its own, so the
  -- audit trail reads truthfully end to end:
  --   pre-transfer events -> source | transfer event -> source | after -> dest.
  -- A NULL source yields a NULL-stamped event, which is correct: nobody owned
  -- the record before this moment.
  --
  -- PAYLOAD IS BRANCH IDS AND NOTHING ELSE. No branch name, no client name, no
  -- identification number, no address, phone or e-mail — an audit row is
  -- permanent and uncorrectable, so it carries no PII.
  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value, branch_id
  ) values (
    'client_branch_transferred', 'client', p_client_id,
    p_client_id, null,
    p_actor_profile_id, 'human', 'crm_manual',
    jsonb_build_object('branchId', v_source_branch_id),
    jsonb_build_object('branchId', p_destination_branch_id),
    v_source_branch_id
  );

  return p_client_id;
end;
$function$;

comment on function public.transfer_client_branch(uuid, uuid, uuid) is
  'MILESTONE 25B-3. Moves a client to another branch. Requires the actor to hold operational scope over BOTH the source and the destination; administrador is national by role. Destination must be a real ACTIVE branch (NULL is not an unassign path); a NULL source is unassigned and reachable only by national scope. No-op when already there, writing no event. Emits exactly one client_branch_transferred stamped to the SOURCE branch. Does not move the client applications.';

revoke all on function public.transfer_client_branch(uuid, uuid, uuid) from public;
revoke all on function public.transfer_client_branch(uuid, uuid, uuid) from anon;
revoke all on function public.transfer_client_branch(uuid, uuid, uuid) from authenticated;
grant execute on function public.transfer_client_branch(uuid, uuid, uuid) to service_role;


-- ============================================================================
-- 2. APPLICATION TRANSFER — AND THE ADVISOR PROBLEM
-- ============================================================================
--
-- Identical authorization to the client transfer, plus one thing a client
-- transfer does not have to deal with: an application can be OWNED BY A PERSON.
--
-- WHY THE ADVISOR CANNOT SIMPLY RIDE ALONG. `assigned_advisor_profile_id` is
-- governed by the Milestone 23B invariant plus the 25B-2 branch clause: an
-- advisor must be an active, auth-linked asesor whose OWN branch reach covers
-- the application. Moving the application changes the right-hand side of that
-- test. Leaving the advisor attached would leave a file owned by somebody who
-- can no longer open it — a silent, invisible break in the exact invariant
-- record_application_advisor_assignment enforces on every assignment.
--
-- So the advisor is RE-EVALUATED against the destination, using the same
-- predicate the assignment RPC uses, and CLEARED if no longer eligible. Never
-- reassigned: picking a replacement is a human decision about who owns a file,
-- and this function has no basis to make it.
--
-- EVENT ORDER: ADVISOR-CLEAR FIRST, TRANSFER SECOND.
--   The clear happens because the record is still, at that instant, in the
--   source branch and its owner is about to become invalid; the transfer event
--   is then the FINAL ownership fact of the transaction. Reading the feed
--   forward you see "this file lost its advisor, then it moved", which is the
--   causal story. Both events are stamped to the SOURCE branch, both are
--   written in this one transaction, and neither can exist without the other.
--
--   HONEST LIMITATION: crm_events.occurred_at defaults to the transaction
--   timestamp, so both rows carry the SAME occurred_at and a feed ordered by
--   occurred_at alone cannot distinguish them. Insertion order below is the
--   authoritative sequence; the two may render adjacently in either order. That
--   is a display detail, not an audit gap — both events are present, complete
--   and correctly attributed. Changing timestamp semantics to force a split
--   would be a schema-wide change well outside this milestone.
create or replace function public.transfer_application_branch(
  p_application_id uuid,
  p_destination_branch_id uuid,
  p_actor_profile_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_source_branch_id uuid;
  v_client_id uuid;
  v_advisor_id uuid;
  v_advisor_still_eligible boolean;
begin
  if p_actor_profile_id is null then
    raise exception 'transfer_application_branch: an actor profile is required'
      using errcode = '42501';
  end if;

  if p_destination_branch_id is null then
    raise exception 'transfer_application_branch: destination branch is required'
      using errcode = '22023';
  end if;

  -- ONE LOCK, TAKEN FIRST, HELD FOR EVERYTHING. The source read, the advisor
  -- read, the eligibility evaluation, the branch update, the advisor clear and
  -- both event inserts all happen behind this row lock — which is the same lock
  -- record_application_advisor_assignment and record_application_status_change
  -- take. A concurrent assignment therefore cannot slip an advisor in between
  -- our eligibility check and our write, and two concurrent transfers of the
  -- same application serialize.
  select branch_id, client_id, assigned_advisor_profile_id
    into v_source_branch_id, v_client_id, v_advisor_id
  from public.applications
  where id = p_application_id
  for update;

  if not found then
    return null;
  end if;

  perform 1
  from public.branches
  where id = p_destination_branch_id
    and active
  for share;

  if not found then
    raise exception 'transfer_application_branch: destination branch does not exist or is inactive'
      using errcode = '22023';
  end if;

  if not public.profile_has_operational_branch_scope(p_actor_profile_id, v_source_branch_id) then
    raise exception 'transfer_application_branch: source is outside the actor''s branch scope'
      using errcode = '42501';
  end if;

  if not public.profile_has_operational_branch_scope(p_actor_profile_id, p_destination_branch_id) then
    raise exception 'transfer_application_branch: destination branch does not exist or is inactive'
      using errcode = '22023';
  end if;

  -- NO-OP: nothing moves, so the advisor is not re-evaluated either. An
  -- advisor who is currently attached stays attached, and no event is written.
  if v_source_branch_id is not distinct from p_destination_branch_id then
    return p_application_id;
  end if;

  update public.applications
  set branch_id = p_destination_branch_id
  where id = p_application_id;

  -- ADVISOR RE-EVALUATION. Exactly the Milestone 23B base invariant plus the
  -- 25B-2 branch clause, evaluated against the DESTINATION — the same two tests
  -- record_application_advisor_assignment applies, deliberately not a second
  -- copy of the rule expressed differently.
  if v_advisor_id is not null then
    select
      exists (
        select 1 from public.profiles
        where id = v_advisor_id
          and role = 'asesor'
          and active
          and auth_user_id is not null
      )
      and public.profile_has_operational_branch_scope(v_advisor_id, p_destination_branch_id)
      into v_advisor_still_eligible;

    if not v_advisor_still_eligible then
      update public.applications
      set assigned_advisor_profile_id = null
      where id = p_application_id;

      -- The EXISTING assignment event type, with a null new value — the same
      -- shape an ordinary manual unassignment produces, so the activity feed
      -- and any future reader need no special case. Stamped to the SOURCE
      -- branch: the advisor was still the source branch's advisor when they
      -- lost the file.
      insert into public.crm_events (
        event_type, entity_type, entity_id, client_id, application_id,
        actor_profile_id, actor_kind, source, previous_value, new_value, branch_id
      ) values (
        'application_advisor_assigned', 'application', p_application_id,
        v_client_id, p_application_id,
        p_actor_profile_id, 'human', 'crm_manual',
        jsonb_build_object('advisorProfileId', v_advisor_id),
        jsonb_build_object('advisorProfileId', null),
        v_source_branch_id
      );
    end if;
  end if;

  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value, branch_id
  ) values (
    'application_branch_transferred', 'application', p_application_id,
    v_client_id, p_application_id,
    p_actor_profile_id, 'human', 'crm_manual',
    jsonb_build_object('branchId', v_source_branch_id),
    jsonb_build_object('branchId', p_destination_branch_id),
    v_source_branch_id
  );

  return p_application_id;
end;
$function$;

comment on function public.transfer_application_branch(uuid, uuid, uuid) is
  'MILESTONE 25B-3. Moves an application to another branch. Requires the actor to hold operational scope over BOTH source and destination; administrador is national by role. Destination must be a real ACTIVE branch; a NULL source is unassigned and reachable only by national scope. Re-evaluates the assigned advisor against the destination using the M23B invariant plus the 25B-2 branch clause and CLEARS the assignment when no longer eligible, emitting application_advisor_assigned with a null new value BEFORE the transfer event. Never picks a replacement advisor. No-op when already there, writing no event. Emits exactly one application_branch_transferred stamped to the SOURCE branch. Does not move the client.';

revoke all on function public.transfer_application_branch(uuid, uuid, uuid) from public;
revoke all on function public.transfer_application_branch(uuid, uuid, uuid) from anon;
revoke all on function public.transfer_application_branch(uuid, uuid, uuid) from authenticated;
grant execute on function public.transfer_application_branch(uuid, uuid, uuid) to service_role;


-- ============================================================================
-- 3. WHY FOR SHARE ON THE DESTINATION, AND NOT MORE LOCKING
-- ============================================================================
--
-- `FOR SHARE` on the destination branch row blocks a concurrent
-- set_branch_active(false) from committing until this transaction ends, which
-- closes the "validated active, committed into a branch that just closed" race
-- without taking any global or advisory lock. Other transfers into the same
-- branch share the lock freely, so branches do not serialize against each
-- other.
--
-- ADVISOR MEMBERSHIP IS DELIBERATELY NOT LOCKED. Under READ COMMITTED a
-- membership could be added or removed just after the eligibility test. Locking
-- every membership row would still not help: no lock can prevent a membership
-- that does not exist yet from being created a moment later. The condition is
-- also benign and self-correcting — eligibility is re-tested on every
-- subsequent assignment, and an advisor who loses a membership after a transfer
-- is in exactly the position of an advisor who loses one at any other time:
-- historically attributed, not re-assignable. The application row lock covers
-- the races that can actually corrupt state (concurrent assignment, concurrent
-- status change, concurrent transfer); membership drift cannot.
--
-- ============================================================================
-- 4. ERROR CONTRACT
-- ============================================================================
--
--   NULL return          the entity does not exist -> service maps to NOT_FOUND
--   42501                the ACTOR cannot reach the SOURCE, or no actor was
--                        supplied -> service maps to NOT_FOUND, so an
--                        unreachable record is indistinguishable from an absent
--                        one, exactly as in 25B-2
--   22023                the DESTINATION is missing, inactive, NULL, or outside
--                        the actor's reach — all four collapse to one code on
--                        purpose, so the error cannot be used to discover which
--                        branches exist or which ones the caller lacks
--
-- ============================================================================
-- 5. POSTURE
-- ============================================================================
-- Both functions are SECURITY DEFINER, owner postgres,
-- `search_path = public, pg_temp`, with EXECUTE revoked from PUBLIC, anon and
-- authenticated and granted only to service_role.
--
-- service_role still has NO INSERT, UPDATE or DELETE on public.crm_events, and
-- gains no direct write path to clients.branch_id or applications.branch_id
-- from this migration. These two functions are the only way to change branch
-- ownership, which is what makes the transfer audit trail unforgeable from the
-- application layer even though that layer holds the service key.
