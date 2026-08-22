-- ============================================================================
-- MILESTONE 26B-6B — NEW LEADS GET AN OWNER IMMEDIATELY
-- ============================================================================
--
-- A prospect who finishes Step 1 should already belong to someone. Waiting for
-- a manager to notice and assign them is how leads go cold, and it is the whole
-- reason 26B-5A started capturing them this early.
--
-- Distribution is EQUAL ROUND-ROBIN. Not random — random is untestable, and
-- over small volumes it is visibly unfair to whoever loses the coin flips. Not
-- "advisor with fewest open leads" either: that is a capacity model, and
-- capacity, vacation and specialisation are deliberately out of scope here.
--
-- ----------------------------------------------------------------------------
-- BEING ACTIVE IS NOT THE SAME AS BEING IN THE ROTATION
-- ----------------------------------------------------------------------------
-- `active` means "works here". Receiving automatically distributed leads is a
-- separate operational decision an administrator makes — someone can be a
-- perfectly active advisor who handles only walk-ins, or be on leave without
-- being deactivated. Hence a distinct flag, defaulting to FALSE for every
-- existing row so nobody silently starts receiving leads because of a
-- migration.


-- ----------------------------------------------------------------------------
-- 1. WHO PARTICIPATES
-- ----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists auto_assignment_enabled boolean not null default false;

comment on column public.profiles.auto_assignment_enabled is
  'MILESTONE 26B-6B. Does this advisor receive automatically distributed portal '
  'leads? Deliberately separate from `active`: an active advisor may be excluded '
  'from the rotation without being deactivated. Defaults FALSE — participation '
  'is an explicit administrator choice, never inherited from a migration.';

-- The rotation reads this set on every allocation; keep it cheap.
create index if not exists profiles_auto_assignment_pool_idx
  on public.profiles (id)
  where role = 'asesor' and active and auto_assignment_enabled and auth_user_id is not null;


-- ----------------------------------------------------------------------------
-- 2. THE ROTATION CURSOR
-- ----------------------------------------------------------------------------
-- ONE ROW, FOREVER. `id boolean primary key default true check (id)` is the
-- smallest way to say "there is exactly one of these": the only permitted value
-- is true, and the primary key forbids a second.
--
-- It stores WHO WAS LAST GIVEN A LEAD, not an index. That distinction is what
-- makes the pool safe to change: an integer position would point at the wrong
-- advisor the moment somebody was added, disabled or deactivated, whereas
-- "hand it to the first eligible advisor ordered after this one" stays correct
-- no matter how the pool moves. A departed advisor's id keeps working as a
-- comparison key even once they are no longer eligible themselves.
create table if not exists public.lead_distribution_state (
  id boolean primary key default true check (id),
  last_advisor_profile_id uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.lead_distribution_state (id, last_advisor_profile_id)
values (true, null)
on conflict (id) do nothing;

comment on table public.lead_distribution_state is
  'MILESTONE 26B-6B. Single-row round-robin cursor holding the advisor who most '
  'recently received an automatically distributed lead. Locked FOR UPDATE during '
  'allocation, which is what serialises concurrent Step 1 submissions.';

alter table public.lead_distribution_state enable row level security;
revoke all on table public.lead_distribution_state from public;
revoke all on table public.lead_distribution_state from anon;
revoke all on table public.lead_distribution_state from authenticated;
grant select, update on table public.lead_distribution_state to service_role;


-- ----------------------------------------------------------------------------
-- 3. ALLOCATION
-- ----------------------------------------------------------------------------
-- CONCURRENCY. Two customers finishing Step 1 at the same instant must not both
-- read the same cursor and be handed the same advisor. The cursor row is taken
-- FOR UPDATE before the pool is read, so the second transaction blocks until the
-- first commits and then sees the advanced cursor. The lock is held for the few
-- statements below and released at commit — no advisory lock to leak, no
-- retry loop.
--
-- THE PUBLIC NEVER CHOOSES. There is no advisor parameter: the caller supplies
-- an application and gets whatever the rotation says. Execute is granted to
-- service_role only, so the portal's browser cannot reach it at all.
--
-- ELIGIBILITY IS THE SAME RULE THE MANUAL PATH USES, plus participation. Branch
-- reach is delegated to profile_has_operational_branch_scope rather than
-- re-expressed — a branchless draft therefore still requires a national-scope
-- advisor, exactly as before.
create or replace function public.auto_assign_lead_advisor(p_application_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_branch      uuid;
  v_client      uuid;
  v_current     uuid;
  v_last        uuid;
  v_next        uuid;
begin
  select assigned_advisor_profile_id, branch_id, client_id
    into v_current, v_branch, v_client
    from public.applications
   where id = p_application_id
     for update;

  if not found then
    return null;
  end if;

  -- EXISTING OWNER IS NEVER OVERWRITTEN. This is what makes the function safe
  -- to call again on later portal steps, and what stops a manual reassignment
  -- from being undone by the customer simply continuing their application.
  if v_current is not null then
    return v_current;
  end if;

  select last_advisor_profile_id into v_last
    from public.lead_distribution_state
   where id = true
     for update;

  -- The next eligible advisor after the last one served...
  select p.id into v_next
    from public.profiles p
   where p.role = 'asesor'
     and p.active
     and p.auth_user_id is not null
     and p.auto_assignment_enabled
     and public.profile_has_operational_branch_scope(p.id, v_branch)
     and (v_last is null or p.id > v_last)
   order by p.id
   limit 1;

  -- ...or, having run off the end, wrap to the first. Two statements rather
  -- than one clever one, because "next, else wrap" is the whole algorithm and
  -- it should be readable as such.
  if v_next is null then
    select p.id into v_next
      from public.profiles p
     where p.role = 'asesor'
       and p.active
       and p.auth_user_id is not null
       and p.auto_assignment_enabled
       and public.profile_has_operational_branch_scope(p.id, v_branch)
     order by p.id
     limit 1;
  end if;

  -- NO ELIGIBLE ADVISOR IS NOT AN ERROR. The customer's application must still
  -- exist; it simply arrives unowned for someone to pick up. Raising here would
  -- fail a member of the public's submission over an internal staffing gap.
  if v_next is null then
    return null;
  end if;

  update public.lead_distribution_state
     set last_advisor_profile_id = v_next,
         updated_at = now()
   where id = true;

  update public.applications
     set assigned_advisor_profile_id = v_next
   where id = p_application_id;

  -- Same event type the manual path writes, so one timeline shows both. What
  -- distinguishes them is the actor: automatic assignment has no profile behind
  -- it and is marked 'system', and `mechanism` states it outright rather than
  -- leaving a reader to infer it from a null.
  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value, branch_id
  ) values (
    'application_advisor_assigned', 'application', p_application_id,
    v_client, p_application_id,
    null, 'system', 'website_form',
    null,
    jsonb_build_object('advisorProfileId', v_next, 'mechanism', 'automatic'),
    v_branch
  );

  return v_next;
end;
$function$;

comment on function public.auto_assign_lead_advisor(uuid) is
  'MILESTONE 26B-6B. Assigns one newly captured lead to the next advisor in an '
  'equal round-robin over the opted-in, eligible pool. Idempotent: an application '
  'that already has an owner is returned unchanged. Returns NULL when no advisor '
  'is eligible, which leaves the lead unassigned rather than failing the '
  'customer''s submission. Serialised by a FOR UPDATE lock on the cursor row.';

revoke all on function public.auto_assign_lead_advisor(uuid) from public;
revoke all on function public.auto_assign_lead_advisor(uuid) from anon;
revoke all on function public.auto_assign_lead_advisor(uuid) from authenticated;
grant execute on function public.auto_assign_lead_advisor(uuid) to service_role;
