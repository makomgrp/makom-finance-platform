-- ============================================================================
-- MILESTONE 26B-26G — CIERRES GERENCIALES MENSUALES
-- ============================================================================
--
-- Una fotografía histórica e inmutable de las cifras oficiales de ODL al
-- terminar cada mes calendario de Panamá.
--
-- El valor está en la inmutabilidad. Si en noviembre alguien formaliza un
-- borrador de agosto, una consulta viva sobre agosto dará otro número — y el
-- cierre de agosto seguirá diciendo lo que se sabía al cerrarlo. Las dos cosas
-- son ciertas y el modelo no borra la diferencia.
--
-- ----------------------------------------------------------------------------
-- LA DECISIÓN DE AUDITORÍA (26B-26G.1)
-- ----------------------------------------------------------------------------
-- `crm_events.source` es {crm_manual, website_form, whatsapp, email, ai}: el
-- vocabulario de CANALES OPERATIVOS de ODL, replicado en ocho tablas. Un
-- proceso programado interno no entró por ninguno de esos canales.
--
-- Se resolvió así, y NO se tocó ese vocabulario:
--
--   CIERRE PROGRAMADO   la propia fila es el registro de auditoría. Es
--                       append-only, inmutable por trigger y única por mes, y
--                       guarda qué mes, cuándo, con qué versión, con qué
--                       cobertura y que lo generó el sistema. Un `crm_events`
--                       sería una copia de un registro que ya es inmutable.
--   CIERRE BOOTSTRAP    además, un `crm_events` — porque ahí SÍ hay una persona
--                       que decidió reconstruir un mes a posteriori, y eso
--                       pertenece al historial de acciones humanas.
--
-- La procedencia vive en columnas propias de esta tabla
-- (`generated_by_kind`), no pidiéndole prestado el vocabulario a nadie.
--
-- ----------------------------------------------------------------------------
-- SIN DATOS PERSONALES
-- ----------------------------------------------------------------------------
-- `payload` es el ReportingSnapshot oficial, que por construcción es agregado:
-- ni un nombre, ni una cédula, ni un correo, ni un teléfono, ni una fila
-- individual de cliente, solicitud, documento o correo. Se valida en el
-- servidor ANTES de escribir, porque después ya no se puede corregir.
--
-- `generated_by_profile_id` es una clave técnica de auditoría FUERA del
-- payload: el rastro de quién creó el registro, no un dato del informe.

-- ---------------------------------------------------------------------------
-- 1. La tabla
-- ---------------------------------------------------------------------------
create table public.monthly_management_closures (
  id uuid primary key default gen_random_uuid(),

  -- UNA FILA POR MES, y la base lo garantiza. No es una comprobación de
  -- conveniencia: es lo que hace que dos invocaciones simultáneas del cron
  -- terminen con exactamente un cierre.
  period_key text not null unique,
  period_start timestamptz not null,
  period_end timestamptz not null,
  business_time_zone text not null default 'America/Panama',

  -- Cuándo se generó DE VERDAD. En un cierre programado será el día 1; en el
  -- bootstrap de agosto, la fecha real de ejecución, semanas después del
  -- período. Nunca se antedata: fingir que un proceso lo capturó a medianoche
  -- falsificaría la procedencia del primer registro histórico de ODL.
  generated_at timestamptz not null default now(),
  generation_kind text not null,
  generated_by_kind text not null,
  generated_by_profile_id uuid references public.profiles(id),

  -- La versión del contrato con la que se escribió ESTE cierre. Permite
  -- evolucionar ReportingSnapshot sin volver ambiguos los cierres antiguos. Un
  -- cambio de versión NO recalcula lo ya guardado: reescribir la historia en
  -- silencio es exactamente lo que este sistema existe para impedir.
  reporting_schema_version integer not null,

  payload jsonb not null,

  created_at timestamptz not null default now(),

  constraint monthly_closures_period_key_format
    check (period_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),

  constraint monthly_closures_period_order
    check (period_start < period_end),

  -- QUE EL PERÍODO SEA UN MES DE PANAMÁ SE COMPRUEBA EN LA RPC, NO AQUÍ.
  --
  -- No por comodidad: `AT TIME ZONE` es STABLE y no IMMUTABLE —depende de la
  -- base de datos de husos horarios, que puede cambiar— y PostgreSQL no admite
  -- funciones no inmutables dentro de una restricción CHECK. Intentarlo habría
  -- fallado al crear la tabla. La comprobación vive en
  -- `record_monthly_management_closure`, que es la ÚNICA vía de escritura
  -- porque nadie tiene INSERT directo sobre esta tabla.

  constraint monthly_closures_time_zone
    check (business_time_zone = 'America/Panama'),

  constraint monthly_closures_generation_kind
    check (generation_kind in ('scheduled', 'bootstrap')),

  constraint monthly_closures_generated_by_kind
    check (generated_by_kind in ('human', 'system')),

  -- El par actor/tipo, con la misma disciplina que `crm_events_actor_pair_check`:
  -- un actor humano trae su perfil y el sistema no trae ninguno. Sin esto se
  -- podría escribir un cierre «humano» sin persona detrás.
  constraint monthly_closures_actor_pair
    check (
      (generated_by_kind = 'human' and generated_by_profile_id is not null)
      or (generated_by_kind = 'system' and generated_by_profile_id is null)
    ),

  -- Un cierre programado lo genera el sistema, siempre. La combinación
  -- «scheduled + human» no existe: si una persona lo lanzó, es bootstrap.
  constraint monthly_closures_scheduled_is_system
    check (generation_kind <> 'scheduled' or generated_by_kind = 'system'),

  constraint monthly_closures_schema_version
    check (reporting_schema_version > 0),

  -- El payload lleva el snapshot y su manifiesto. Un objeto vacío no es un
  -- cierre.
  constraint monthly_closures_payload_shape
    check (
      jsonb_typeof(payload) = 'object'
      and payload ? 'snapshot'
      and payload ? 'metadata'
    )
);

comment on table public.monthly_management_closures is
  'Milestone 26B-26G. Fotografía histórica INMUTABLE de las métricas de gestión al cierre de cada mes de Panamá. La fila es el registro de auditoría de los cierres programados. Sin datos personales.';

create index monthly_closures_period_start_idx
  on public.monthly_management_closures (period_start desc);

-- ---------------------------------------------------------------------------
-- 2. Inmutabilidad — la garantía de la que depende todo lo demás
-- ---------------------------------------------------------------------------
-- La decisión de que la fila SEA la auditoría solo es válida si la fila no se
-- puede tocar. Sin esto, un cierre sería un dato editable disfrazado de
-- registro histórico.
--
-- Se defiende en la base y no en la aplicación: un trigger no se olvida, no
-- depende de qué cliente escriba y no se salta con una consulta suelta. Ni
-- siquiera `service_role` puede modificar un cierre por la vía normal.
create function public.monthly_closures_reject_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  raise exception
    'monthly_management_closures es inmutable: no se permite % sobre el cierre %',
    tg_op, coalesce(old.period_key, '?')
    using errcode = '0A000';
end;
$function$;

create trigger monthly_closures_no_update
  before update on public.monthly_management_closures
  for each row execute function public.monthly_closures_reject_mutation();

create trigger monthly_closures_no_delete
  before delete on public.monthly_management_closures
  for each row execute function public.monthly_closures_reject_mutation();

-- ---------------------------------------------------------------------------
-- 3. RLS y grants — nadie escribe desde el navegador
-- ---------------------------------------------------------------------------
-- RLS activo sin políticas, como el resto de tablas del proyecto: ni con la
-- clave publicable ni con una sesión autenticada se lee o escribe nada. El
-- acceso pasa por el servidor, que ya exige `analytics:view`.
alter table public.monthly_management_closures enable row level security;

revoke all on table public.monthly_management_closures from public;
revoke all on table public.monthly_management_closures from anon;
revoke all on table public.monthly_management_closures from authenticated;

-- Solo lectura para el servidor. La escritura va exclusivamente por las RPC de
-- abajo, que son las que validan y auditan. Sin INSERT directo no hay forma de
-- colar un cierre sin pasar por ellas.
grant select on table public.monthly_management_closures to service_role;

-- ---------------------------------------------------------------------------
-- 4. El vocabulario de auditoría admite el cierre humano
-- ---------------------------------------------------------------------------
-- ADITIVO Y AISLADO. Se añade un `event_type` y un `entity_type`, ambos para
-- el caso bootstrap. `source` NO SE TOCA — ver la nota de cabecera.
alter table public.crm_events drop constraint crm_events_event_type_check;

alter table public.crm_events
  add constraint crm_events_event_type_check check (
    event_type = any (array[
      'application_status_changed', 'requirement_status_changed',
      'alert_resolved', 'alert_reactivated', 'client_status_changed',
      'client_profile_updated', 'application_advisor_assigned',
      'client_restriction_changed', 'user_invited', 'user_role_changed',
      'user_deactivated', 'user_reactivated', 'user_capability_granted',
      'user_capability_revoked', 'branch_created', 'branch_updated',
      'branch_deactivated', 'profile_branch_assigned', 'profile_branch_removed',
      'profile_branch_scope_changed', 'client_branch_transferred',
      'application_branch_transferred', 'email_sent', 'email_linked',
      'email_unlinked', 'application_review_recommended',
      'application_review_completed', 'application_review_reopened',
      'application_approved_amount_changed',
      'sensitive_export_generated',
      -- 26B-26G: solo para el bootstrap humano.
      'monthly_management_closure_created'
    ])
  );

alter table public.crm_events drop constraint crm_events_entity_type_check;

alter table public.crm_events
  add constraint crm_events_entity_type_check check (
    entity_type = any (array[
      'application', 'requirement_slot', 'dossier_alert', 'client', 'profile',
      'branch', 'email_message', 'application_review',
      -- 26B-26G.
      'monthly_closure'
    ])
  );

-- ---------------------------------------------------------------------------
-- 5. La única forma de crear un cierre
-- ---------------------------------------------------------------------------
-- Una sola función para los dos casos, porque la diferencia entre ellos es
-- exactamente una rama de tres líneas y tenerlas separadas duplicaría la parte
-- delicada: la idempotencia.
--
-- IDEMPOTENTE POR CONSTRUCCIÓN. `on conflict do nothing` sobre la clave única
-- del período. No es un `select` seguido de un `insert` —que perdería la
-- carrera entre dos invocaciones simultáneas del cron, algo que la propia
-- documentación de Vercel advierte que puede pasar—: es la base la que decide,
-- en una sola sentencia.
--
-- ATÓMICA. En el caso bootstrap, el cierre y su evento de auditoría se
-- escriben dentro de la misma función y por tanto de la misma transacción.
-- Nunca puede quedar un cierre sin su evento ni un evento sin su cierre. Y si
-- el cierre ya existía, no se escribe un segundo evento: un reintento no
-- inventa una segunda acción humana que nunca ocurrió.
create function public.record_monthly_management_closure(
  p_period_key text,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_generation_kind text,
  p_generated_by_profile_id uuid,
  p_reporting_schema_version integer,
  p_payload jsonb
)
returns table (closure_id uuid, was_created boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_id uuid;
  v_actor_kind text;
begin
  if p_generation_kind not in ('scheduled', 'bootstrap') then
    raise exception 'record_monthly_management_closure: generation_kind invalido %',
      p_generation_kind using errcode = '22023';
  end if;

  -- Un cierre programado NUNCA lleva actor humano, y uno bootstrap SIEMPRE lo
  -- lleva. Se rechaza en vez de normalizar en silencio: la procedencia del
  -- registro es justamente lo que este milestone se ocupa de no falsear.
  if p_generation_kind = 'scheduled' and p_generated_by_profile_id is not null then
    raise exception
      'record_monthly_management_closure: un cierre programado no tiene actor humano'
      using errcode = '22023';
  end if;
  if p_generation_kind = 'bootstrap' and p_generated_by_profile_id is null then
    raise exception
      'record_monthly_management_closure: un bootstrap debe atribuirse a un perfil'
      using errcode = '22023';
  end if;

  -- EL PERÍODO TIENE QUE SER UN MES ENTERO DE PANAMÁ, y se comprueba aquí
  -- porque una restricción CHECK no puede usar `AT TIME ZONE` (es STABLE, no
  -- IMMUTABLE). Como esta función es la única vía de escritura, la garantía es
  -- la misma: un rango arbitrario no puede guardarse con nombre de mes.
  if p_period_start <> date_trunc('month', p_period_start at time zone 'America/Panama')
                         at time zone 'America/Panama'
     or p_period_end <> (date_trunc('month', p_period_start at time zone 'America/Panama')
                          + interval '1 month') at time zone 'America/Panama'
  then
    raise exception
      'record_monthly_management_closure: [%, %) no es un mes calendario de Panama',
      p_period_start, p_period_end using errcode = '22023';
  end if;

  -- Y la clave tiene que nombrar ESE mes: `2026-08` no puede etiquetar
  -- septiembre.
  if p_period_key <> to_char(p_period_start at time zone 'America/Panama', 'YYYY-MM') then
    raise exception
      'record_monthly_management_closure: la clave % no corresponde al periodo %',
      p_period_key, p_period_start using errcode = '22023';
  end if;

  v_actor_kind := case when p_generated_by_profile_id is null then 'system' else 'human' end;

  insert into public.monthly_management_closures (
    period_key, period_start, period_end,
    generation_kind, generated_by_kind, generated_by_profile_id,
    reporting_schema_version, payload
  ) values (
    p_period_key, p_period_start, p_period_end,
    p_generation_kind, v_actor_kind, p_generated_by_profile_id,
    p_reporting_schema_version, p_payload
  )
  on conflict (period_key) do nothing
  returning id into v_id;

  if v_id is null then
    -- Ya estaba cerrado. Se devuelve el existente SIN tocarlo y sin auditar
    -- nada: un reintento del día 3 no debe dejar rastro de una acción que no
    -- ocurrió.
    select id into v_id
      from public.monthly_management_closures
     where period_key = p_period_key;

    return query select v_id, false;
    return;
  end if;

  -- SOLO EL BOOTSTRAP HUMANO SE AUDITA EN crm_events. El cierre programado ya
  -- es su propio registro: la fila de arriba es inmutable y contiene todo lo
  -- que un evento diría.
  if p_generated_by_profile_id is not null then
    insert into public.crm_events (
      event_type, entity_type, entity_id, client_id, application_id,
      actor_profile_id, actor_kind, source, previous_value, new_value, branch_id
    ) values (
      'monthly_management_closure_created',
      'monthly_closure', v_id,
      null, null,
      p_generated_by_profile_id, 'human', 'crm_manual',
      null,
      -- Metadatos del hecho, nunca el snapshot entero: el evento describe la
      -- acción, no duplica el informe.
      jsonb_build_object(
        'period_key', p_period_key,
        'period_start', p_period_start,
        'period_end', p_period_end,
        'generation_kind', p_generation_kind,
        'reporting_schema_version', p_reporting_schema_version,
        'coverage', coalesce(p_payload #> '{snapshot,coverage}', 'null'::jsonb)
      ),
      null
    );
  end if;

  return query select v_id, true;
end;
$function$;

revoke all on function public.record_monthly_management_closure(text, timestamptz, timestamptz, text, uuid, integer, jsonb) from public;
revoke all on function public.record_monthly_management_closure(text, timestamptz, timestamptz, text, uuid, integer, jsonb) from anon;
revoke all on function public.record_monthly_management_closure(text, timestamptz, timestamptz, text, uuid, integer, jsonb) from authenticated;
grant execute on function public.record_monthly_management_closure(text, timestamptz, timestamptz, text, uuid, integer, jsonb) to service_role;

comment on function public.record_monthly_management_closure(text, timestamptz, timestamptz, text, uuid, integer, jsonb) is
  'Milestone 26B-26G. Crea un cierre mensual de forma idempotente. Devuelve was_created=false si el mes ya estaba cerrado, sin modificarlo ni auditar de nuevo. Solo el bootstrap humano escribe un evento en crm_events.';
