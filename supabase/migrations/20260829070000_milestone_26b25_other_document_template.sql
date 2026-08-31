-- ============================================================================
-- MILESTONE 26B-25 — «OTRO DOCUMENTO»: LO QUE LLEGA POR OTRO CANAL
-- ============================================================================
--
-- ODL recibe documentos por WhatsApp, por correo y en mano. Hoy el expediente
-- solo acepta un archivo contra un requisito que alguien previó de antemano, y
-- lo que no estaba previsto no tiene dónde ir.
--
-- ----------------------------------------------------------------------------
-- POR QUÉ UNA PLANTILLA Y NO UNA COLUMNA NULLABLE
-- ----------------------------------------------------------------------------
-- `requirement_slots.requirement_template_id` es NOT NULL, y eso es una
-- garantía real: todo slot procede de algo catalogado, así que la lista de
-- plantillas sigue siendo el registro permanente de lo que un producto puede
-- exigir. Hacer la columna nullable habría abierto una segunda clase de slot
-- sin catálogo detrás, y con ella la pregunta «¿de dónde salió esto?» sin
-- respuesta estructural.
--
-- Una plantilla por producto es más barata: ninguna tabla cambia de forma.
--
-- ----------------------------------------------------------------------------
-- `inactive` ES LO QUE LA MANTIENE FUERA DEL ALTA AUTOMÁTICA
-- ----------------------------------------------------------------------------
-- createRequirementSlotsForApplication() selecciona plantillas `active`, sin
-- condición y de nivel solicitud. Una plantilla `inactive` no entra en ese
-- filtro, así que ninguna solicitud nace con un «Otro documento» vacío
-- esperando a que alguien lo rellene. El CRM la busca por código cuando alguien
-- decide añadir uno, que es el único momento en que debe existir.
--
-- ----------------------------------------------------------------------------
-- UN MOLDE, MUCHOS DOCUMENTOS
-- ----------------------------------------------------------------------------
-- Cada slot fotografía su propio `name` y `description` (26A-3), así que la
-- misma plantilla respalda tantos documentos distintos como haga falta, cada
-- uno con el nombre que le ponga quien lo incorpora. No hace falta una
-- plantilla por tipo de documento imprevisto — que es justo lo que «imprevisto»
-- hace imposible.
--
-- `actor = internal` porque lo aporta ODL, no el solicitante.
-- `applicant_visible = false` y `required = false` porque no es algo que se
-- pida a nadie: es algo que ya llegó.
-- ============================================================================

insert into public.requirement_templates
  (product_id, code, name, description, requirement_kind, required, display_order,
   status, min_files, allows_multiple_files, stage, actor, condition_key,
   applicant_visible, original_required_later, subject_type)
select p.id,
       'other_document',
       jsonb_build_object('es','Otro documento','en','Other document'),
       jsonb_build_object(
         'es','Documento recibido por otro canal e incorporado al expediente por ODL.',
         'en','Document received through another channel and added to the file by ODL.'),
       'document', false, 900, 'inactive', 1, true,
       'application', 'internal', null, false, false, 'application'
  from public.products p
 where not exists (
   select 1 from public.requirement_templates rt
    where rt.product_id = p.id and rt.code = 'other_document');
