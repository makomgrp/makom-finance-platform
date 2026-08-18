-- Seeds the 7 existing demo people into `profiles`, keeping their current
-- "u-00N" ids in `legacy_id` so the rest of the app (which still hardcodes
-- these ids as foreign keys in clients/applications/alerts/documents/notes/
-- chat) keeps working unmodified. `id` is left to auto-generate as a real
-- UUID; `auth_user_id` stays null — no Auth account exists for anyone yet.
--
-- Safe to re-run: `on conflict (legacy_id) do nothing` makes this a no-op
-- if these rows already exist.

insert into public.profiles (legacy_id, full_name, email, role, preferred_language, active)
values
  ('u-001', 'Gabriel Herrera',   'gabriel.herrera@odlfinancial.com',   'administrador', 'en', true),
  ('u-002', 'Marisol Duarte',    'marisol.duarte@odlfinancial.com',    'gerente',       'es', true),
  ('u-003', 'Ricardo Sanjur',    'ricardo.sanjur@odlfinancial.com',    'analista',      'es', true),
  ('u-004', 'Fernando Quintero', 'fernando.quintero@odlfinancial.com', 'asesor',        'es', true),
  ('u-005', 'Lucía Batista',     'lucia.batista@odlfinancial.com',     'asesor',        'fr', true),
  ('u-006', 'Diego Espino',      'diego.espino@odlfinancial.com',      'asesor',        'en', true),
  ('u-007', 'Paola Rivas',       'paola.rivas@odlfinancial.com',       'consulta',      'fr', true)
on conflict (legacy_id) do nothing;
