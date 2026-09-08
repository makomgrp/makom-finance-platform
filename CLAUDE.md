# ODL LoanFlow CRM

**Antes de cualquier cambio, lee [`ODL_PROJECT_HANDOFF.md`](ODL_PROJECT_HANDOFF.md).**
Es el documento autoritativo del proyecto: identidad, estado actual, arquitectura
real, reglas de negocio, invariantes de seguridad, base de datos, estado de
Production, backlog y el procedimiento read-only de arranque (PHASE 0).

Este sistema está **EN PRODUCCIÓN con clientes reales** y no tiene entorno de
staging. Tres reglas que no admiten excepción:

1. Verifica el proyecto Supabase (`eazqlwdfkillcwjpdkhg`) antes de **cada**
   operación de base de datos — hay otro proyecto en la misma cuenta que no es
   este.
2. Nunca `git add .` / `-A` / `--all`. Siempre pathspecs explícitos.
3. Nunca pidas, imprimas, registres ni commitees credenciales.

Otras fuentes autoritativas del repo:

- [`AUDIT_TRAIL_ARCHITECTURE.md`](AUDIT_TRAIL_ARCHITECTURE.md) — modelo de auditoría (`crm_events`).
- [`supabase/migrations/`](supabase/migrations/) — fuente de verdad del esquema.
- [`supabase/cutover/README.md`](supabase/cutover/README.md) — procedimiento destructivo revisado, **no aplicado**.
- [`supabase/dev-seeds/README.md`](supabase/dev-seeds/README.md) — datos ficticios, jamás contra Production.

@AGENTS.md
