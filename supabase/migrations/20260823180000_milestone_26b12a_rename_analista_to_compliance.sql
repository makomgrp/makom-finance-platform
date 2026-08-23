-- ============================================================================
-- MILESTONE 26B-12A — EL ROL `analista` PASA A LLAMARSE `compliance`
-- ============================================================================
--
-- UN RENOMBRE, NO UN CAMBIO DE PERMISOS. La fila de ROLE_CAPABILITIES conserva
-- exactamente las mismas capacidades; sólo cambia la clave. Quien tenía este
-- rol podía revisar y recomendar pero nunca decidir sobre una solicitud, y eso
-- sigue siendo cierto después de esta migración.
--
-- POR QUÉ UN RENOMBRE TÉCNICO Y NO SÓLO UNA ETIQUETA: `analista` no aparece en
-- ninguna condición del código — la aplicación nunca ramifica por el string del
-- rol, siempre por capability. Tampoco lo referencia ninguna política RLS ni
-- ningún evento histórico de crm_events. El único lugar donde el valor está
-- almacenado es profiles.role. Con esa superficie, dejar el nombre viejo en la
-- base sólo garantizaba que cada auditoría futura tuviera que explicar por qué
-- la base dice una cosa y ODL dice otra.

-- ---------------------------------------------------------------------------
-- 1. El CHECK, reemplazado en el mismo paso que los datos
-- ---------------------------------------------------------------------------
-- Se elimina primero porque 'compliance' todavía no es un valor legal; se
-- vuelve a crear al final, cuando ya no queda ninguna fila con el valor viejo.
alter table public.profiles drop constraint if exists profiles_role_check;

update public.profiles set role = 'compliance' where role = 'analista';

alter table public.profiles add constraint profiles_role_check
  check (role in ('administrador', 'gerente', 'compliance', 'asesor', 'consulta'));

-- ---------------------------------------------------------------------------
-- 2. Las dos funciones SECURITY DEFINER que validan el rol
-- ---------------------------------------------------------------------------
-- create_staff_profile() y update_staff_role() llevan la lista de roles como
-- literal. Se regeneran a partir de su propia definición actual sustituyendo
-- únicamente ese literal, en lugar de reescribirlas a mano: así el cuerpo queda
-- byte a byte idéntico salvo el valor renombrado, y no hay forma de introducir
-- una diferencia accidental en una función que corre con privilegios elevados.
do $$
declare r record;
begin
  for r in
    select p.oid, pg_get_functiondef(p.oid) as def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and pg_get_functiondef(p.oid) like '%''analista''%'
  loop
    execute replace(r.def, '''analista''', '''compliance''');
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Verificación dentro de la propia migración
-- ---------------------------------------------------------------------------
do $$
declare v_filas int; v_funcs int;
begin
  select count(*) into v_filas from public.profiles where role = 'analista';
  if v_filas > 0 then
    raise exception 'quedan % perfiles con el rol antiguo', v_filas;
  end if;

  select count(*) into v_funcs
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prokind = 'f'
    and pg_get_functiondef(p.oid) like '%''analista''%';
  if v_funcs > 0 then
    raise exception 'quedan % funciones citando el rol antiguo', v_funcs;
  end if;
end $$;
