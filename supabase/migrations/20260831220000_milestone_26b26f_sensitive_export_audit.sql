-- ============================================================================
-- MILESTONE 26B-26F — AUDITORÍA DE LA EXPORTACIÓN DETALLADA
-- ============================================================================
--
-- 26B-26F permite a la dirección descargar un Excel con nombre, cédula,
-- teléfono y correo de cada solicitante. Ese archivo sale del CRM y ya no
-- vuelve: no hay forma de revocarlo, de saber a dónde llegó ni de borrarlo.
--
-- Lo único que sí se puede garantizar es que quede constancia de que se
-- generó. Eso es lo que hace esta migración.
--
-- ----------------------------------------------------------------------------
-- POR QUÉ `crm_events` Y NO UNA TABLA NUEVA
-- ----------------------------------------------------------------------------
-- Porque ya existe el sitio donde ODL registra «quién hizo qué», y encaja sin
-- forzar nada:
--
--   entity_type = 'profile'   ya está en el vocabulario cerrado
--                             (crm_events_entity_type_check)
--   entity_id   = el perfil que exporta — la entidad del hecho es la PERSONA
--                 que se lleva los datos, que es exactamente lo que se audita
--   actor_kind  = 'human' con actor_profile_id, satisfaciendo
--                 crm_events_actor_pair_check
--   source      = 'crm_manual', que es lo que crm_events_actor_source_check
--                 exige de todo actor humano y lo que esto es de verdad:
--                 una acción manual dentro del CRM
--
-- Una tabla aislada habría significado un segundo registro de auditoría que
-- consultar, que respaldar y que recordar — para un hecho que este ya sabe
-- expresar. La alternativa se descartó por eso, no por comodidad.
--
-- ----------------------------------------------------------------------------
-- POR QUÉ HACE FALTA UNA RPC
-- ----------------------------------------------------------------------------
-- `crm_events` tiene RLS sin políticas y a `service_role` solo le concede
-- SELECT. Ni el servidor de la aplicación puede insertar directamente. Es la
-- misma arquitectura que ya usan `record_email_sent_event` y todas las demás
-- escrituras auditadas: SECURITY DEFINER, `search_path` fijado, revocada de
-- todo el mundo y concedida únicamente a service_role.
--
-- Esta función es DELIBERADAMENTE ESTRECHA. No acepta un `event_type`, ni un
-- `entity_type`, ni un jsonb libre: recibe seis valores concretos y construye
-- el evento ella misma. Una RPC genérica para escribir en crm_events sería un
-- agujero por el que fabricar cualquier historial.
--
-- ----------------------------------------------------------------------------
-- QUÉ SE GUARDA — Y QUÉ NO
-- ----------------------------------------------------------------------------
-- Se guarda el hecho: quién, cuándo, qué período, qué formato y cuántas filas
-- de cada tipo. NADA del contenido. El evento describe una exportación; no es
-- una segunda copia de lo exportado. Registrar un solo nombre aquí sería
-- duplicar la PII en la tabla que existe justamente para vigilarla.

-- ---------------------------------------------------------------------------
-- 1. El vocabulario de eventos admite el hecho nuevo
-- ---------------------------------------------------------------------------
-- Aditivo: solo se añade un valor, así que ninguna fila existente deja de
-- cumplir la restricción y la revalidación no puede fallar.
alter table public.crm_events
  drop constraint crm_events_event_type_check;

alter table public.crm_events
  add constraint crm_events_event_type_check check (
    event_type = any (array[
      'application_status_changed',
      'requirement_status_changed',
      'alert_resolved',
      'alert_reactivated',
      'client_status_changed',
      'client_profile_updated',
      'application_advisor_assigned',
      'client_restriction_changed',
      'user_invited',
      'user_role_changed',
      'user_deactivated',
      'user_reactivated',
      'user_capability_granted',
      'user_capability_revoked',
      'branch_created',
      'branch_updated',
      'branch_deactivated',
      'profile_branch_assigned',
      'profile_branch_removed',
      'profile_branch_scope_changed',
      'client_branch_transferred',
      'application_branch_transferred',
      'email_sent',
      'email_linked',
      'email_unlinked',
      'application_review_recommended',
      'application_review_completed',
      'application_review_reopened',
      'application_approved_amount_changed',
      -- 26B-26F
      'sensitive_export_generated'
    ])
  );

-- ---------------------------------------------------------------------------
-- 2. La única forma de escribir ese evento
-- ---------------------------------------------------------------------------
create or replace function public.record_sensitive_export_event(
  p_actor_profile_id uuid,
  p_format text,
  p_period_kind text,
  p_period_from timestamptz,
  p_period_to timestamptz,
  p_row_counts jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_event_id uuid;
begin
  -- UN ACTOR HUMANO, SIEMPRE. Una exportación de datos personales sin persona
  -- detrás no es un evento de sistema: es un registro que no sirve para nada.
  -- Se rechaza en lugar de escribir un evento anónimo que aparentaría auditoría.
  if p_actor_profile_id is null then
    raise exception
      'record_sensitive_export_event: an export must be attributed to a profile'
      using errcode = '22023';
  end if;

  if not exists (select 1 from public.profiles where id = p_actor_profile_id) then
    raise exception
      'record_sensitive_export_event: unknown actor profile %', p_actor_profile_id
      using errcode = '23503';
  end if;

  if p_period_from is null or p_period_to is null or p_period_to <= p_period_from then
    raise exception
      'record_sensitive_export_event: invalid period [% , %)', p_period_from, p_period_to
      using errcode = '22023';
  end if;

  insert into public.crm_events (
    event_type, entity_type, entity_id,
    client_id, application_id,
    actor_profile_id, actor_kind, source,
    previous_value, new_value, branch_id
  ) values (
    'sensitive_export_generated',
    -- La entidad es quien se lleva los datos. No hay un cliente ni una
    -- solicitud concretos: el extracto los cruza todos.
    'profile', p_actor_profile_id,
    null, null,
    p_actor_profile_id, 'human', 'crm_manual',
    null,
    jsonb_build_object(
      'format', left(coalesce(p_format, 'xlsx'), 20),
      'period_kind', left(coalesce(p_period_kind, 'unknown'), 40),
      'period_from', p_period_from,
      'period_to', p_period_to,
      -- Recuentos, nunca contenido. Sirven para responder «¿cuánto se llevó?»
      -- sin volver a exponer una sola fila.
      'row_counts', coalesce(p_row_counts, '{}'::jsonb)
    ),
    -- Sin sucursal: la exportación es nacional, no pertenece a ninguna. Poner
    -- la del exportador diría algo falso sobre el alcance de lo descargado.
    null
  )
  returning id into v_event_id;

  return v_event_id;
end;
$function$;

-- Misma clausura que el resto de escrituras auditadas: nadie salvo el servidor.
revoke all on function public.record_sensitive_export_event(uuid, text, text, timestamptz, timestamptz, jsonb) from public;
revoke all on function public.record_sensitive_export_event(uuid, text, text, timestamptz, timestamptz, jsonb) from anon;
revoke all on function public.record_sensitive_export_event(uuid, text, text, timestamptz, timestamptz, jsonb) from authenticated;
grant execute on function public.record_sensitive_export_event(uuid, text, text, timestamptz, timestamptz, jsonb) to service_role;

comment on function public.record_sensitive_export_event(uuid, text, text, timestamptz, timestamptz, jsonb) is
  'Milestone 26B-26F. Registra que un perfil generó una exportación detallada con datos personales. Guarda quién, cuándo, qué período y cuántas filas — nunca el contenido exportado.';
