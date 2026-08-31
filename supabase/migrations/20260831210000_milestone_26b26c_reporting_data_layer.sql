-- ============================================================================
-- MILESTONE 26B-26C — UNA SOLA FUENTE DE VERDAD PARA LAS CIFRAS DE ODL
-- ============================================================================
--
-- El Dashboard gerencial, el PDF y el Excel van a preguntar lo mismo. Si cada
-- uno lo calcula por su cuenta, la primera divergencia aparece el día que
-- alguien compare dos documentos y no cuadren — y a partir de ahí ninguno de
-- los tres es creíble. Esta capa existe para que la pregunta se responda una
-- vez.
--
-- ----------------------------------------------------------------------------
-- EL CALENDARIO ES DE TYPESCRIPT; LA AGREGACIÓN ES DE SQL
-- ----------------------------------------------------------------------------
-- Ninguna función de aquí sabe qué es «agosto» ni dónde está Panamá. Todas
-- reciben `p_from` y `p_to` como instantes UTC ya resueltos. La conversión de
-- una frontera de calendario panameño a un instante vive en
-- `src/lib/reporting/period.ts`, que reutiliza `BUSINESS_TIME_ZONE`.
--
-- Se hace así porque la alternativa —`at time zone 'America/Panama'` repartido
-- por doce funciones— sería doce copias de la misma regla, y la primera que
-- alguien olvide actualizar produciría un informe que discrepa del resto sin
-- que nada falle.
--
-- INTERVALO SEMIABIERTO [from, to) EN TODAS, SIN EXCEPCIÓN. Un `between` cuenta
-- dos veces la fila que cae exactamente en la medianoche compartida entre dos
-- meses, y ese es justo el error que nadie encuentra revisando totales.
--
-- ----------------------------------------------------------------------------
-- LOS UMBRALES LLEGAN COMO PARÁMETRO
-- ----------------------------------------------------------------------------
-- Estancado (72 h) y abandonado (7 días) son decisiones de ODL y viven en
-- `src/lib/config/portal-funnel.ts`. Aquí entran como argumentos, igual que en
-- `record_portal_activity`, para que no exista una segunda copia en SQL libre
-- de desviarse el día que ODL los cambie.
--
-- ----------------------------------------------------------------------------
-- LO QUE ESTA CAPA SE NIEGA A DECIR
-- ----------------------------------------------------------------------------
-- No hay ninguna función que devuelva «prestado», «desembolsado», «cartera» ni
-- «principal». Esos datos NO EXISTEN en este esquema —no hay tabla de
-- desembolsos, ni plan de pagos, ni saldo— y `approved_amount` es una decisión,
-- no un movimiento de dinero. Un alias que lo llamara de otra forma sería la
-- mentira más cara que este informe podría contar.
--
-- Tampoco hay tasa de apertura, de entrega ni de rebote de correo: no hay
-- columna que las soporte. Ni métricas de WhatsApp: no hay tracking.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. VISTA — LOS LEADS DEL PORTAL
-- ----------------------------------------------------------------------------
-- Un lead ES un intake del formulario público. Deliberadamente NO es
-- `applications.status = 'draft'`: desde 23A un borrador puede ser un
-- expediente que un empleado abrió en el CRM, y contarlo como captación
-- pública fue exactamente el defecto que 26B-26B corrigió en el Dashboard.
--
-- El filtro por `channel = 'website_form'` está en la DEFINICIÓN de la vista,
-- no en cada consulta. Así «lead del portal» significa lo mismo en las trece
-- funciones de abajo sin que ninguna tenga que acordarse.
create view public.reporting_portal_leads as
select
  i.id                        as intake_id,
  i.received_at,
  i.submitted_at,
  i.last_activity_at,
  i.current_step,
  i.status                    as intake_status,
  i.matched_client_id,
  i.created_application_id,
  i.attribution_captured_at,
  i.attribution_utm_source,
  i.attribution_utm_medium,
  i.attribution_utm_campaign,
  i.attribution_utm_content,
  i.attribution_utm_term,
  i.attribution_referrer_host,
  i.attribution_landing_path,
  a.status                    as application_status,
  a.application_number,
  a.product_id,
  a.requested_amount,
  a.approved_amount
from public.application_intakes i
left join public.applications a on a.id = i.created_application_id
where i.channel = 'website_form';

comment on view public.reporting_portal_leads is
  'MILESTONE 26B-26C. Un lead del portal = un intake de canal website_form. NO '
  'es applications.status=draft: un borrador puede ser trabajo manual de ODL. '
  'El filtro vive aqui para que la definicion sea unica.';

-- ----------------------------------------------------------------------------
-- 2. VISTA — LAS SOLICITUDES, CON SUS FECHAS DE DECISIÓN REALES
-- ----------------------------------------------------------------------------
-- `applications.status_changed_at` es UN SOLO CAMPO Y SE SOBRESCRIBE. Sirve
-- para saber cuándo cambió por última vez; no sirve para responder «¿cuántas se
-- aprobaron en agosto?», porque una solicitud aprobada en agosto y cancelada en
-- septiembre ya no conserva la fecha de la aprobación.
--
-- Por eso cada fecha de decisión se saca de `crm_events`, que es append-only.
-- `min()` porque la primera transición a ese estado es la que ocurrió: hoy los
-- estados terminales no tienen salida, así que no puede haber dos, y usar
-- `min()` en vez de asumirlo evita que un futuro reingreso duplique el conteo.
--
-- LÍMITE DECLARADO: `crm_events` empieza en su propia fila más antigua. Para
-- cualquier transición anterior a esa fecha no hay instante recuperable, y
-- `reporting_coverage()` publica ese corte para que el informe pueda decirlo en
-- vez de insinuar que cubre todo.
--
-- La formalización prefiere `application_intakes.submitted_at`: es el registro
-- autoritativo del envío del solicitante. El evento queda como respaldo para
-- una solicitud formalizada dentro del CRM, que no tiene intake.
create view public.reporting_applications as
select
  a.id                          as application_id,
  a.created_at,
  a.status,
  a.created_source,
  a.application_number,
  a.client_id,
  a.product_id,
  a.assigned_advisor_profile_id,
  a.requested_amount,
  a.approved_amount,
  i.id                          as intake_id,
  coalesce(
    i.submitted_at,
    (select min(e.occurred_at) from public.crm_events e
      where e.application_id = a.id
        and e.event_type = 'application_status_changed'
        and e.new_value->>'status' = 'in_review')
  )                             as formalized_at,
  (select min(e.occurred_at) from public.crm_events e
    where e.application_id = a.id
      and e.event_type = 'application_status_changed'
      and e.new_value->>'status' = 'approved')      as approved_at,
  (select min(e.occurred_at) from public.crm_events e
    where e.application_id = a.id
      and e.event_type = 'application_status_changed'
      and e.new_value->>'status' = 'not_eligible')  as declined_at,
  (select min(e.occurred_at) from public.crm_events e
    where e.application_id = a.id
      and e.event_type = 'application_status_changed'
      and e.new_value->>'status' = 'cancelled')     as cancelled_at,
  (select min(r.started_at) from public.application_reviews r
    where r.application_id = a.id)                  as first_review_started_at
from public.applications a
left join public.application_intakes i on i.created_application_id = a.id;

comment on view public.reporting_applications is
  'MILESTONE 26B-26C. Solicitudes con las fechas de decision derivadas de '
  'crm_events, NO de status_changed_at, que es un solo campo sobrescribible y '
  'no puede responder preguntas historicas.';

-- ----------------------------------------------------------------------------
-- 3. COBERTURA — QUÉ PUEDE Y QUÉ NO PUEDE AFIRMAR UN INFORME
-- ----------------------------------------------------------------------------
-- Se devuelve junto a cada informe para que el PDF y la UI no tengan que
-- adivinar. Sin esto, un informe de julio mostraría un embudo vacío y parecería
-- que nadie usó el formulario, cuando lo cierto es que aún no se medía.
create function public.reporting_coverage()
returns table (
  funnel_tracking_started_at      timestamptz,
  attribution_tracking_started_at timestamptz,
  audit_events_started_at         timestamptz,
  disbursement_metrics_available  boolean,
  whatsapp_metrics_available      boolean,
  email_delivery_metrics_available boolean,
  compliance_metrics_available    boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select
    t.tracking_started_at,
    t.attribution_tracking_started_at,
    (select min(occurred_at) from public.crm_events),
    -- No existe tabla de desembolsos, ni plan de pagos, ni saldo. Constante
    -- `false` a proposito: el dia que exista la capa, esta linea cambia y todo
    -- informe que la consulte se entera.
    false,
    -- Sin tracking estructurado de WhatsApp.
    false,
    -- `email_messages` no tiene estado de entrega/rebote/apertura.
    false,
    -- Declaraciones y revisiones existen, pero no hay campos de riesgo,
    -- screening ni EDD: bloqueado por politica, no por esquema.
    false
  from public.portal_funnel_tracking t;
$function$;

-- ----------------------------------------------------------------------------
-- 4. LEADS DEL PORTAL
-- ----------------------------------------------------------------------------
-- PERSONAS ÚNICAS ES PARCIAL, Y SE DICE. La regla de identidad oficial de este
-- sistema es la fila de `clients` (la cédula es UNIQUE). Un intake que el motor
-- no pudo emparejar —`needs_review`— no tiene identidad resuelta y NO se cuenta
-- como persona: contarlo sería afirmar que es alguien distinto sin saberlo, y
-- deduplicar por correo sería inventar una segunda regla de identidad que
-- discreparía de la oficial. Por eso viaja `unresolved_intakes` al lado: la
-- cifra es exacta para lo resuelto y declara cuánto no lo está.
--
-- Los estados active/stalled/abandoned son del PRESENTE, calculados contra
-- `p_now`. Dicen cómo están hoy los leads que nacieron en el periodo; NO dicen
-- cuándo se abandonaron. Esa diferencia la explica el informe, no esta función.
create function public.reporting_lead_metrics(
  p_from timestamptz,
  p_to timestamptz,
  p_stalled_seconds integer,
  p_abandoned_seconds integer,
  p_now timestamptz default now()
)
returns table (
  leads                bigint,
  unique_people        bigint,
  unresolved_intakes   bigint,
  converted            bigint,
  active_now           bigint,
  stalled_now          bigint,
  abandoned_now        bigint,
  resumed_events       bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select
    count(*),
    count(distinct l.matched_client_id),
    count(*) filter (where l.matched_client_id is null),
    count(*) filter (where l.submitted_at is not null),
    count(*) filter (
      where l.submitted_at is null
        and p_now - l.last_activity_at < make_interval(secs => p_stalled_seconds)),
    count(*) filter (
      where l.submitted_at is null
        and p_now - l.last_activity_at >= make_interval(secs => p_stalled_seconds)
        and p_now - l.last_activity_at <  make_interval(secs => p_abandoned_seconds)),
    count(*) filter (
      where l.submitted_at is null
        and p_now - l.last_activity_at >= make_interval(secs => p_abandoned_seconds)),
    -- Reanudaciones OCURRIDAS en el periodo, no de los leads del periodo: una
    -- solicitud de julio que vuelve en agosto es actividad de agosto.
    (select count(*) from public.portal_funnel_events e
      where e.event_type = 'portal_resumed'
        and e.occurred_at >= p_from and e.occurred_at < p_to)
  from public.reporting_portal_leads l
  where l.received_at >= p_from and l.received_at < p_to;
$function$;

-- ----------------------------------------------------------------------------
-- 5. CLIENTES NUEVOS
-- ----------------------------------------------------------------------------
-- Se separa por `clients.created_source`, que es una columna almacenada, y NO
-- por la etapa en que esté su solicitud. Deducir «manual» de una etapa fue
-- justamente el defecto de `activeLeads`.
create function public.reporting_new_clients(p_from timestamptz, p_to timestamptz)
returns table (total bigint, from_portal bigint, manual bigint, other_channels bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select
    count(*),
    count(*) filter (where c.created_source = 'website_form'),
    count(*) filter (where c.created_source = 'crm_manual'),
    count(*) filter (where c.created_source not in ('website_form','crm_manual'))
  from public.clients c
  where c.created_at >= p_from and c.created_at < p_to;
$function$;

-- ----------------------------------------------------------------------------
-- 6. SOLICITUDES
-- ----------------------------------------------------------------------------
-- CADA CIFRA CON SU PROPIA FECHA, y por eso no suman entre sí: `created` usa
-- `created_at`, `formalized` el envío, y las decisiones su evento. Una
-- solicitud creada en julio y aprobada en agosto cuenta en julio para la
-- primera y en agosto para la tercera. Es correcto, y confundirlo produciría
-- informes que no cuadran consigo mismos.
--
-- `open_at_period_end` NO es un rango: es un CORTE. Cuántas seguían abiertas al
-- cerrar el periodo.
create function public.reporting_application_metrics(p_from timestamptz, p_to timestamptz)
returns table (
  created            bigint,
  formalized         bigint,
  approved           bigint,
  declined           bigint,
  cancelled          bigint,
  decisions          bigint,
  open_at_period_end bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select
    (select count(*) from public.reporting_applications a
      where a.created_at >= p_from and a.created_at < p_to),
    (select count(*) from public.reporting_applications a
      where a.formalized_at >= p_from and a.formalized_at < p_to),
    (select count(*) from public.reporting_applications a
      where a.approved_at >= p_from and a.approved_at < p_to),
    (select count(*) from public.reporting_applications a
      where a.declined_at >= p_from and a.declined_at < p_to),
    (select count(*) from public.reporting_applications a
      where a.cancelled_at >= p_from and a.cancelled_at < p_to),
    -- EL DENOMINADOR DE LA TASA DE APROBACIÓN: solo decisiones de crédito.
    -- `cancelled` es un cierre administrativo sin juicio sobre el solicitante
    -- —lo dice el propio esquema al darle el mismo trato que a `waived`— y
    -- meterlo aqui rebajaria la tasa por papeleo en vez de por criterio.
    (select count(*) from public.reporting_applications a
      where (a.approved_at >= p_from and a.approved_at < p_to)
         or (a.declined_at >= p_from and a.declined_at < p_to)),
    (select count(*) from public.reporting_applications a
      where a.created_at < p_to
        and a.status in ('draft','new','in_review'));
$function$;

-- ----------------------------------------------------------------------------
-- 7. DINERO — SOLICITADO Y APROBADO. NADA MÁS.
-- ----------------------------------------------------------------------------
-- UNA SOLICITUD SIN `approved_amount` NO ES UN APROBADO DE CERO. `sum` ignora
-- los NULL y `avg` promedia solo lo conocido: es lo que hace Postgres y es lo
-- correcto, pero se documenta porque la lectura ingenua de un promedio sobre 4
-- filas de las que 2 son NULL invita a dividir entre 4.
--
-- MEDIANA CON `percentile_disc`, no `percentile_cont`: devuelve una cifra
-- REALMENTE OBSERVADA y conserva NUMERIC. La versión continua interpolaría
-- entre dos montos y devolvería double precision — un importe que nadie pidió
-- ni aprobó, con error de coma flotante encima.
create function public.reporting_financial_metrics(p_from timestamptz, p_to timestamptz)
returns table (
  requested_count   bigint,
  requested_total   numeric,
  requested_average numeric,
  requested_median  numeric,
  approved_count    bigint,
  approved_total    numeric,
  approved_average  numeric,
  approved_median   numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select
    (select count(a.requested_amount) from public.reporting_applications a
      where a.created_at >= p_from and a.created_at < p_to),
    (select sum(a.requested_amount) from public.reporting_applications a
      where a.created_at >= p_from and a.created_at < p_to),
    (select avg(a.requested_amount) from public.reporting_applications a
      where a.created_at >= p_from and a.created_at < p_to),
    (select percentile_disc(0.5) within group (order by a.requested_amount)
       from public.reporting_applications a
      where a.created_at >= p_from and a.created_at < p_to
        and a.requested_amount is not null),
    (select count(a.approved_amount) from public.reporting_applications a
      where a.approved_at >= p_from and a.approved_at < p_to),
    (select sum(a.approved_amount) from public.reporting_applications a
      where a.approved_at >= p_from and a.approved_at < p_to),
    (select avg(a.approved_amount) from public.reporting_applications a
      where a.approved_at >= p_from and a.approved_at < p_to),
    (select percentile_disc(0.5) within group (order by a.approved_amount)
       from public.reporting_applications a
      where a.approved_at >= p_from and a.approved_at < p_to
        and a.approved_amount is not null);
$function$;

-- ----------------------------------------------------------------------------
-- 8. POR PRODUCTO
-- ----------------------------------------------------------------------------
-- Se recorre `products`, no las solicitudes, para que un producto sin actividad
-- salga con ceros en vez de desaparecer: «el producto E no vendió nada» es un
-- dato, y una fila ausente se lee como si el producto no existiera. Nada de
-- UUID escrito a mano.
create function public.reporting_product_metrics(p_from timestamptz, p_to timestamptz)
returns table (
  product_id       uuid,
  product_code     text,
  application_code text,
  created          bigint,
  formalized       bigint,
  approved         bigint,
  declined         bigint,
  requested_total  numeric,
  approved_total   numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select
    p.id, p.code, p.application_code,
    count(a.application_id) filter (where a.created_at   >= p_from and a.created_at   < p_to),
    count(a.application_id) filter (where a.formalized_at >= p_from and a.formalized_at < p_to),
    count(a.application_id) filter (where a.approved_at  >= p_from and a.approved_at  < p_to),
    count(a.application_id) filter (where a.declined_at  >= p_from and a.declined_at  < p_to),
    coalesce(sum(a.requested_amount) filter (where a.created_at  >= p_from and a.created_at  < p_to), 0),
    coalesce(sum(a.approved_amount)  filter (where a.approved_at >= p_from and a.approved_at < p_to), 0)
  from public.products p
  left join public.reporting_applications a on a.product_id = p.id
  group by p.id, p.code, p.application_code, p.display_order
  order by p.display_order, p.code;
$function$;

-- ----------------------------------------------------------------------------
-- 9. EMBUDO HISTÓRICO — SOLO DESDE EL CORTE
-- ----------------------------------------------------------------------------
-- `count(distinct application_intake_id)` cuenta PERSONAS, no renders. El
-- índice único de 26B-26B ya garantiza una fila por intake/evento/paso, así que
-- el distinct es un cinturón sobre un tirante que ya sujeta — y deja la
-- intención escrita.
--
-- No devuelve nada anterior a `funnel_tracking_started_at` porque no existe
-- nada anterior. Un periodo que empiece antes del corte da cifras del tramo
-- medido, y `reporting_coverage()` dice cuál es ese tramo.
create function public.reporting_funnel_metrics(p_from timestamptz, p_to timestamptz)
returns table (step text, reached bigint, completed bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select
    s.step,
    (select count(distinct e.application_intake_id) from public.portal_funnel_events e
      where e.step = s.step and e.event_type = 'portal_step_reached'
        and e.occurred_at >= p_from and e.occurred_at < p_to),
    (select count(distinct e.application_intake_id) from public.portal_funnel_events e
      where e.step = s.step and e.event_type = 'portal_step_completed'
        and e.occurred_at >= p_from and e.occurred_at < p_to)
  from (values
    ('applicant_data', 1), ('loan_selection', 2), ('financial_data', 3),
    ('documents', 4), ('review', 5)
  ) as s(step, ord)
  order by s.ord;
$function$;

-- ----------------------------------------------------------------------------
-- 10. DOCUMENTOS
-- ----------------------------------------------------------------------------
-- DOS NATURALEZAS EN UNA MISMA FUNCIÓN, y por eso los nombres lo dicen. Las
-- subidas son de PERIODO (`uploaded_at`); los estados de los requisitos son del
-- PRESENTE, porque `requirement_slots.status_changed_at` es un solo campo
-- sobrescribible y no puede responder «cuántos estaban pendientes en julio».
--
-- El vocabulario es el real del esquema —pending, submitted, under_review,
-- satisfied, rejected, waived, missing—. `satisfied` es el equivalente a
-- «aprobado» y `rejected` existe de verdad: ninguno se inventa.
create function public.reporting_document_metrics(p_from timestamptz, p_to timestamptz)
returns table (
  uploaded_in_period            bigint,
  applications_with_uploads     bigint,
  reviewed_in_period            bigint,
  slots_pending_now             bigint,
  slots_submitted_now           bigint,
  slots_under_review_now        bigint,
  slots_satisfied_now           bigint,
  slots_rejected_now            bigint,
  slots_waived_now              bigint,
  slots_missing_now             bigint,
  documents_awaiting_review_now bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select
    (select count(*) from public.dossier_documents d
      where d.uploaded_at >= p_from and d.uploaded_at < p_to),
    (select count(distinct s.application_id)
       from public.dossier_documents d
       join public.requirement_slots s on s.id = d.requirement_slot_id
      where d.uploaded_at >= p_from and d.uploaded_at < p_to),
    (select count(*) from public.dossier_documents d
      where d.reviewed_at >= p_from and d.reviewed_at < p_to),
    (select count(*) from public.requirement_slots where status = 'pending'),
    (select count(*) from public.requirement_slots where status = 'submitted'),
    (select count(*) from public.requirement_slots where status = 'under_review'),
    (select count(*) from public.requirement_slots where status = 'satisfied'),
    (select count(*) from public.requirement_slots where status = 'rejected'),
    (select count(*) from public.requirement_slots where status = 'waived'),
    (select count(*) from public.requirement_slots where status = 'missing'),
    -- Recibido no es revisado: un documento subido sin `reviewed_at` es cola de
    -- trabajo. NO es papeleo que falte, que seria otra pregunta distinta.
    (select count(*) from public.dossier_documents d
      where d.uploaded_at is not null and d.reviewed_at is null);
$function$;

-- ----------------------------------------------------------------------------
-- 11. DURACIONES DEL PROCESO
-- ----------------------------------------------------------------------------
-- Solo cuatro, y solo estas cuatro: son las únicas cuyos dos extremos son
-- timestamps append-only o campos que nunca se reescriben. Cualquier duración
-- que dependiera de `status_changed_at` mediría la última vez que algo cambió,
-- no el proceso.
--
-- La duración se ancla por su instante FINAL: un expediente que se aprobó en
-- agosto cuenta en agosto aunque empezara en julio. Anclarlo al inicio dejaría
-- el mes en curso permanentemente incompleto.
--
-- Aquí sí `percentile_cont`: interpolar entre dos duraciones da un número con
-- sentido, y no es dinero.
create function public.reporting_process_durations(p_from timestamptz, p_to timestamptz)
returns table (
  metric        text,
  sample_count  bigint,
  average_hours double precision,
  median_hours  double precision,
  p90_hours     double precision
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  with samples as (
    select 'intake_to_submission' as metric,
           extract(epoch from (l.submitted_at - l.received_at)) / 3600.0 as hours
      from public.reporting_portal_leads l
     where l.submitted_at >= p_from and l.submitted_at < p_to
       and l.submitted_at >= l.received_at
    union all
    select 'submission_to_first_review',
           extract(epoch from (a.first_review_started_at - a.formalized_at)) / 3600.0
      from public.reporting_applications a
     where a.first_review_started_at >= p_from and a.first_review_started_at < p_to
       and a.formalized_at is not null
       and a.first_review_started_at >= a.formalized_at
    union all
    select 'submission_to_decision',
           extract(epoch from (least(a.approved_at, a.declined_at) - a.formalized_at)) / 3600.0
      from public.reporting_applications a
     where least(a.approved_at, a.declined_at) >= p_from
       and least(a.approved_at, a.declined_at) < p_to
       and a.formalized_at is not null
       and least(a.approved_at, a.declined_at) >= a.formalized_at
    union all
    select 'upload_to_document_review',
           extract(epoch from (d.reviewed_at - d.uploaded_at)) / 3600.0
      from public.dossier_documents d
     where d.reviewed_at >= p_from and d.reviewed_at < p_to
       and d.uploaded_at is not null
       and d.reviewed_at >= d.uploaded_at
  )
  select
    m.metric,
    count(s.hours),
    avg(s.hours),
    percentile_cont(0.5) within group (order by s.hours),
    percentile_cont(0.9) within group (order by s.hours)
  from (values
    ('intake_to_submission'), ('submission_to_first_review'),
    ('submission_to_decision'), ('upload_to_document_review')
  ) as m(metric)
  left join samples s on s.metric = m.metric
  group by m.metric
  order by m.metric;
$function$;

-- ----------------------------------------------------------------------------
-- 12. EQUIPO — VOLUMEN Y CARGA, NUNCA UN RANKING
-- ----------------------------------------------------------------------------
-- NO DEVUELVE TASA DE APROBACIÓN POR ASESOR, y es deliberado. Esa cifra depende
-- del perfil de los clientes que a cada uno le tocaron, no de su criterio, y
-- publicarla como rendimiento empuja exactamente al comportamiento que un
-- prestamista no quiere. Lo que sí se puede medir sin distorsionar —cuánto
-- entra, cuánto se sostiene, cuánto se decide— está aquí; la interpretación es
-- de ODL.
--
-- Se recorren los PERFILES para que quien no lleva nada salga con ceros: esa es
-- justamente la fila que un gerente necesita ver.
create function public.reporting_team_metrics(p_from timestamptz, p_to timestamptz)
returns table (
  profile_id           uuid,
  role                 text,
  assigned_open_now    bigint,
  formalized_in_period bigint,
  approved_in_period   bigint,
  declined_in_period   bigint,
  requested_total      numeric,
  approved_total       numeric,
  followups_open_now   bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select
    pr.id, pr.role,
    count(a.application_id) filter (
      where a.status in ('draft','new','in_review')),
    count(a.application_id) filter (where a.formalized_at >= p_from and a.formalized_at < p_to),
    count(a.application_id) filter (where a.approved_at  >= p_from and a.approved_at  < p_to),
    count(a.application_id) filter (where a.declined_at  >= p_from and a.declined_at  < p_to),
    coalesce(sum(a.requested_amount) filter (where a.formalized_at >= p_from and a.formalized_at < p_to), 0),
    coalesce(sum(a.approved_amount)  filter (where a.approved_at   >= p_from and a.approved_at   < p_to), 0),
    (select count(*) from public.application_follow_ups f
      join public.applications fa on fa.id = f.application_id
     where fa.assigned_advisor_profile_id = pr.id
       and f.next_action_at is not null and f.completed_at is null)
  from public.profiles pr
  left join public.reporting_applications a on a.assigned_advisor_profile_id = pr.id
  where pr.active
  group by pr.id, pr.role, pr.full_name
  order by pr.full_name;
$function$;

-- ----------------------------------------------------------------------------
-- 13. SEGUIMIENTOS — DE PERIODO Y DE AHORA, SEPARADOS
-- ----------------------------------------------------------------------------
-- «Vencidos» es del PRESENTE. «Vencidos durante agosto» no es lo mismo y no se
-- puede responder: el modelo guarda un `next_action_at` por compromiso, no un
-- historial de cuándo estuvo vencido. Los nombres lo dicen para que ningún
-- informe futuro los mezcle.
create function public.reporting_followup_metrics(
  p_from timestamptz, p_to timestamptz, p_now timestamptz default now()
)
returns table (
  created_in_period   bigint,
  completed_in_period bigint,
  open_now            bigint,
  overdue_now         bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select
    (select count(*) from public.application_follow_ups
      where created_at >= p_from and created_at < p_to),
    (select count(*) from public.application_follow_ups
      where completed_at >= p_from and completed_at < p_to),
    (select count(*) from public.application_follow_ups
      where next_action_at is not null and completed_at is null),
    (select count(*) from public.application_follow_ups
      where next_action_at is not null and completed_at is null and next_action_at < p_now);
$function$;

-- ----------------------------------------------------------------------------
-- 14. ATRIBUCIÓN
-- ----------------------------------------------------------------------------
-- TRES POBLACIONES, NO DOS. `unmeasured` son los intakes anteriores al corte de
-- atribución; `measured_without_utm` son llegadas directas u orgánicas —se miró
-- y no había campaña—. Fundirlas presentaría una ausencia de medición como si
-- fuera una medición, que es el error que 26B-26A prohibió expresamente.
--
-- La fila desglosada solo aparece para lo medido. `primary_social_network` no
-- entra aquí por ningún lado: dice en qué red vive una persona, no por dónde
-- llegó.
create function public.reporting_attribution_metrics(p_from timestamptz, p_to timestamptz)
returns table (
  utm_source    text,
  utm_medium    text,
  utm_campaign  text,
  utm_content   text,
  utm_term      text,
  referrer_host text,
  landing_path  text,
  leads            bigint,
  formalized       bigint,
  approved         bigint,
  requested_total  numeric,
  approved_total   numeric
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select
    l.attribution_utm_source, l.attribution_utm_medium, l.attribution_utm_campaign,
    l.attribution_utm_content, l.attribution_utm_term,
    l.attribution_referrer_host, l.attribution_landing_path,
    count(*),
    count(*) filter (where l.application_number is not null),
    count(*) filter (where l.application_status = 'approved'),
    coalesce(sum(l.requested_amount), 0),
    coalesce(sum(l.approved_amount), 0)
  from public.reporting_portal_leads l
  where l.received_at >= p_from and l.received_at < p_to
    and l.attribution_captured_at is not null
  group by 1,2,3,4,5,6,7
  order by count(*) desc, 1 nulls last;
$function$;

create function public.reporting_attribution_coverage(p_from timestamptz, p_to timestamptz)
returns table (unmeasured bigint, measured_without_utm bigint, measured_with_utm bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select
    count(*) filter (where l.attribution_captured_at is null),
    count(*) filter (
      where l.attribution_captured_at is not null
        and l.attribution_utm_source is null and l.attribution_utm_medium is null
        and l.attribution_utm_campaign is null and l.attribution_utm_content is null
        and l.attribution_utm_term is null),
    count(*) filter (
      where l.attribution_captured_at is not null
        and (l.attribution_utm_source is not null or l.attribution_utm_medium is not null
          or l.attribution_utm_campaign is not null or l.attribution_utm_content is not null
          or l.attribution_utm_term is not null))
  from public.reporting_portal_leads l
  where l.received_at >= p_from and l.received_at < p_to;
$function$;

-- ----------------------------------------------------------------------------
-- 15. COMUNICACIONES — SOLO LO QUE EL ESQUEMA SOPORTA
-- ----------------------------------------------------------------------------
-- Enviados, recibidos y vinculación. NO hay tasa de entrega, rebote ni apertura
-- porque `email_messages` no tiene ninguna columna de estado de entrega, y
-- devolver un cero en su lugar sería peor que no devolver nada. WhatsApp no
-- aparece: no existe tracking.
create function public.reporting_communication_metrics(p_from timestamptz, p_to timestamptz)
returns table (
  emails_sent      bigint,
  emails_received  bigint,
  emails_linked    bigint,
  emails_unlinked  bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $function$
  select
    (select count(*) from public.email_messages
      where direction = 'outbound' and sent_at >= p_from and sent_at < p_to),
    (select count(*) from public.email_messages
      where direction = 'inbound' and received_at >= p_from and received_at < p_to),
    (select count(*) from public.email_messages
      where occurred_at >= p_from and occurred_at < p_to
        and match_status in ('auto_linked','manual_linked')),
    (select count(*) from public.email_messages
      where occurred_at >= p_from and occurred_at < p_to
        and match_status in ('unlinked','ambiguous'));
$function$;

-- ----------------------------------------------------------------------------
-- 16. PERMISOS — SOLO LECTURA, SOLO service_role
-- ----------------------------------------------------------------------------
-- Misma postura que el resto del esquema: `anon` y `authenticated` no ven nada,
-- y las funciones son SECURITY DEFINER con `search_path` fijado porque leen
-- tablas cuya RLS no tiene políticas.
--
-- Todas son `stable` y ninguna escribe: no hay INSERT, UPDATE ni DELETE en este
-- fichero. Una capa de informes que pudiera modificar algo sería una capa de
-- informes en la que no se puede confiar.
revoke all on public.reporting_portal_leads from anon, authenticated;
revoke all on public.reporting_applications from anon, authenticated;
grant select on public.reporting_portal_leads to service_role;
grant select on public.reporting_applications to service_role;

revoke all on function public.reporting_coverage() from public, anon, authenticated;
revoke all on function public.reporting_lead_metrics(timestamptz, timestamptz, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.reporting_new_clients(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.reporting_application_metrics(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.reporting_financial_metrics(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.reporting_product_metrics(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.reporting_funnel_metrics(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.reporting_document_metrics(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.reporting_process_durations(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.reporting_team_metrics(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.reporting_followup_metrics(timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.reporting_attribution_metrics(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.reporting_attribution_coverage(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.reporting_communication_metrics(timestamptz, timestamptz) from public, anon, authenticated;

grant execute on function public.reporting_coverage() to service_role;
grant execute on function public.reporting_lead_metrics(timestamptz, timestamptz, integer, integer, timestamptz) to service_role;
grant execute on function public.reporting_new_clients(timestamptz, timestamptz) to service_role;
grant execute on function public.reporting_application_metrics(timestamptz, timestamptz) to service_role;
grant execute on function public.reporting_financial_metrics(timestamptz, timestamptz) to service_role;
grant execute on function public.reporting_product_metrics(timestamptz, timestamptz) to service_role;
grant execute on function public.reporting_funnel_metrics(timestamptz, timestamptz) to service_role;
grant execute on function public.reporting_document_metrics(timestamptz, timestamptz) to service_role;
grant execute on function public.reporting_process_durations(timestamptz, timestamptz) to service_role;
grant execute on function public.reporting_team_metrics(timestamptz, timestamptz) to service_role;
grant execute on function public.reporting_followup_metrics(timestamptz, timestamptz, timestamptz) to service_role;
grant execute on function public.reporting_attribution_metrics(timestamptz, timestamptz) to service_role;
grant execute on function public.reporting_attribution_coverage(timestamptz, timestamptz) to service_role;
grant execute on function public.reporting_communication_metrics(timestamptz, timestamptz) to service_role;

-- ============================================================================
-- SIN ÍNDICES NUEVOS, Y ES UNA DECISIÓN, NO UN OLVIDO.
-- ============================================================================
-- Los que ya existen cubren cada acceso de esta capa:
--   applications_status_created_at_idx        -> periodo + estado
--   application_intakes_received_at_idx       -> periodo de leads
--   application_intakes_open_drafts_idx       -> estancamiento/abandono
--   crm_events_application_id_occurred_at_idx -> fechas de decision
--   portal_funnel_events_step_once_uk         -> conteos del embudo
--   dossier_documents_requirement_slot_id_created_at_idx
--   email_messages_occurred_at_idx / _received_at_idx
--   application_follow_ups_pending_action_idx
--
-- Faltaria uno por `occurred_at` en `portal_funnel_events` para informes por
-- periodo, y no se crea: la tabla tiene cero filas y crecera unas once por
-- solicitante. Un indice para una tabla que cabe en una pagina es
-- mantenimiento sin lector. Se revisa cuando el volumen lo pida.
-- ============================================================================
