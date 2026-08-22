-- ============================================================================
-- MILESTONE 26B-6C — THE CLIENT ROW IS THE CURRENT PROFILE
-- ============================================================================
--
-- A returning customer's `clients` row must reflect the LATEST thing ODL knows
-- about them. Their applications and intakes must keep reflecting what was true
-- WHEN EACH ONE WAS FILED. Those are two different jobs and this function does
-- exactly one of them: it advances the current profile. It writes to `clients`
-- and to nothing else, so no historical snapshot can be rewritten by it.
--
-- ----------------------------------------------------------------------------
-- NON-DESTRUCTIVE BY CONSTRUCTION
-- ----------------------------------------------------------------------------
-- Every parameter is OPTIONAL in the real sense: a NULL or blank argument means
-- "this channel did not ask", NOT "the customer has no such value". Each column
-- therefore resolves to
--
--     coalesce(nullif(btrim(incoming), ''), existing)
--
-- so an omitted field can never erase a value ODL already holds. This is the
-- one rule that separates a sync from `record_client_profile_update`, which is
-- the staff EDITING surface and deliberately writes every column it is given —
-- correct for a form where a cleared box means "delete this", catastrophic for
-- a portal step that simply never collected the field.
--
-- A newer NON-EMPTY value does replace an older one. That is the point: a
-- customer who changed jobs is now employed somewhere else, and the current
-- profile is supposed to say so.
--
-- IDENTITY IS NEVER SYNCED. full_name, identification_type and
-- identification_number are not parameters at all. They are the anchor the
-- returning-customer match itself is made on
-- (clients_identification_type_identification_number_key), and letting a portal
-- submission move them would let one person's typo silently retarget another
-- person's record. Correcting identity stays a deliberate staff action.
--
-- NO BRANCH GATE, DELIBERATELY. The actor here is the applicant working their
-- own continuation link, not a staff member reaching across the organisation.
-- Branch scope governs which staff may see and touch which records; it is not
-- a rule about whether a customer may update their own details. The caller
-- passes actor_profile_id = NULL and the event is recorded as `system`.
--
-- IDEMPOTENT. A save that changes nothing updates nothing and writes no event,
-- so re-saving Step 2 does not accumulate identical timeline entries.
-- ============================================================================

create or replace function public.sync_client_current_profile(
  p_client_id      uuid,
  p_phone          text default null,
  p_email          text default null,
  p_address        text default null,
  p_birth_date     date default null,
  p_nationality    text default null,
  p_employer_name  text default null,
  p_position       text default null,
  p_monthly_salary numeric default null,
  p_source         text default 'website_form'
)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_current public.clients%rowtype;
  v_fields  text[] := array[]::text[];

  v_phone          text;
  v_email          text;
  v_address        text;
  v_birth_date     date;
  v_nationality    text;
  v_employer_name  text;
  v_position       text;
  v_monthly_salary numeric;
begin
  select * into v_current
    from public.clients
   where id = p_client_id
     for update;

  if not found then
    return null;
  end if;

  -- "Keep what we have unless this submission actually supplied something."
  v_phone          := coalesce(nullif(btrim(p_phone), ''),         v_current.phone);
  v_email          := coalesce(nullif(btrim(p_email), ''),         v_current.email);
  v_address        := coalesce(nullif(btrim(p_address), ''),       v_current.address);
  v_birth_date     := coalesce(p_birth_date,                       v_current.birth_date);
  v_nationality    := coalesce(nullif(btrim(p_nationality), ''),   v_current.nationality);
  v_employer_name  := coalesce(nullif(btrim(p_employer_name), ''), v_current.employer_name);
  v_position       := coalesce(nullif(btrim(p_position), ''),      v_current."position");
  -- A declared income of 0 is a real answer and must survive; only NULL means
  -- "not asked". Hence coalesce on the raw value, with no nullif.
  v_monthly_salary := coalesce(p_monthly_salary,                   v_current.monthly_salary);

  if v_current.phone          is distinct from v_phone          then v_fields := array_append(v_fields, 'phone'); end if;
  if v_current.email          is distinct from v_email          then v_fields := array_append(v_fields, 'email'); end if;
  if v_current.address        is distinct from v_address        then v_fields := array_append(v_fields, 'address'); end if;
  if v_current.birth_date     is distinct from v_birth_date     then v_fields := array_append(v_fields, 'birthDate'); end if;
  if v_current.nationality    is distinct from v_nationality    then v_fields := array_append(v_fields, 'nationality'); end if;
  if v_current.employer_name  is distinct from v_employer_name  then v_fields := array_append(v_fields, 'employerName'); end if;
  if v_current."position"     is distinct from v_position       then v_fields := array_append(v_fields, 'position'); end if;
  if v_current.monthly_salary is distinct from v_monthly_salary then v_fields := array_append(v_fields, 'monthlySalary'); end if;

  if array_length(v_fields, 1) is null then
    return p_client_id;
  end if;

  update public.clients
     set phone          = v_phone,
         email          = v_email,
         address        = v_address,
         birth_date     = v_birth_date,
         nationality    = v_nationality,
         employer_name  = v_employer_name,
         "position"     = v_position,
         monthly_salary = v_monthly_salary
   where id = p_client_id;

  -- PRIVACY: which fields moved, never what they now say. `crm_events` is
  -- append-only with no delete path, so a personal value copied into it could
  -- never be corrected or erased. Same rule record_client_profile_update
  -- follows, and the reason neither writes values.
  insert into public.crm_events (
    event_type, entity_type, entity_id, client_id, application_id,
    actor_profile_id, actor_kind, source, previous_value, new_value, branch_id
  ) values (
    'client_profile_updated', 'client', p_client_id,
    p_client_id, null,
    null, 'system',
    coalesce(nullif(btrim(p_source), ''), 'website_form'),
    null,
    jsonb_build_object('changedFields', to_jsonb(v_fields), 'sync', true),
    v_current.branch_id
  );

  return p_client_id;
end;
$function$;

revoke all on function public.sync_client_current_profile(
  uuid, text, text, text, date, text, text, text, numeric, text
) from public, anon, authenticated;

grant execute on function public.sync_client_current_profile(
  uuid, text, text, text, date, text, text, text, numeric, text
) to service_role;
