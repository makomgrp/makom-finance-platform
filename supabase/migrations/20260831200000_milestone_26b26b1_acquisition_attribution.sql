-- ============================================================================
-- MILESTONE 26B-26B.1 — DE QUÉ CAMPAÑA VINO CADA SOLICITANTE
-- ============================================================================
--
-- 26B-26A cerró con dos datos que se pierden cada día: el recorrido por el
-- formulario —resuelto en 26B-26B— y la atribución de captación. Esta es la
-- segunda mitad. La URL con la que alguien llega existe durante una petición y
-- después no queda rastro: no hay backfill posible, solo empezar a guardarla.
--
-- ----------------------------------------------------------------------------
-- LA ATRIBUCIÓN ES DEL INTAKE, NO DEL CLIENTE
-- ----------------------------------------------------------------------------
-- Una misma persona puede volver dentro de un año traída por otra campaña. Si
-- la atribución viviera en `clients`, la segunda visita sobrescribiría la
-- primera —perdiendo la campaña que consiguió el préstamo que ODL ya dio— o se
-- descartaría, perdiendo la que consiguió el nuevo. Con dos oportunidades no
-- hay un solo origen que sea el correcto.
--
-- El intake ES la oportunidad. Cada uno conserva el suyo, y las dos preguntas
-- —«¿qué campaña trajo a esta persona la primera vez?» y «¿qué campaña trajo
-- ESTA solicitud?»— tienen respuesta por separado.
--
-- NO CONFUNDIR CON `clients.primary_social_network`. Esa columna dice en qué
-- red vive una persona; esta dice por dónde llegó una solicitud. Alguien que
-- usa Instagram a diario puede haber llegado buscando en Google, y tratar lo
-- uno como lo otro sería inventar atribución.
--
-- ----------------------------------------------------------------------------
-- LO QUE NO SE GUARDA, Y POR QUÉ NO CABE
-- ----------------------------------------------------------------------------
-- Sin URL de referencia completa: solo el HOST. Una referencia real puede ser
-- `https://algun-sitio.com/reset?token=...&email=persona@correo.com`, y
-- guardarla entera metería credenciales y correos de terceros en una tabla de
-- marketing. Ninguna pregunta que ODL quiere responder necesita más que el
-- host.
--
-- Sin query en la página de aterrizaje: solo la RUTA. Los UTM ya viajan en
-- columnas propias, así que la query no añadiría atribución — solo riesgo.
--
-- Sin IP, sin cabeceras completas, sin huella de navegador, sin cookies de
-- marketing. Nada de eso hace falta para responder «¿qué campaña trajo este
-- lead?», y todo eso convierte una analítica en un rastreo.
--
-- Los CHECK de abajo no son validación redundante del código: son lo que hace
-- que una ruta con `?`, un host con `@` o una URL entera sean INALMACENABLES,
-- aunque un futuro autor escriba el insert a mano.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. LAS COLUMNAS
-- ----------------------------------------------------------------------------
-- Todas nullable, y el prefijo `attribution_` las agrupa en una tabla que ya es
-- ancha: en un `select *` se lee de un vistazo qué son y de dónde vienen.
alter table public.application_intakes
  add column attribution_utm_source    text,
  add column attribution_utm_medium    text,
  add column attribution_utm_campaign  text,
  add column attribution_utm_content   text,
  add column attribution_utm_term      text,
  add column attribution_referrer_host text,
  add column attribution_landing_path  text,
  add column attribution_captured_at   timestamptz;

-- ----------------------------------------------------------------------------
-- POR QUÉ EXISTE `attribution_captured_at`
-- ----------------------------------------------------------------------------
-- Sin ella, dos situaciones distintas son idénticas en la fila: alguien que
-- llegó directo escribiendo la dirección (se miró, no había campaña) y un
-- intake anterior a este milestone (nunca se miró). Las dos serían siete NULL.
--
-- Confundirlas es exactamente el error que 26B-26A prohibió: presentar una
-- ausencia de medición como si fuera una medición. Con esta columna,
-- `attribution_captured_at is not null and attribution_utm_source is null` es
-- «llegada directa u orgánica» —un hecho— y `attribution_captured_at is null`
-- es «fuera del periodo medido».
comment on column public.application_intakes.attribution_captured_at is
  'MILESTONE 26B-26B.1. Cuándo se capturó la atribución de primer contacto. '
  'NULL significa que este intake es anterior al seguimiento y NO que llegara '
  'de forma directa: sin esta columna las dos cosas serían indistinguibles.';

comment on column public.application_intakes.attribution_utm_source is
  'MILESTONE 26B-26B.1. `utm_source` normalizado a minúsculas. TEXTO LIBRE a '
  'propósito: el marketing cambia de plataforma más deprisa que el software, y '
  'un catálogo cerrado exigiría una migración por cada red nueva.';

comment on column public.application_intakes.attribution_referrer_host is
  'MILESTONE 26B-26B.1. SOLO el host (instagram.com, google.com). Nunca la URL '
  'completa: una referencia real puede llevar tokens y correos de terceros en '
  'su query o su fragmento, y el host basta para toda la atribución que ODL '
  'necesita.';

comment on column public.application_intakes.attribution_landing_path is
  'MILESTONE 26B-26B.1. SOLO la ruta (/solicitud). Sin query ni fragmento: los '
  'UTM viajan ya en columnas propias.';

-- ----------------------------------------------------------------------------
-- 2. LO QUE LA BASE SE NIEGA A GUARDAR
-- ----------------------------------------------------------------------------
alter table public.application_intakes
  add constraint application_intakes_attribution_lengths_check check (
    (attribution_utm_source    is null or length(attribution_utm_source)    between 1 and 200)
    and (attribution_utm_medium   is null or length(attribution_utm_medium)   between 1 and 200)
    and (attribution_utm_campaign is null or length(attribution_utm_campaign) between 1 and 200)
    and (attribution_utm_content  is null or length(attribution_utm_content)  between 1 and 200)
    and (attribution_utm_term     is null or length(attribution_utm_term)     between 1 and 200)
  );

-- Forma de host y nada más. La arroba es la exclusión que importa: bloquea a la
-- vez `usuario:clave@host` y cualquier cosa con forma de correo — las dos
-- maneras de que algo que no es un host acabe pareciéndolo. Las barras impiden
-- que se cuele una URL entera por esta puerta.
alter table public.application_intakes
  add constraint application_intakes_attribution_referrer_host_check check (
    attribution_referrer_host is null
    or (
      length(attribution_referrer_host) between 1 and 253
      and attribution_referrer_host = lower(attribution_referrer_host)
      and attribution_referrer_host !~ '[/?#@[:space:]]'
    )
  );

-- Ruta absoluta, sin query y sin fragmento. Que el CHECK rechace `?` y `#` es
-- lo que convierte «no guardamos la query» en una garantía en vez de una
-- costumbre del código que la escribe.
alter table public.application_intakes
  add constraint application_intakes_attribution_landing_path_check check (
    attribution_landing_path is null
    or (
      length(attribution_landing_path) between 1 and 512
      and attribution_landing_path like '/%'
      and attribution_landing_path !~ '[?#[:space:]]'
    )
  );

-- Ningún dato de atribución sin la marca de cuándo se capturó. Al revés SÍ se
-- permite —marca sin datos es una llegada directa, que es un hecho legítimo—,
-- pero un UTM sin fecha de captura sería un dato sin procedencia.
alter table public.application_intakes
  add constraint application_intakes_attribution_captured_pair_check check (
    attribution_captured_at is not null
    or (
      attribution_utm_source    is null
      and attribution_utm_medium   is null
      and attribution_utm_campaign is null
      and attribution_utm_content  is null
      and attribution_utm_term     is null
      and attribution_referrer_host is null
      and attribution_landing_path  is null
    )
  );

-- ----------------------------------------------------------------------------
-- 3. FIRST-TOUCH, IMPUESTO POR LA BASE
-- ----------------------------------------------------------------------------
-- La atribución se escribe en el INSERT del intake y en ningún otro sitio. Eso
-- ya sería suficiente hoy… mientras nadie añada un segundo camino.
--
-- Y es fácil añadirlo sin querer: un futuro «reanudar guarda de nuevo el Paso
-- 1» que copiara los parámetros de la URL actual reescribiría la campaña
-- original por la de un enlace interno, y no fallaría nada. El informe
-- simplemente empezaría a decir que las campañas de ODL se traen a sí mismas.
--
-- El trigger convierte «se escribe solo al crear» en una propiedad del dato en
-- vez de una convención que alguien debe recordar. NULL → valor sigue
-- permitido, para que un canal futuro (la integración del sitio web, por
-- ejemplo) pueda rellenar lo que nunca se capturó. Valor → otro valor y
-- valor → NULL se rechazan: el primer contacto es un hecho histórico.
create function public.enforce_intake_attribution_first_touch()
returns trigger
language plpgsql
-- SIN `security definer`: este trigger solo lee OLD y NEW y no toca ninguna
-- tabla, así que no necesita privilegios prestados y no debe tenerlos. El
-- `search_path` fijado sí se conserva — es lo que impide que un search_path
-- manipulado cambie qué resuelve cualquier nombre de aquí dentro.
set search_path = public, pg_temp
as $function$
begin
  if (old.attribution_utm_source    is not null and new.attribution_utm_source    is distinct from old.attribution_utm_source)
  or (old.attribution_utm_medium    is not null and new.attribution_utm_medium    is distinct from old.attribution_utm_medium)
  or (old.attribution_utm_campaign  is not null and new.attribution_utm_campaign  is distinct from old.attribution_utm_campaign)
  or (old.attribution_utm_content   is not null and new.attribution_utm_content   is distinct from old.attribution_utm_content)
  or (old.attribution_utm_term      is not null and new.attribution_utm_term      is distinct from old.attribution_utm_term)
  or (old.attribution_referrer_host is not null and new.attribution_referrer_host is distinct from old.attribution_referrer_host)
  or (old.attribution_landing_path  is not null and new.attribution_landing_path  is distinct from old.attribution_landing_path)
  or (old.attribution_captured_at   is not null and new.attribution_captured_at   is distinct from old.attribution_captured_at)
  then
    raise exception 'Acquisition attribution is first-touch and cannot be rewritten.'
      using errcode = '23514';
  end if;

  return new;
end;
$function$;

create trigger application_intakes_attribution_first_touch
  before update on public.application_intakes
  for each row
  execute function public.enforce_intake_attribution_first_touch();

comment on function public.enforce_intake_attribution_first_touch() is
  'MILESTONE 26B-26B.1. First-touch: una vez capturada, la atribución de un '
  'intake no se reescribe. Permite NULL -> valor para que un canal que hoy no '
  'la captura pueda hacerlo en el futuro.';

-- ----------------------------------------------------------------------------
-- 4. EL CORTE HISTÓRICO — EN LA TABLA QUE YA EXISTE
-- ----------------------------------------------------------------------------
-- 26B-26B creó `portal_funnel_tracking` para poder declarar desde cuándo hay
-- historia de pasos. La atribución necesita exactamente la misma declaración, y
-- crear una segunda tabla-marcador de una fila sería duplicar infraestructura
-- para guardar una fecha.
--
-- Los dos son cortes de la analítica del portal público y se consultan juntos:
-- un informe que diga «campañas desde X» casi siempre dirá también «embudo
-- desde Y». Una fila, un sitio donde mirar.
--
-- `not null default now()` rellena la fila existente con el instante de esta
-- migración, que es la respuesta correcta: antes de ahora no se capturó nada.
alter table public.portal_funnel_tracking
  add column attribution_tracking_started_at timestamptz not null default now();

comment on column public.portal_funnel_tracking.attribution_tracking_started_at is
  'MILESTONE 26B-26B.1. Instante desde el cual se captura atribución de '
  'captación. Los intakes anteriores tienen attribution_captured_at NULL y eso '
  'significa "fuera del periodo medido", nunca "llegada directa".';

comment on table public.portal_funnel_tracking is
  'MILESTONE 26B-26B / 26B-26B.1. Una fila, inmutable: los instantes desde los '
  'cuales existe analítica del portal público — recorrido por los pasos y '
  'atribución de captación. Todo lo anterior a cada marca NO tiene esa historia '
  'y ningún informe puede presentarlo como si la tuviera.';

-- ============================================================================
-- SIN BACKFILL. NI UNA FILA.
-- ============================================================================
-- Los 16 intakes existentes se quedan con las ocho columnas en NULL.
--
-- La tentación concreta que se rechaza: `clients.primary_social_network` dice
-- que alguien usa Instagram, y de ahí a escribir `utm_source = 'instagram'` hay
-- un paso. Sería falso — esa columna dice dónde vive digitalmente esa persona,
-- no por dónde llegó — y quedaría indistinguible de una medición real para
-- siempre. Lo mismo vale para deducir origen de `created_source`, del dominio
-- del correo o de que alguien lo escribiera a mano.
--
-- Una atribución inventada es peor que ninguna: con NULL el informe dice «no
-- se sabe», que es verdad; con un valor fabricado dice una mentira que nadie
-- podrá detectar después.
-- ============================================================================
