-- ============================================================================
-- clients
-- ============================================================================
--
-- Purpose: the Client Engine's identity table (Milestone 14B — see the
-- Milestone 14A architecture review). A real, Supabase-backed replacement
-- for the demo Client model (src/lib/demo-data/clients.ts) that every
-- other real module (applications, dossier_notes, dossier_alerts) has
-- until now only ever bridged to via an unconstrained client_legacy_id
-- text column. This migration creates the table and seeds it with the
-- existing 17 demo Client fixtures (development data, not production
-- customer data) — it deliberately does NOT touch client_legacy_id on
-- any other table, does NOT add a client_id foreign key anywhere, and
-- does NOT migrate any consumer. That is explicitly Milestone 14E's
-- scope; this migration is foundation only, invisible to every current
-- UI surface.
--
-- legacy_id: the same coexistence pattern already proven by
-- profiles.legacy_id (see 20260808032630_add_legacy_id_and_auth_user_id_
-- to_profiles.sql) — a real uuid primary key exists from day one,
-- alongside a nullable, unique, TEXT bridge column that holds the
-- existing demo Client id (e.g. "cl-001") for rows seeded from fixture
-- data. Newly-created real clients (via the service layer's createClient)
-- never populate this column — a new real client is not a legacy client,
-- it simply has no legacy identity to bridge.
--
-- company_legacy_id: a DELIBERATE, TEMPORARY bridge to the existing demo
-- Company ids (e.g. "c-001"), following the exact same reasoning as
-- client_legacy_id itself on applications/dossier_notes/dossier_alerts.
-- Per the Milestone 14A architecture review's Employer/Company section: a
-- real companies table is explicitly NOT introduced by this milestone —
-- that would smuggle a second engine's scope into the Client Engine. Not
-- validated at the database level; the creating service layer is
-- responsible for it, matching every other legacy-id bridge precedent in
-- this schema.
--
-- identification_type / identification_number: the client's identity
-- fact only — never a file. The physical document, if ever captured,
-- belongs to the existing Document Evidence Engine (dossier_documents /
-- requirement_slots), never duplicated here. identification_type is a
-- lowercase text CHECK (cedula/pasaporte), not a native Postgres ENUM,
-- matching every other enum-shaped column in this schema — deliberately
-- different casing/spelling from the demo IdentificationType
-- ("Cédula"/"Pasaporte"), which is a display-layer concern the seed below
-- normalizes at insert time. Uniqueness is a COMPOSITE
-- (identification_type, identification_number), not identification_number
-- alone — a cédula and a passport occupy different numbering spaces and
-- should not be able to collide with each other.
--
-- status: deliberately narrower than the demo ClientStatus vocabulary
-- (activo/prospecto/en_evaluacion/aprobado/restringido/inactivo). Per the
-- Milestone 14A architecture review's Client Status section,
-- en_evaluacion and aprobado describe an Application's outcome, not a
-- real client-level concept, and duplicating ApplicationStatus semantics
-- onto Client was explicitly rejected — a client can have zero, one, or
-- several real Applications in different states simultaneously, so "the
-- client's status IS en_evaluación" does not generalize. restringido is
-- likewise not a lifecycle stage but an orthogonal compliance/risk
-- concern, split out below into its own `restricted` boolean so "active
-- client, compliance hold" becomes representable, which the flat demo
-- enum could not express. No transition/FSM is enforced here (unlike
-- applications_status_check's transition graph) — client status changes
-- are administrative, not business-rule-gated; see setClientStatus in
-- src/lib/services/clients.ts.
--
-- created_by_profile_id / created_source: mirrors applications' and
-- requirement_slots' multi-actor pattern exactly (crm_manual/
-- website_form/whatsapp/ai) — real clients will eventually be created by
-- channels with no corresponding authenticated CRM profile at all (a
-- future website intake form, a WhatsApp flow), same reasoning as
-- applications.created_source. created_by_profile_id is populated ONLY
-- when created_source = 'crm_manual', enforced by
-- clients_created_by_source_check below, identical in shape to
-- applications_created_by_source_check.
--
-- No Row Level Security policies — same posture as every other real
-- table in this schema: RLS is enabled but left fully locked to `anon`
-- and `authenticated`. Reads/writes go through the server-only Supabase
-- client (src/lib/supabase/server.ts) exclusively.

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  legacy_id text unique,
  full_name text not null,
  identification_type text not null,
  identification_number text not null,
  phone text not null,
  email text not null,
  company_legacy_id text,
  position text not null,
  monthly_salary numeric(12, 2) not null,
  birth_date date not null,
  nationality text not null,
  address text not null,
  observations text,
  status text not null default 'prospecto',
  restricted boolean not null default false,
  created_at timestamptz not null default now(),
  created_by_profile_id uuid references public.profiles(id) on delete restrict,
  created_source text not null default 'crm_manual',
  unique (identification_type, identification_number)
);

comment on table public.clients is
  'The Client Engine''s identity table (Milestone 14B). A real, '
  'Supabase-backed replacement for the demo Client model, seeded here '
  'with the existing 17 demo fixtures. See the Milestone 14A '
  'architecture review for the full reasoning behind every column and '
  'every deliberately-absent field (notably assigned_advisor_profile_id, '
  'which stays Application-scoped only — see applications.'
  'assigned_advisor_profile_id).';
comment on column public.clients.legacy_id is
  'Nullable, unique bridge to the existing demo-data client ids (e.g. '
  '"cl-001") — mirrors profiles.legacy_id''s exact coexistence pattern. '
  'Populated only for rows seeded from fixture data by this migration; '
  'newly-created real clients (src/lib/services/clients.ts#createClient) '
  'never populate this column.';
comment on column public.clients.identification_type is
  'One of cedula / pasaporte — lowercase text CHECK, not a native '
  'Postgres ENUM, matching every other enum-shaped column in this '
  'schema. See clients_identification_type_check below.';
comment on column public.clients.identification_number is
  'The identity document''s number only — never a file. See this '
  'migration''s header comment. Unique together with '
  'identification_type, not alone — see the composite unique constraint '
  'above.';
comment on column public.clients.company_legacy_id is
  'DELIBERATE, TEMPORARY bridge to the existing demo Company ids (e.g. '
  '"c-001") — a real companies table is explicitly out of scope for the '
  'Client Engine. See this migration''s header comment. Not validated at '
  'the database level; the creating service layer is responsible for '
  'it.';
comment on column public.clients.status is
  'One of prospecto / activo / inactivo — the client''s own lifecycle '
  'stage, deliberately narrower than the demo ClientStatus vocabulary '
  'and deliberately NOT duplicating ApplicationStatus semantics. See '
  'this migration''s header comment and clients_status_check below.';
comment on column public.clients.restricted is
  'An orthogonal compliance/risk flag, independent from status — a '
  'client can be simultaneously activo and restricted. Toggled via '
  'setClientRestricted, never via setClientStatus.';
comment on column public.clients.created_by_profile_id is
  'Who created the client record — populated ONLY when created_source = '
  '''crm_manual''. Null for clients originated by a website form, '
  'WhatsApp, or AI, which have no corresponding authenticated CRM '
  'profile. ON DELETE RESTRICT: a profile that has created clients '
  'cannot be hard-deleted, only deactivated (profiles.active). See '
  'clients_created_by_source_check below.';
comment on column public.clients.created_source is
  'Which channel/actor-type created the client: crm_manual, '
  'website_form, whatsapp, or ai — the exact same vocabulary as '
  'applications.created_source (src/types/application.ts#ApplicationSource), '
  'reused rather than redefined. See clients_created_source_check below.';

-- Restricts identification_type to the two values this app currently
-- understands.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_identification_type_check'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_identification_type_check
      check (identification_type in ('cedula', 'pasaporte'));
  end if;
end $$;

-- Restricts status to the three values the real Client Engine
-- understands (see this migration's header comment for why this is
-- narrower than the demo ClientStatus vocabulary).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_status_check'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_status_check
      check (status in ('prospecto', 'activo', 'inactivo'));
  end if;
end $$;

-- Restricts created_source to the four actor-type values this app
-- currently understands — same vocabulary as applications.created_source.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_created_source_check'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_created_source_check
      check (created_source in ('crm_manual', 'website_form', 'whatsapp', 'ai'));
  end if;
end $$;

-- created_by_profile_id may only be populated when the client was
-- actually created by a real CRM profile — never for a website form,
-- WhatsApp, or AI-originated client.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_created_by_source_check'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_created_by_source_check
      check (created_by_profile_id is null or created_source = 'crm_manual');
  end if;
end $$;

-- Guards a non-negative monthly salary.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'clients_monthly_salary_check'
      and conrelid = 'public.clients'::regclass
  ) then
    alter table public.clients
      add constraint clients_monthly_salary_check
      check (monthly_salary >= 0);
  end if;
end $$;

-- The real query shapes: name search/sort (the current Clients list's
-- only sort-adjacent behavior) and the status filter dropdown.
-- legacy_id is already indexed via its own unique constraint above.
create index if not exists clients_full_name_idx
  on public.clients (lower(full_name));

create index if not exists clients_status_idx
  on public.clients (status);

-- ============================================================================
-- Row Level Security
-- ============================================================================

-- Enabled with zero policies, same posture as every other real table in
-- this schema: fully locked to both `anon` and `authenticated` until a
-- real permissions model exists. Reads/writes go through the server-only
-- Supabase client in the meantime.
alter table public.clients enable row level security;

-- ============================================================================
-- service_role grants
-- ============================================================================

-- Select + insert + update — no delete. Clients are never hard-deleted,
-- only moved to inactivo — matches the "never delete" posture already
-- applied to every other real table in this schema.
grant select, insert, update on public.clients to service_role;

-- ============================================================================
-- Development fixture seed
-- ============================================================================
--
-- Seeds the existing 17 demo Client fixtures (src/lib/demo-data/
-- clients.ts) verbatim, converting only the identification_type casing
-- to this table's canonical lowercase vocabulary (Cédula -> cedula,
-- Pasaporte -> pasaporte) — no value is invented or enriched.
-- assigned_advisor_profile_id (the demo model's assignedAdvisorId) is
-- deliberately NOT carried over — see this migration's header comment
-- and the Milestone 14A architecture review. registeredAt is not carried
-- over either; created_at uses this migration's execution time instead,
-- since a real audit timestamp should reflect when the real row was
-- created, not the fixture's fictional registration date.
--
-- Idempotent and safely re-runnable via `on conflict (legacy_id) do
-- nothing`: re-running this migration never creates duplicate rows or
-- overwrites a row that may have since been edited through the real
-- service layer.

insert into public.clients (
  legacy_id, full_name, identification_type, identification_number,
  phone, email, company_legacy_id, position, monthly_salary, birth_date,
  nationality, address, observations, status, created_source
)
values
  ('cl-001', 'Juan Pérez', 'cedula', '8-432-1876', '+507 6120-4455', 'juan.perez@correo.com', 'c-001', 'Supervisor de Producción', 1450, '1988-03-14', 'Panameña', 'Calle 3ra, Vista Hermosa, Panamá', 'Cliente referido por otro solicitante aprobado.', 'prospecto', 'crm_manual'),
  ('cl-002', 'Ana Gómez', 'cedula', '4-298-1120', '+507 6234-9981', 'ana.gomez@correo.com', 'c-005', 'Ejecutiva de Cuentas', 1800, '1991-07-22', 'Panameña', 'Urbanización El Dorado, Panamá', null, 'prospecto', 'crm_manual'),
  ('cl-003', 'Carlos Rodríguez', 'cedula', '2-711-345', '+507 6345-1290', 'carlos.rodriguez@correo.com', 'c-003', 'Cajero Principal', 950, '1995-01-09', 'Panameña', 'Barriada Las Acacias, San Miguelito', 'Pendiente de completar documentación.', 'prospecto', 'crm_manual'),
  ('cl-004', 'María López', 'cedula', '9-145-2287', '+507 6789-2233', 'maria.lopez@correo.com', 'c-002', 'Analista de Redes', 2100, '1986-11-30', 'Panameña', 'Costa del Este, Panamá', null, 'activo', 'crm_manual'),
  ('cl-005', 'Pedro González', 'cedula', '6-521-987', '+507 6543-7788', 'pedro.gonzalez@correo.com', 'c-004', 'Técnico de Mantenimiento', 1275, '1990-05-02', 'Panameña', 'Tocumen, Panamá', 'Alerta interna activa por información pendiente de verificar.', 'activo', 'crm_manual'),
  ('cl-006', 'Katherine Solís', 'cedula', '3-187-6642', '+507 6098-4471', 'katherine.solis@correo.com', 'c-006', 'Docente', 1100, '1993-09-16', 'Panameña', 'Chorrera, Panamá Oeste', null, 'activo', 'crm_manual'),
  ('cl-007', 'Luis Herrera', 'cedula', '1-908-2231', '+507 6712-5540', 'luis.herrera@correo.com', 'c-008', 'Operador de Rampa', 1050, '1992-02-19', 'Panameña', '24 de Diciembre, Panamá', null, 'prospecto', 'crm_manual'),
  ('cl-008', 'Yariela Castillo', 'pasaporte', 'PA0198456', '+507 6455-2109', 'yariela.castillo@correo.com', 'c-009', 'Enfermera', 1650, '1989-12-05', 'Venezolana', 'Bethania, Panamá', null, 'activo', 'crm_manual'),
  ('cl-009', 'Roberto Aizprúa', 'cedula', '7-334-8821', '+507 6221-9034', 'roberto.aizprua@correo.com', 'c-005', 'Oficial de Cumplimiento', 2400, '1984-06-11', 'Panameña', 'San Francisco, Panamá', null, 'activo', 'crm_manual'),
  ('cl-010', 'Ivonne Delgado', 'cedula', '5-663-1298', '+507 6890-3345', 'ivonne.delgado@correo.com', 'c-003', 'Encargada de Tienda', 1300, '1994-04-27', 'Panameña', 'Arraiján, Panamá Oeste', null, 'inactivo', 'crm_manual'),
  ('cl-011', 'Manuel Batista', 'cedula', '8-877-2201', '+507 6034-7712', 'manuel.batista@correo.com', 'c-001', 'Jefe de Bodega', 1550, '1987-10-03', 'Panameña', 'Pacora, Panamá', null, 'prospecto', 'crm_manual'),
  ('cl-012', 'Gabriela Núñez', 'cedula', '4-556-9012', '+507 6772-1183', 'gabriela.nunez@correo.com', 'c-004', 'Agente de Servicio al Cliente', 1200, '1996-08-08', 'Panameña', 'Juan Díaz, Panamá', null, 'prospecto', 'crm_manual'),
  ('cl-013', 'Franklin Ortega', 'cedula', '2-190-4456', '+507 6501-8890', 'franklin.ortega@correo.com', 'c-010', 'Conductor', 900, '1983-01-25', 'Panameña', 'Villa Zaíta, Panamá', 'Reincidencia en atraso de pagos con otra entidad, verificar referencias.', 'activo', 'crm_manual'),
  ('cl-014', 'Melissa Chen', 'cedula', '9-402-1187', '+507 6644-0021', 'melissa.chen@correo.com', 'c-002', 'Coordinadora de Marketing', 1950, '1990-09-30', 'Panameña', 'Punta Pacífica, Panamá', null, 'activo', 'crm_manual'),
  ('cl-015', 'Álvaro Jaén', 'cedula', '6-233-7789', '+507 6390-5567', 'alvaro.jaen@correo.com', 'c-006', 'Asistente Administrativo', 1000, '1997-05-14', 'Panameña', 'Santiago, Veraguas', null, 'activo', 'crm_manual'),
  ('cl-016', 'Diana Espinoza', 'cedula', '3-845-1029', '+507 6912-3387', 'diana.espinoza@correo.com', 'c-008', 'Agente de Seguridad Aeroportuaria', 1150, '1992-12-21', 'Panameña', 'Tocumen, Panamá', null, 'prospecto', 'crm_manual'),
  ('cl-017', 'Ricardo Vega', 'cedula', '1-556-2298', '+507 6087-4432', 'ricardo.vega@correo.com', 'c-005', 'Analista Financiero', 2250, '1985-02-27', 'Panameña', 'Obarrio, Panamá', null, 'activo', 'crm_manual')
on conflict (legacy_id) do nothing;
