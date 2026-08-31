-- ============================================================================
-- MILESTONE 26B-25.1 — LA RED SOCIAL TAMBIÉN SE EDITA A MANO
-- ============================================================================
--
-- 26B-25 puso `primary_social_network` en `clients` y la hizo escribir desde el
-- portal. Faltaba la otra mitad: ODL está cargando a mano los clientes que
-- captó por WhatsApp, y esas personas nunca pasarán por el formulario público.
-- Un campo que solo puede rellenar quien llega por internet no sirve para el
-- trabajo que hay hoy sobre la mesa.
--
-- Las columnas ya existen. Lo único que cambia es esta función.
--
-- ----------------------------------------------------------------------------
-- SE ELIMINA LA FIRMA ANTERIOR EN VEZ DE DARLE VALORES POR DEFECTO
-- ----------------------------------------------------------------------------
-- Esta función hace un UPDATE completo de la fila: asigna todos los campos que
-- recibe, no solo los que cambiaron. Añadir los dos parámetros con DEFAULT NULL
-- habría dejado viva la firma de 15 argumentos, y cualquier llamada antigua —
-- una pestaña con código anterior, un despliegue a medias — habría borrado en
-- silencio la red social de quien la tuviera, sin error y sin rastro.
--
-- Eliminando la firma vieja esa llamada deja de existir en vez de mentir. Mismo
-- criterio que 26B-23B tomó con submit_application.
--
-- ----------------------------------------------------------------------------
-- LA NORMALIZACIÓN VIVE AQUÍ, NO EN EL LLAMADOR
-- ----------------------------------------------------------------------------
-- `clients_primary_social_network_other_pair_check` exige el texto libre cuando
-- la red es `other` y lo prohíbe en el resto. En vez de confiar en que cada
-- llamador lo recuerde, la función descarta el texto cuando la red no es
-- `other`: cambiar de «Otros» a LinkedIn no puede dejar varada la descripción
-- anterior, ni convertirse en una violación de constraint que el operador vería
-- como un fallo genérico al guardar.
--
-- SECURITY DEFINER, el search_path, la comprobación de sucursal antes de
-- cualquier escritura, el evento de auditoría y los grants se conservan tal
-- cual. Los dos campos nuevos entran también en la lista de campos cambiados,
-- así que editarlos queda registrado como cualquier otro dato del perfil.
-- ============================================================================

drop function if exists public.record_client_profile_update(
  uuid, text, text, text, text, text, text, text, text, numeric, date, text, text, text, uuid
);

create function public.record_client_profile_update(
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
  p_primary_social_network text,
  p_primary_social_network_other text,
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
  v_network text;
  v_network_other text;
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

  -- MILESTONE 26B-25.1 — el texto libre existe solo para `other`.
  v_network := nullif(btrim(coalesce(p_primary_social_network, '')), '');
  v_network_other := case
    when v_network = 'other' then nullif(btrim(coalesce(p_primary_social_network_other, '')), '')
    else null
  end;

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
  if v_current.primary_social_network       is distinct from v_network       then v_fields := array_append(v_fields, 'primarySocialNetwork'); end if;
  if v_current.primary_social_network_other is distinct from v_network_other then v_fields := array_append(v_fields, 'primarySocialNetworkOther'); end if;

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
      employer_name         = p_employer_name,
      primary_social_network       = v_network,
      primary_social_network_other = v_network_other
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

revoke all on function public.record_client_profile_update(
  uuid, text, text, text, text, text, text, text, text, numeric, date, text, text, text, text, text, uuid
) from public;
revoke all on function public.record_client_profile_update(
  uuid, text, text, text, text, text, text, text, text, numeric, date, text, text, text, text, text, uuid
) from anon;
revoke all on function public.record_client_profile_update(
  uuid, text, text, text, text, text, text, text, text, numeric, date, text, text, text, text, text, uuid
) from authenticated;
grant execute on function public.record_client_profile_update(
  uuid, text, text, text, text, text, text, text, text, numeric, date, text, text, text, text, text, uuid
) to service_role;
