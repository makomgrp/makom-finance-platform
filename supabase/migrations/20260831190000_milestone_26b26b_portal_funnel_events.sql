-- ============================================================================
-- MILESTONE 26B-26B — EL RECORRIDO DEL SOLICITANTE DEJA DE BORRARSE A SÍ MISMO
-- ============================================================================
--
-- 26B-26A encontró que `application_intakes.current_step` es la ÚNICA señal de
-- por dónde va un solicitante en el formulario público, y que se SOBRESCRIBE en
-- cada avance. Eso responde "¿dónde está hoy?" y no puede responder "¿cuántos
-- llegaron al Paso 3 en agosto y cuántos lo abandonaron ahí?". Cada día que
-- pasa sin registrar el recorrido es un día de embudo que no se podrá
-- reconstruir jamás: no hay backfill posible de un dato que nunca se guardó.
--
-- Esta migración crea el registro append-only que faltaba. NO reescribe
-- historia, NO fabrica eventos para las 16 solicitudes que ya existen, y NO
-- toca una sola fila de datos reales.
--
-- ----------------------------------------------------------------------------
-- POR QUÉ UNA TABLA NUEVA Y NO `crm_events`
-- ----------------------------------------------------------------------------
-- Se evaluaron las dos opciones y `crm_events` se descartó por tres razones
-- estructurales, no estéticas:
--
--   1. NO TIENE DÓNDE ANCLAR EL EVENTO. `crm_events` exige `entity_type` +
--      `entity_id` y sus columnas de contexto son `client_id` y
--      `application_id`. El evento que más importa — el Paso 1 — ocurre cuando
--      todavía NO existe una Application, y a veces ni un Client. Habría que
--      añadirle una columna `intake_id` a la tabla de auditoría del CRM para
--      alojar telemetría del portal.
--
--   2. LA POLÍTICA DE BORRADO ES LA CONTRARIA. `crm_events.client_id` y
--      `.application_id` son ON DELETE SET NULL a propósito: un rastro de
--      auditoría debe sobrevivir al borrado de la entidad. Un evento de embudo
--      huérfano, en cambio, es incontable — no se puede sumar a ningún
--      solicitante — y solo ensucia el agregado. Aquí la política correcta es
--      CASCADE, que es incompatible con la de al lado.
--
--   3. SON VOLÚMENES Y PREGUNTAS DISTINTAS. `crm_events` responde "¿quién le
--      hizo qué a este expediente?" y hoy tiene 57 filas en total. Esta tabla
--      escribe hasta cinco filas por solicitante solo por avanzar. Mezclarlas
--      convierte el rastro de auditoría en un pajar.
--
-- `automation_events` se descartó sin discusión: su CHECK está cerrado a cinco
-- valores y su semántica es "el motor de automatización hizo X". Una persona
-- rellenando un formulario no es una automatización.
--
-- ----------------------------------------------------------------------------
-- LO QUE ESTA TABLA NO PUEDE GUARDAR
-- ----------------------------------------------------------------------------
-- No hay columna `metadata`, `payload` ni `details`, y su ausencia es la
-- garantía. Un evento de embudo necesita saber QUIÉN (por referencia), QUÉ y
-- CUÁNDO — nada más. Sin columna libre no hay forma de que un nombre, un
-- correo, una cédula, un salario, un monto o una declaración PEP acaben aquí
-- por descuido de un futuro autor. Si algún día hace falta una dimensión, se
-- añade como columna tipada y revisada, no como un jsonb abierto.
--
-- ----------------------------------------------------------------------------
-- MISMA POSTURA DE SEGURIDAD QUE `crm_events`
-- ----------------------------------------------------------------------------
-- RLS activo, cero políticas, y a `service_role` solo SELECT. La escritura
-- ocurre EXCLUSIVAMENTE a través de las dos funciones SECURITY DEFINER de más
-- abajo. Eso no es ceremonia: la idempotencia y la detección de reanudación
-- viven dentro de esas funciones, y un INSERT directo desde el código de la
-- aplicación podría saltárselas. Al no existir el permiso, no existe el atajo.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. EL CORTE HISTÓRICO — UNA SOLA FILA, PARA SIEMPRE
-- ----------------------------------------------------------------------------
-- Todo informe futuro tiene que poder decir "análisis histórico del embudo
-- disponible desde X" en vez de insinuar que cubre toda la vida del CRM. Ese X
-- tiene que ser un dato consultable, no una constante escrita a mano en el
-- código del informe, porque una constante escrita a mano es exactamente como
-- se acaba afirmando una cobertura que no se tiene.
--
-- `id boolean primary key check (id)` hace la segunda fila estructuralmente
-- imposible: el único valor que pasa el CHECK es `true`, y la clave primaria
-- impide que haya dos. No es un convenio que alguien deba recordar.
--
-- SIN RUTA DE ACTUALIZACIÓN. A `service_role` se le concede SELECT y nada más,
-- así que el corte no puede retrasarse para simular que se midió más de lo que
-- se midió.
create table public.portal_funnel_tracking (
  id boolean primary key default true check (id),
  tracking_started_at timestamptz not null default now()
);

insert into public.portal_funnel_tracking default values;

alter table public.portal_funnel_tracking enable row level security;

comment on table public.portal_funnel_tracking is
  'MILESTONE 26B-26B. Una fila, inmutable: el instante desde el cual existen '
  'eventos de embudo. Todo lo anterior a esta marca NO tiene historia de pasos '
  'y ningún informe puede presentarlo como si la tuviera.';

comment on column public.portal_funnel_tracking.tracking_started_at is
  'MILESTONE 26B-26B. Instante en que se aplicó el esquema. El código que '
  'escribe los eventos se despliega inmediatamente después, así que puede '
  'existir una ventana de minutos justo tras esta marca sin eventos: en esa '
  'ventana "cero eventos" NO significa "cero tráfico".';

-- ----------------------------------------------------------------------------
-- 2. LOS EVENTOS
-- ----------------------------------------------------------------------------
create table public.portal_funnel_events (
  id uuid primary key default gen_random_uuid(),

  -- EL ANCLA. Un evento de embudo pertenece al INTAKE, que es lo único que
  -- existe desde el primer momento del recorrido. CASCADE porque un evento que
  -- ya no puede atribuirse a ningún solicitante no es un rastro que preservar,
  -- es un sumando fantasma en cada agregado. Cuando ODL borre un intake de QA,
  -- su telemetría se va con él, que es justo lo que debe pasar.
  application_intake_id uuid not null
    references public.application_intakes(id) on delete cascade,

  -- Contexto, nunca ancla. Se rellena SOLO desde dentro de las funciones de
  -- abajo, leyéndolo del propio intake — ningún llamador puede nombrarlo, así
  -- que no puede apuntar a la solicitud de otra persona. SET NULL porque la
  -- Application puede borrarse sin que el recorrido deje de haber ocurrido.
  application_id uuid
    references public.applications(id) on delete set null,

  event_type text not null,
  step text,

  occurred_at timestamptz not null default now(),

  -- Vocabulario cerrado. `reached` y `completed` son cosas distintas y esa
  -- distinción es el motivo entero de este milestone: saber que cinco personas
  -- LLEGARON al Paso 3 y solo dos lo TERMINARON es la métrica de abandono.
  constraint portal_funnel_events_event_type_check check (
    event_type in ('portal_step_reached', 'portal_step_completed', 'portal_resumed')
  ),

  -- El vocabulario de pasos es el que YA existe (PortalStep / PORTAL_STEP_ORDER
  -- en src/types/portal-continuation.ts). No se inventan pasos visuales nuevos:
  -- un informe que hable de pasos que el sistema no reconoce es un informe
  -- sobre otro producto.
  constraint portal_funnel_events_step_check check (
    step is null
    or step in ('applicant_data', 'loan_selection', 'financial_data', 'documents', 'review')
  ),

  -- El paso es obligatorio para los eventos que hablan de un paso, y prohibido
  -- para el que no. Una reanudación no ocurre "en" un paso: ocurre en la
  -- solicitud, y a qué paso vuelve la persona ya lo dice el evento `reached`
  -- que viene detrás.
  constraint portal_funnel_events_step_pair_check check (
    (event_type in ('portal_step_reached', 'portal_step_completed') and step is not null)
    or (event_type = 'portal_resumed' and step is null)
  )
);

-- ----------------------------------------------------------------------------
-- LA IDEMPOTENCIA ES ESTE ÍNDICE, NO UNA COMPROBACIÓN EN EL CÓDIGO
-- ----------------------------------------------------------------------------
-- Un refresco, un Atrás→Siguiente, un reintento de red y un doble clic son
-- todos la misma petición otra vez. Un `select ... if not exists ... insert`
-- los dejaría pasar en cuanto dos llegaran a la vez, que es precisamente
-- cuando ocurren.
--
-- Con este índice, "¿cuántas PERSONAS llegaron al Paso 3?" es un count exacto
-- por construcción, y no "¿cuántas veces se renderizó el Paso 3?". La segunda
-- pregunta es deliberadamente irrespondible con este modelo: no interesa, y
-- poder contestarla habría significado guardar cada render.
--
-- PARCIAL sobre `step is not null` porque las reanudaciones SÍ se repiten
-- legítimamente: la misma persona puede quedarse parada y volver más de una
-- vez, y colapsarlas perdería justo el dato de recuperación.
create unique index portal_funnel_events_step_once_uk
  on public.portal_funnel_events (application_intake_id, event_type, step)
  where step is not null;

-- El único acceso que existe hoy: la historia de un solicitante concreto, y la
-- ventana de deduplicación de reanudaciones de `record_portal_activity`.
-- Deliberadamente NO se crea un índice por `occurred_at` para informes por
-- período: esas consultas todavía no existen (26B-26C), y un índice para una
-- consulta hipotética es mantenimiento sin lector.
create index portal_funnel_events_intake_time_idx
  on public.portal_funnel_events (application_intake_id, occurred_at);

alter table public.portal_funnel_events enable row level security;

comment on table public.portal_funnel_events is
  'MILESTONE 26B-26B. Registro append-only del recorrido por el formulario '
  'público. Contiene QUIÉN (por referencia al intake), QUÉ y CUÁNDO, y nada '
  'más: no hay columna libre donde puedan acabar datos personales. Se escribe '
  'solo mediante record_portal_funnel_event() y record_portal_activity().';

comment on column public.portal_funnel_events.event_type is
  'portal_step_reached (la persona llegó a la pantalla del paso), '
  'portal_step_completed (las reglas del paso quedaron satisfechas, según '
  'evaluatePortalProgress), portal_resumed (una solicitud estancada volvió a '
  'moverse).';

comment on column public.portal_funnel_events.step is
  'Vocabulario PortalStep ya existente. Obligatorio en reached/completed, '
  'prohibido en portal_resumed.';

comment on column public.portal_funnel_events.application_id is
  'Contexto derivado del intake dentro de la función que inserta. Nulo cuando '
  'el evento ocurrió antes de que existiera la Application — normal y correcto '
  'en el Paso 1.';

-- ----------------------------------------------------------------------------
-- 3. ESCRITURA DE reached / completed
-- ----------------------------------------------------------------------------
-- `on conflict do nothing` contra el índice de arriba: el duplicado no es un
-- error que haya que manejar, es la petición repetida que ya se atendió. La
-- función devuelve si insertó algo, para que las pruebas puedan distinguir
-- "primera vez" de "repetición" sin que el llamador tenga que hacer nada
-- distinto en cada caso.
--
-- EL LLAMADOR NO PUEDE NOMBRAR LA APPLICATION. Se lee del intake aquí dentro,
-- así que un evento no puede quedar colgado de la solicitud de otra persona ni
-- desincronizarse del intake al que dice pertenecer.
--
-- RECHAZA 'portal_resumed' A PROPÓSITO. Esa reanudación no es un hecho que se
-- observe y se anote: es una CONCLUSIÓN que depende del hueco de inactividad, y
-- solo puede sacarla la función de abajo, que tiene la fila bloqueada. Dejar
-- esta puerta abierta permitiría registrar reanudaciones que nunca ocurrieron.
create function public.record_portal_funnel_event(
  p_intake_id uuid,
  p_event_type text,
  p_step text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_application_id uuid;
  v_found boolean;
  v_inserted uuid;
begin
  if p_event_type not in ('portal_step_reached', 'portal_step_completed') then
    raise exception 'record_portal_funnel_event only records step events.'
      using errcode = '22023';
  end if;

  select i.created_application_id, true
    into v_application_id, v_found
    from public.application_intakes i
   where i.id = p_intake_id;

  if not coalesce(v_found, false) then
    return false;
  end if;

  insert into public.portal_funnel_events (
    application_intake_id, application_id, event_type, step
  ) values (
    p_intake_id, v_application_id, p_event_type, p_step
  )
  on conflict do nothing
  returning id into v_inserted;

  return v_inserted is not null;
end;
$function$;

revoke all on function public.record_portal_funnel_event(uuid, text, text) from public;
revoke all on function public.record_portal_funnel_event(uuid, text, text) from anon;
revoke all on function public.record_portal_funnel_event(uuid, text, text) from authenticated;
grant execute on function public.record_portal_funnel_event(uuid, text, text) to service_role;

-- ----------------------------------------------------------------------------
-- 4. ACTIVIDAD Y REANUDACIÓN, EN LA MISMA TRANSACCIÓN
-- ----------------------------------------------------------------------------
-- Sustituye a los dos UPDATE sueltos que hacían `updateIntakeDraftState` y
-- `touchIntakeActivity`, y lo hace por una razón concreta: detectar una
-- reanudación exige comparar contra el `last_activity_at` ANTERIOR, y ese valor
-- deja de existir en cuanto se escribe el nuevo. Con dos sentencias separadas
-- en el código de la aplicación, el orden correcto sería una convención que el
-- próximo autor puede invertir sin que nada falle visiblemente. Aquí es una
-- sola sentencia y el orden no es opinable.
--
-- QUÉ ES UNA REANUDACIÓN. Que una solicitud que llevaba callada más del umbral
-- de estancamiento vuelva a MOVERSE. Deliberadamente NO es "una sesión nueva":
--
--   * Un refresco, un render de servidor o una navegación interna no escriben
--     nada, así que no pueden dispararla. Esta función solo la llaman las rutas
--     de escritura.
--   * El umbral no es un número inventado para esto: es el mismo
--     STALLED_THRESHOLD que ODL ya decidió (72 h), y llega como parámetro desde
--     TypeScript para que exista UNA sola definición y no una copia en SQL
--     libre de desviarse.
--   * Es repetible a propósito. La misma persona puede estancarse y volver
--     varias veces, y cada vuelta es un dato de recuperación real.
--
-- `for update` sobre la fila del intake serializa dos escrituras concurrentes:
-- la segunda lee el `last_activity_at` que acaba de dejar la primera, ve un
-- hueco de cero y no registra una segunda reanudación. La ventana de
-- deduplicación es una segunda red bajo el mismo umbral.
--
-- CONSERVA EL GUARDIA DE `submitted_at`. Igual que los UPDATE que sustituye:
-- una solicitud ya enviada está con ODL y una edición tardía no puede alterar
-- en silencio lo que un humano ya está evaluando. Va en el WHERE, no en una
-- lectura previa, así que no hay ventana que correr.
create function public.record_portal_activity(
  p_intake_id uuid,
  p_current_step text,
  p_resume_gap_seconds integer
)
returns table (activity_recorded boolean, resume_recorded boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_intake public.application_intakes%rowtype;
  v_gap interval;
  v_resumed boolean := false;
begin
  if p_resume_gap_seconds is null or p_resume_gap_seconds <= 0 then
    raise exception 'A resume gap must be a positive number of seconds.'
      using errcode = '22023';
  end if;

  if p_current_step is not null
     and p_current_step not in
       ('applicant_data', 'loan_selection', 'financial_data', 'documents', 'review') then
    raise exception 'Unknown portal step.' using errcode = '22023';
  end if;

  v_gap := make_interval(secs => p_resume_gap_seconds);

  select * into v_intake
    from public.application_intakes
   where id = p_intake_id
     and submitted_at is null
   for update;

  if not found then
    -- O no existe, o ya fue enviada. Las dos significan "este borrador no se
    -- edita", y distinguirlas le diría a un llamador anónimo si el intake
    -- existe.
    return query select false, false;
    return;
  end if;

  if v_intake.last_activity_at is not null
     and now() - v_intake.last_activity_at >= v_gap
     and not exists (
       select 1
         from public.portal_funnel_events e
        where e.application_intake_id = p_intake_id
          and e.event_type = 'portal_resumed'
          and e.occurred_at > now() - v_gap
     ) then
    insert into public.portal_funnel_events (
      application_intake_id, application_id, event_type, step
    ) values (
      p_intake_id, v_intake.created_application_id, 'portal_resumed', null
    );
    v_resumed := true;
  end if;

  update public.application_intakes
     set last_activity_at = now(),
         current_step = coalesce(p_current_step, current_step)
   where id = p_intake_id;

  return query select true, v_resumed;
end;
$function$;

revoke all on function public.record_portal_activity(uuid, text, integer) from public;
revoke all on function public.record_portal_activity(uuid, text, integer) from anon;
revoke all on function public.record_portal_activity(uuid, text, integer) from authenticated;
grant execute on function public.record_portal_activity(uuid, text, integer) to service_role;

-- ----------------------------------------------------------------------------
-- 5. GRANTS DE LECTURA — SOLO LECTURA, COMO `crm_events`
-- ----------------------------------------------------------------------------
grant select on public.portal_funnel_events to service_role;
grant select on public.portal_funnel_tracking to service_role;

-- ============================================================================
-- SIN BACKFILL. A PROPÓSITO Y SIN EXCEPCIONES.
-- ============================================================================
-- Las 16 solicitudes que ya existen NO reciben ningún evento. Se sabe dónde
-- están hoy (`current_step`) y no se sabe por dónde pasaron: convertir lo
-- primero en lo segundo sería inventar una historia — fechas que nadie vivió,
-- pasos que quizá se saltaron, abandonos que quizá no ocurrieron — y quedaría
-- indistinguible de una medición real para siempre.
--
-- Para esas solicitudes `current_step` sigue siendo válido como FOTOGRAFÍA del
-- presente. No es historia y ningún informe puede presentarlo como tal.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 6. RETIRAR LOS PRIVILEGIOS POR DEFECTO DEL PROYECTO
-- ----------------------------------------------------------------------------
-- Una tabla nueva hereda los DEFAULT PRIVILEGES del proyecto, que en éste
-- conceden REFERENCES, TRIGGER y TRUNCATE a `anon` y `authenticated`. Las dos
-- tablas append-only que ya existían — `crm_events` y
-- `public_application_tokens` — los tienen retirados, y esta debe quedar igual.
--
-- TRUNCATE ES EL QUE IMPORTA: no lo filtra RLS. Una política de fila no puede
-- impedir el vaciado de la tabla entera, así que el único mecanismo real es no
-- conceder el privilegio. Y esta tabla guarda justo lo que no se puede
-- reconstruir: vaciarla no perdería un dato recuperable de otro sitio, perdería
-- el historial del embudo para siempre.
--
-- Hoy PostgREST no expone TRUNCATE, así que esto no cierra un agujero abierto;
-- cierra la diferencia entre esta tabla y las que ya se trataban como
-- inmutables, que es lo que impide que la diferencia se dé por buena mañana.
revoke all on public.portal_funnel_events from anon;
revoke all on public.portal_funnel_events from authenticated;
revoke all on public.portal_funnel_tracking from anon;
revoke all on public.portal_funnel_tracking from authenticated;
revoke truncate on public.portal_funnel_events from service_role;
revoke truncate on public.portal_funnel_tracking from service_role;
