# ODL LoanFlow CRM — HANDOFF TÉCNICO

> Documento **autoritativo** de traspaso. Escrito el **2026-09-07** desde una
> auditoría del repositorio en `b602bf4`, no desde memoria de conversación.
>
> Su propósito: que un agente nuevo, en otra cuenta, pueda continuar el
> proyecto **sin acceso al historial de chat anterior**.
>
> Lo que este documento **no** es: un volcado de conversación, ni un sustituto
> del código. Donde ya existe una fuente de verdad en el repo, este documento
> **apunta a ella** en lugar de copiarla — porque una copia se desincroniza y la
> fuente no.

---

## ⛔ READ THIS BEFORE MAKING ANY CHANGE

**No escribas una sola línea, no toques la base de datos y no despliegues nada
hasta haber completado el §10 — PHASE 0 (read-only).**

Reglas duras, en orden de gravedad:

1. **Verifica el proyecto Supabase antes de CADA operación de base de datos.**
   Este proyecto es `eazqlwdfkillcwjpdkhg` / `odl-finance-crm` (ref documentado
   desde antes en [`AUDIT_TRAIL_ARCHITECTURE.md`](AUDIT_TRAIL_ARCHITECTURE.md)).
   Existe **otro** proyecto Supabase en la misma organización que **NUNCA** debe
   tocarse. Si el MCP/CLI no te confirma el ref, **detente**.
2. **Production está VIVO con clientes reales.** No es un entorno de prueba. No
   hay staging. No existe base de datos de desarrollo separada.
3. **Nunca `git add .`, `git add -A` ni `git add --all`.** Siempre pathspecs
   explícitos. Razón histórica en [`.gitignore`](.gitignore): `.mcp.json`
   estuvo *untracked pero no ignorado* durante ocho milestones y sobrevivió solo
   porque cada commit se hizo con rutas explícitas.
4. **Nunca pidas, imprimas, registres ni commitees credenciales.** Ni
   `.env.local`, ni `.mcp.json`, ni `CRON_SECRET`, ni claves service-role.
5. **No relajes seguridad para hacer pasar una prueba.** Si un test falla contra
   RLS, contra una capability o contra el alcance de sucursal, el test está
   diciendo la verdad.
6. **No inventes esquema.** Lee `supabase/migrations/` antes de asumir que una
   columna, un check o una función existen.
7. **No crees datos en Production para probar** sin autorización explícita del
   usuario, expediente por expediente.
8. **Ante cualquier discrepancia** entre este handoff, el código, la base de
   datos y Production: **detente y repórtala.** No la resuelvas unilateralmente.

El detalle completo de las reglas de trabajo está en **§8**.

---

## 1. IDENTIDAD DEL PROYECTO

| | |
|---|---|
| **Producto** | ODL LoanFlow CRM |
| **Cliente** | ODL Financial Corporation, Panamá |
| **Qué es** | Sistema de originación de préstamos: portal público de solicitud, CRM interno multisucursal, expediente digital, revisión de crédito/compliance, reporting de dirección |
| **Paquete npm** | `odl-loanflow-crm` (ver [`package.json`](package.json)) |
| **Repositorio** | `https://github.com/makomgrp/makom-finance-platform.git` |
| **Directorio local** | `ODL Financial/Makom Finance` |
| **Estado** | **EN PRODUCCIÓN con clientes reales** |
| **Idiomas de producto** | Español (por defecto) e inglés — paridad obligatoria |
| **Zona horaria de negocio** | `America/Panama` (UTC−5 todo el año, sin DST) |
| **Moneda** | Balboa panameño (`B/.`), paridad 1:1 con USD |

### Stack real (verificado en `package.json`)

- **Next.js 16.3.0** con React **19.2.8** — App Router, Server Components,
  Server Actions, Route Handlers.
  ⚠️ Esta versión **no es la que conoces**. `src/proxy.ts` cumple el papel del
  antiguo `middleware.ts`. Lee `node_modules/next/dist/docs/` antes de escribir
  código de framework — es lo que exige [`AGENTS.md`](AGENTS.md), que es
  regenerado automáticamente por `next dev` y **no debe editarse a mano**.
- **Supabase** (`@supabase/supabase-js` 2.x, `@supabase/ssr` 0.12.x) — Postgres
  + Auth + Storage.
- **next-intl 4.x** — locale por cookie `NEXT_LOCALE`.
- **Tailwind CSS 4** + shadcn/ui + Base UI + lucide-react.
- **pdfkit** (PDFs), **exceljs** (XLSX), **nodemailer** + **imapflow** +
  **mailparser** (buzón operativo), **sanitize-html**, **date-fns**.
- **Tests**: `node --test` con *type stripping* nativo de Node 24.
  **Cero dependencias de test.** Comando: `npm test`.
  Los ficheros de test importan con ruta relativa **y extensión `.ts`**.
- **Hosting**: Vercel. Cron declarado en [`vercel.json`](vercel.json).

### Estructura relevante

```
src/
  app/
    (app)/            pantallas autenticadas del CRM
    api/              route handlers (exportaciones, PDFs, cron, intake público)
    solicitud/        PORTAL PÚBLICO del cliente (multi-paso, por token)
    solicitud-clasico/ formulario público antiguo (15C)
    login|forgot-password|reset-password|auth/callback
  components/         UI por dominio (applications, dossier, portal, reports…)
  lib/
    auth/             capabilities, authorize, perfil actual, route-access
    services/         57 servicios: TODO el acceso a datos vive aquí
    reporting/        excel/, pdf/, closures/ + periodos y presentación
    config/           reglas de negocio declarativas (transiciones, catálogos)
    supabase/         los TRES clientes (ver §3)
    validation/, activity/, chat/, hooks/, demo-data/
  types/              contratos de dominio (28 ficheros)
  i18n/               config y request de next-intl
  proxy.ts            el "middleware" de esta versión de Next
messages/es.json | en.json     2009 claves cada uno — paridad exacta
supabase/
  migrations/         85 migraciones — LA FUENTE DE VERDAD DEL ESQUEMA
  cutover/            procedimiento destructivo REVISADO PERO NO EJECUTADO
  dev-seeds/          datos ficticios — JAMÁS contra Production
```

### Ambientes

| Ambiente | Existe | Notas |
|---|---|---|
| **Production** | ✅ | `https://makom-finance-platform.vercel.app` |
| Staging | ❌ | **No existe.** No hay entorno intermedio. |
| DB de desarrollo | ❌ | **No existe.** El proyecto Supabase de Production es el único. |
| Local | ✅ | `npm run dev` — apunta al mismo Supabase vía `.env.local` |

> **Consecuencia directa:** cualquier prueba local que escriba en Supabase
> escribe en Production. Trátalo así siempre.

---

## 2. ESTADO ACTUAL EXACTO

| | |
|---|---|
| **Branch de trabajo** | `feature/client-engine` |
| **HEAD** | `b602bf4f73eeacf6aa4ca6fd086a206d62409a9b` |
| **origin/feature/client-engine** | `b602bf4f73eeacf6aa4ca6fd086a206d62409a9b` (sincronizado) |
| **origin/main** | `a144037f5898665a558f8eaa369a7845f5d27784` |
| **Working tree** | CLEAN (verificado 2026-09-07) |
| **Commits en la rama** | 117 |
| **Tests** | **307/307 PASS** (re-ejecutados 2026-09-07) |
| **Paridad i18n** | **2009 / 2009**, drift 0 (re-verificada 2026-09-07) |

### ⚠️ `main` NO es la rama de producción

`origin/main` está **88 commits por detrás** de `feature/client-engine`.
Su último commit es un merge de `feature/supabase-integration` y **no contiene**
prácticamente ninguno de los milestones 26A/26B.

**Production despliega desde `feature/client-engine`.** No hagas PR a `main`, no
rebases sobre `main` y no asumas que `main` es la línea principal, hasta que el
usuario decida explícitamente cómo se reconcilian las dos ramas. Está anotado en
el backlog (§9-B).

⚠️ **`origin/main` NO es una referencia autoritativa del estado desplegado.**
No lo uses para deducir qué corre en Production, ni para comparar contra
Production, sin **investigar primero** cuál es el SHA realmente desplegado
(§10.5). Leer `main` y concluir de ahí lo que hay en producción daría una
respuesta equivocada en 88 commits.

### Production

| | |
|---|---|
| **URL** | `https://makom-finance-platform.vercel.app` |
| **SHA desplegado** | `b602bf4f73eeacf6aa4ca6fd086a206d62409a9b` |
| **Deployment ID** | `6210936509` |
| **Estado** | success · `2026-09-01T21:42:43Z` · el más reciente |

> Estos cuatro valores fueron verificados durante **26B-27A.P** (2026-09-01).
> **Re-verifícalos en PHASE 0** antes de tocar nada: pueden haber cambiado.

### Último milestone cerrado

**MILESTONE 26B-27A.P — PRODUCTION VERIFICATION → VERDICT: CLOSED**
(Expediente imprimible en PDF. Detalle en §7.)

### Punto exacto desde el cual continuar

El árbol está limpio, la rama está empujada y Production corre ese mismo SHA.
**No hay trabajo a medias.** El siguiente milestone empieza desde cero sobre
`b602bf4`.

### Próximo milestone previsto

**26B-27B — NO IMPLEMENTADO, NO DISEÑADO, NO AUTORIZADO.** Ver §9-A.

---

## 3. ARQUITECTURA (verificada en código)

### 3.1 Los tres clientes de Supabase

`src/lib/supabase/` contiene exactamente tres, y la distinción es la columna
vertebral de la seguridad del sistema:

| Fichero | Clave | Dónde corre | Para qué |
|---|---|---|---|
| `client.ts` | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | navegador | lectura pública/auth de sesión |
| `server-authenticated.ts` | publishable + cookies de sesión | servidor | actuar **como el usuario** |
| `server.ts` | `SUPABASE_SECRET_KEY` | servidor, con `import "server-only"` | el **único escritor real** |

`server.ts` lleva `import "server-only"`: importarlo desde un fichero
`"use client"` es un **error de compilación**, no una convención. No lo quites.

### 3.2 Autenticación

- Supabase Auth. El proxy (`src/proxy.ts`) llama `supabase.auth.getUser()` —
  **revalida contra el servidor de Auth**, no confía en la mera presencia de la
  cookie — y de paso deja que `@supabase/ssr` refresque el token.
- Sin sesión y sin ruta exenta → **redirect 307 a `/login`**.
- Rutas exentas: `src/lib/auth/route-access.ts`, con **dos predicados
  distintos** y deliberadamente separados:
  - `isPublicPath()` — no exige nada a nadie: `/`, `/login`, `/forgot-password`,
    `/reset-password`, `/auth/callback`, `/solicitud-clasico`, el prefijo del
    portal `/solicitud` + `/solicitud/`, y el prefijo `/api/public/`.
  - `isMachineAuthenticatedPath()` — **coincidencia exacta**, lista de un solo
    elemento: `/api/cierres-mensuales`. Exige un secreto que el proxy **no
    conoce y no debe conocer**; comprobarlo es trabajo del handler.
  ⚠️ Es exacta a propósito: un `startsWith` liberaría también
  `/api/cierres-mensuales/bootstrap`, que **sí** requiere sesión humana.

### 3.3 Autorización — dos ejes independientes

El sistema autoriza por **dos preguntas separadas**, y confundirlas es el error
más fácil de cometer aquí:

| Eje | Pregunta | Dónde vive |
|---|---|---|
| **Capability** | ¿esta persona puede *hacer* esta acción? | `src/lib/auth/capabilities.ts` + `authorize.ts` |
| **Branch scope** | ¿este expediente *le pertenece*? | `src/lib/services/branch-scope-query.ts` |

**Ambos**, o ninguno de los dos, según el caso — ver §4.4.

#### Roles (`src/types/user.ts`)

`administrador` · `gerente` · `compliance` · `asesor` · `consulta`

> `compliance` se llamaba `analista` hasta el milestone 26B-12A (`ef10a5b`).

#### Capabilities

Lista cerrada de ~35 en `src/lib/auth/capabilities.ts`, agrupadas por dominio.
`ROLE_CAPABILITIES` es la matriz autoritativa. Puntos que un agente rompe con
facilidad:

- **`DELEGATABLE_CAPABILITIES` es una allow-list corta**: `user:invite`,
  `user:set_active`, `user:set_role`, `branch:manage`, `branch:transfer`.
  - `user:manage_permissions` **no** es delegable (evita escalada transitiva).
  - `branch:create` **no** es delegable: delegar la *administración* de
    sucursales nunca debe fabricar *alcance* nuevo.
  - `reports:export_sensitive` **no** es delegable.
- `resolveEffectiveCapabilities()` filtra por esa allow-list, así que un grant
  corrupto en base de datos no puede conceder nada fuera de ella.
- `canActOnStaffTarget()` — solo un `administrador` puede actuar sobre otro
  `administrador`.

#### Branch scope

`BranchScope = { mode: "branch" | "national" | "unassigned", branchIds: string[] }`

`applyBranchScope(query, scope, column = "branch_id")`:

| Modo | Efecto en la consulta |
|---|---|
| `national` | sin filtro |
| `unassigned` | `.is(column, null)` |
| `branch` con ids | `.in(column, branchIds)` |
| `branch` **vacío** | `.eq(column, "00000000-…-000000000000")` — **devuelve cero filas** |

⚠️ El caso de scope vacío es **fail-closed por construcción**: filtra por un
UUID imposible en vez de omitir el filtro. No lo "optimices" quitando el
`.eq()`: eso convertiría a un usuario sin sucursales en un usuario nacional.
`EMPTY_BRANCH_SCOPE` es exactamente ese caso y es el *default* cuando un perfil
no trae scope.

`isBranchInScope(scope, null)` → `true` solo en modo `national`. **NULL es
nacional.**

### 3.4 Datos: todo pasa por `src/lib/services/`

57 servicios. Ningún componente consulta Supabase directamente. Tablas usadas
por el código (extraídas de las llamadas `.from(...)`):

```
applications · application_analysis · application_bank_accounts
application_business_profiles · application_collateral
application_declarations · application_employment · application_financial_profiles
application_follow_ups · application_guarantors · application_intakes
application_obligations · application_review_items
application_review_observations · application_reviews
automation_events · branches · clients · conversations · conversation_members
crm_events · dossier_alerts · dossier_documents · dossier_notes
email_attachments · email_messages · email_sync_state · loan_criteria
messages · message_translations · monthly_management_closures
products · profiles · profile_branch_memberships · profile_capability_grants
public_application_tokens · requirement_slots · requirement_templates
```

### 3.5 Solicitudes (`applications`)

Estados (`src/types/application.ts`):
`draft` · `new` · `in_review` · `approved` · `not_eligible` · `cancelled`

Grafo de transiciones — **fuente única**: `src/lib/config/application.ts`

```
draft        → []                                 (solo submit_application())
new          → in_review, cancelled
in_review    → approved, not_eligible, cancelled
approved     → []   not_eligible → []   cancelled → []     (terminales)
```

`APPLICATION_STATUS_ORDER` **excluye `draft`** a propósito: es lo que mantiene
los borradores fuera del tablero, de los filtros y del kanban por construcción.

Orígenes (`ApplicationSource`): `crm_manual` · `website_form` · `whatsapp` ·
`email` · `ai`.

Tres predicados que gobiernan el acceso del staff:

```ts
isFormalApplication(status)         // status !== "draft"
isManualDraft(app)                  // draft AND createdSource === "crm_manual"
isStaffManageableApplication(app)   // formal OR borrador manual
```

### 3.6 Productos

Catálogo oficial sembrado en
`20260820064114_milestone_26a1_official_loan_catalog.sql`, con
`application_code` de **una sola letra mayúscula**, único:

| `application_code` | display_order |
|---|---|
| `N` | 10 |
| `D` | 20 |
| `V` | 30 |
| `E` | 40 |

Nombres y descripciones son `LocalizedText` (`jsonb` con claves `es`/`en`).
Estados: `draft` / `active` / `inactive`.

### 3.7 Documentos y requisitos

Dos capas distintas, y confundirlas causa bugs:

- **`requirement_templates`** — el *catálogo* por producto: qué se pide.
- **`requirement_slots`** — la *instancia* por solicitud: qué se pidió a este
  expediente. Materializados por
  `src/lib/services/requirement-slot-materialization.ts`.

Un slot lleva mucho más que un estado: `stage` (application → compliance →
approval → signing → disbursement → servicing), `actor` (client / guarantor /
internal / generated / external_third_party), `conditionKey` (condicional:
`has_guarantor`, `collateral_is_vehicle`, …), `subjectType`
(application/guarantor/collateral), `applicantVisible`, `minFiles`,
`allowsMultipleFiles`.

Estados de slot: `pending` · `submitted` · `under_review` · `satisfied` ·
`rejected` · `waived` · `missing`.
`requirementKind`: `document`, `phone_verification`, `apc_check`, `visit`,
`internal_approval`, `ai_review`, `signature`, `manual_confirmation`.

**Almacenamiento**: bucket **privado** `dossier-documents`
(`20260808110100_…`). `dossier_documents.storage_bucket` es una **columna por
fila**, no una constante — no lo hardcodees. El único punto del código que
firma URLs es `src/lib/services/document-evidence.ts:629`, con TTL
(`VIEW_URL_TTL_SECONDS`).

### 3.8 Revisión, decisiones y aprobaciones

`src/lib/services/application-review.ts` — `ReviewStatus`: `not_started` /
`in_progress` / `completed`; ítems, observaciones, `ReviewAttention`,
`evaluateCompletion()` con `CompletionBlocker` tipado.

**Aprobar es una sola transacción.**
`20260829040000_milestone_26b23d_approve_with_amount.sql`: el cambio de estado a
`approved`, el `approved_amount` y **ambos eventos de auditoría** ocurren dentro
de una función, bajo un lock de fila. El monto es **obligatorio** por esa vía y
la función lo rechaza antes de tocar la fila.
No impone relación con `requested_amount`: aprobar más de lo pedido es negocio
legítimo, y la advertencia va delante de un humano, no en un CHECK.

### 3.9 Obligaciones

`application_obligations`, con `obligation_owner ∈ {applicant, business}`.
`saveObligations()` (`application-step2-write.ts`) reconcilia **solo el owner
que se le pasa** — reconciliar la tabla entera borraría las del otro owner.

### 3.10 Auditoría — `crm_events`

📖 **Fuente autoritativa:
[`AUDIT_TRAIL_ARCHITECTURE.md`](AUDIT_TRAIL_ARCHITECTURE.md)** — léela entera
antes de añadir cualquier evento.

Lo indispensable:

- `crm_events` tiene **RLS activo con cero políticas**, y a `service_role` se le
  concede **solo SELECT**. Ni el servidor de la aplicación puede insertar
  directamente.
- Por tanto **toda escritura auditada pasa por una RPC `SECURITY DEFINER`** con
  `set search_path = public, pg_temp`, revocada de `public`/`anon`/
  `authenticated` y concedida **únicamente a `service_role`**.
- Las RPC son **deliberadamente estrechas**: reciben valores concretos y
  construyen el evento ellas mismas. Una RPC genérica para escribir en
  `crm_events` sería un agujero para fabricar historial.
- Vocabularios cerrados por CHECK (`entity_type`, `source`, `actor_kind`), que
  han crecido **de forma aditiva** a lo largo de varios milestones.
- **Hechos ya probados por su propia fila inmutable NO se duplican** aquí:
  creación de cliente/solicitud, notas, alertas, evidencias, análisis, chat.
  Esas tablas *son* su propio registro.
- `automation_events` es **otra cosa**: telemetría del pipeline de intake,
  keyed en `intake_id`. No la mezcles.

### 3.11 PDFs

`src/lib/reporting/pdf/`:

- `layout.ts` — motor de maquetación sobre pdfkit. `PAGE` (A4, margen 48,
  `contentWidth` 499.28pt), `INK` (paleta), `reserve()`, `sectionTitle()`,
  `table()`, `statRow()`, `kpiGrid()`, `note()`, `calloutBox()`, `bullet()`.
  ⚠️ **`TableColumn.width` son PUNTOS, no fracciones.** Pasar `0.3` hacía que
  `column.width - 12` fuera negativo y pdfkit no terminaba nunca: consumió 4 GB
  y mató el servidor de Next. Hoy `table()` **lanza** si una anchura no es
  finita o es `< 24`. No quites esa guarda.
- `executive-report.ts` — informe ejecutivo de dirección.
- `application-dossier.ts` — expediente de solicitud (26B-27A). Su cabecera
  documenta **qué se excluye y por qué**; ver §4.9 y §5.

### 3.12 Exportaciones

- **Excel detallado** — `src/lib/reporting/excel/`, ruta
  `/api/exportacion-detallada`. 8 hojas, con PII, protegido por
  `reports:export_sensitive` y **auditado** vía RPC.
  `sanitize.ts` neutraliza inyección de fórmulas; la exención se define por lo
  que un valor *puede hacer*, no por su primer carácter, **porque los teléfonos
  reales de ODL empiezan por `+`**.
- **Informe ejecutivo PDF** — `/api/informe-ejecutivo`, capability
  `analytics:view`.
- **Expediente PDF** — `/api/solicitudes/[applicationId]/pdf`, ver §4.9.

### 3.13 Cierres mensuales de gestión (26B-26G)

- Tabla `monthly_management_closures`, `UNIQUE(period_key)`, 8 CHECKs, **dos
  triggers de inmutabilidad** (`BEFORE UPDATE` y `BEFORE DELETE`, errcode
  `0A000`). RLS con cero políticas; `service_role` solo SELECT.
- RPC `record_monthly_management_closure(...)` con
  `on conflict (period_key) do nothing`.
- La validación de "mes de Panamá" vive **en la RPC**, no en un CHECK, porque
  `AT TIME ZONE` es `STABLE` y Postgres no la admite en un CHECK.
- Cron en `vercel.json`: `0 6 1 * *` → `/api/cierres-mensuales`.
  Autenticación por `Authorization: Bearer ${CRON_SECRET}`; sin `CRON_SECRET`
  configurado el endpoint responde **401** (falla cerrado).
  ⚠️ Vercel Cron: expresiones **solo en UTC**, entrega *best-effort* (puede
  disparar dos veces, **nunca reintenta**) y **no sigue redirects** — de ahí la
  excepción en `route-access.ts`.
- `/api/cierres-mensuales/bootstrap` es **distinto**: requiere sesión humana con
  `analytics:view`.
- `src/lib/reporting/closures/validate.ts` prohíbe UUIDs en los snapshots
  **salvo** dos rutas expresamente permitidas:
  `snapshot.team.N.profileId` y `snapshot.products.N.productId`.
  **No lo conviertas en "todos los UUIDs son seguros"** y no permitas
  `*.productId` de forma global.

### 3.14 Otras piezas implementadas

Portal público multi-paso con credencial de continuación
(`public_application_tokens`, token **hasheado**), buzón operativo IMAP/SMTP
(`email_*`), chat interno con traducción (`messages`, `message_translations`,
DeepL opcional), seguimientos (`application_follow_ups`), alertas y notas de
expediente, embudo/atribución del portal (`portal-funnel`), criterios de
préstamo y análisis (`loan_criteria`, `application_analysis`),
administración de usuarios y sucursales.

📖 `CHAT_ARCHITECTURE.md` existe pero **está desactualizado**: describe el chat
como demo en memoria y sus tablas como "un plan, no migraciones", cuando
`20260808050441_create_chat_tables.sql` ya existe. Anotado en §9-B.

---

## 4. REGLAS DE NEGOCIO AUTORITATIVAS

Estas son las que un agente nuevo rompe **sin darse cuenta**.

### 4.1 Multisucursal y aislamiento

- Toda consulta de datos de negocio pasa por `applyBranchScope()`.
- **Fuera de alcance ⇒ `NOT_FOUND`, nunca `FORBIDDEN`.** Un 403 distinguible
  convertiría cualquier URL en una forma de confirmar que cierto expediente
  existe en una sucursal que quien pregunta no puede ver.
- Scope vacío ⇒ **cero filas** (ver §3.3). Nunca "todas".
- `branch_id NULL` = **nacional**: visible solo en modo `national`, o en el
  modo especial `unassigned`.
- Delegar `branch:manage` / `branch:transfer` **no** amplía el alcance de quien
  lo recibe: sigue actuando solo dentro de sus propias membresías.
- `BRANCH_DENIED_SQLSTATE = "42501"` — la base de datos también sabe negar.

**Fuente de verdad:** `src/lib/services/branch-scope-query.ts` +
`20260818051036_milestone_25a_branch_foundations.sql`.

### 4.2 Portal ≠ CRM

| | Solicitud del **portal** | Solicitud **interna** |
|---|---|---|
| `createdSource` | `website_form` | `crm_manual` |
| Nace como | `draft` | `draft` (borrador manual) o formal |
| ¿Visible al staff en `draft`? | **NO** | **SÍ** |
| Autenticación del autor | token de continuación público | sesión de staff |

`isStaffManageableApplication()` es lo que implementa esa asimetría, y es la
razón de que exista `isManualDraft()`. Un borrador del portal **no es un
expediente interno**: no se lista, no se abre y no se imprime.

### 4.3 Ciclo de vida y la invariante del número

**La invariante central de todo el ciclo de vida** (migración
`20260822015644_milestone_26b5_draft_lifecycle_and_deferred_numbering.sql`):

```
status = 'draft'   ⟺   application_number IS NULL
```

Escrita como **CHECK constraint**, no como convención. Consecuencias:

- Un borrador **no puede** adquirir número sin salir de `draft`.
- Una solicitud **no puede** salir de `draft` sin adquirir número —
  en la misma sentencia.
- **Nunca existen identificadores placeholder**: nada llamado `TEMP-`,
  `DRAFT-` ni `ODL-DRAFT`. Un borrador se identifica internamente por su UUID.
- La única puerta de salida de `draft` es `submit_application()`.
- `applications_status_initial_pair_check`:
  `status ∈ {draft, new} ⟺ status_changed_at IS NULL`.

**Por qué existe:** antes de 26B-5 el número se emitía en el paso 1, así que
cada viaje abandonado quemaba un número y aparecía en Solicitudes como si ODL
hubiera recibido formalmente una solicitud.

### 4.4 Reglas de acceso del staff — los dos ejes, caso por caso

| Superficie | Capability | Branch scope |
|---|---|---|
| Expediente en pantalla (`/solicitudes/[id]`) | **ninguna** | ✅ + `isStaffManageableApplication` |
| **Expediente en PDF** | **ninguna** | ✅ + `isStaffManageableApplication` |
| Informe ejecutivo PDF | `analytics:view` | según los datos |
| Excel detallado | `reports:export_sensitive` | según los datos |
| Bootstrap de cierre mensual | `analytics:view` | — |
| Cron de cierre mensual | **ninguna** (secreto de máquina) | — |

⚠️ Que el expediente **no** esté protegido por capability **es deliberado y
está aprobado** (26B-5, reafirmado en 26B-27A.1). Quién puede ver un expediente
depende de **si el caso pertenece a su sucursal**, no de una capacidad.
**No inventes una capability nueva para el expediente ni para su PDF**: crearía
dos reglas para la misma pregunta y alguien podría abrir la pantalla sin poder
imprimirla, o al revés.

### 4.5 Numeración oficial ODL

Formato: **`ODL-DDMMMYY-NNNN-X`** — p. ej. `ODL-20AGO26-0001-N`.

Generador: `public.generate_application_number(uuid)`
(`20260820064114_milestone_26a1_official_loan_catalog.sql`).

Reglas que **no** deben tocarse:

1. **Un único contador global**: `applications_official_number_seq`. Nunca se
   reinicia — ni diario, ni por producto, ni anual. Se consume con `nextval()`,
   **jamás con `count(*)` ni desde el cliente**.
   La secuencia antigua `applications_number_seq` (consumida hasta 25 en
   desarrollo) se deja en su sitio, retirada pero no eliminada.
2. **Meses en español por tabla de lookup**, no `to_char(..., 'MON')`: eso
   devolvería `AUG` y dependería de `lc_time`, un ajuste del servidor que no
   forma parte del esquema. Un identificador impreso en el contrato de un
   cliente no puede depender de una configuración regional.
3. **Fecha de Panamá, no UTC.** Una solicitud presentada a las 8 p.m. en Panamá
   es la 1 a.m. UTC del día siguiente: llevaría la fecha de mañana.
4. **Padding que no trunca.** `lpad('10000', 4, '0')` devuelve `'1000'` y
   colisionaría la solicitud diezmilésima con la milésima. Por eso el formato
   acepta **cuatro o más** dígitos.
5. La `X` final es `products.application_code`, una letra mayúscula única. Un
   producto **sin** `application_code` **no puede originar** solicitudes
   oficiales: la función lanza excepción en vez de inventar una letra.
6. `generate_application_number` es `SECURITY INVOKER` a propósito — no
   necesita privilegio elevado — con `search_path` fijado.

### 4.6 Reglas por producto

Los bloques del expediente son **condicionales según el producto y los datos**:
vehículo/propiedad solo si hay `application_collateral`; perfil de empresa solo
para el producto empresarial; garante solo si existe. Los `requirement_slots`
condicionales se materializan por `conditionKey`.

### 4.7 Documentos y requisitos

- Un slot `required = false` no bloquea; uno `required = true` sí.
- `originalRequiredLater` conserva la exigencia original cuando se difiere.
- Una evidencia de reemplazo es **una fila nueva** con `replaces_evidence_id` —
  nunca un UPDATE. La revisión de evidencia es *one-shot*, guardada por
  `ALREADY_REVIEWED`.
- `dossier_notes` **no tiene ruta de actualización en todo el código**. Es
  append-only por diseño.

### 4.8 Decisiones y formalización

- `approved` exige `approved_amount` — impuesto en la función, no en el
  formulario (26B-23D). Un formulario se puede saltar con una pestaña vieja.
- `approved`, `not_eligible` y `cancelled` son **terminales**. No hay reapertura
  y añadirla sería un cambio deliberado con sus propios méritos, no un default.
- `new` **nunca** es destino de una transición: es solo el estado inicial.
- La formalización de un borrador manual por parte del staff existe desde
  `2f0f759` / `fec3521`.

### 4.9 Expediente PDF (26B-27A) — lo que NO entra

Documentado en la cabecera de `src/lib/reporting/pdf/application-dossier.ts`:

- ❌ Contenido de documentos, rutas de almacenamiento, enlaces firmados, hashes.
  Solo la **lista de requisitos con su estado**.
- ❌ Notas internas: ni observaciones libres del cliente, ni notas por ítem de
  la revisión, ni el cuerpo de las observaciones del analista.
- ❌ Números de cuenta completos — solo los cuatro últimos dígitos.
- ✅ **Sí** entra la **nota de la recomendación**: no es un apunte privado sino
  la razón declarada de una recomendación formal, que es lo que un comité
  necesita leer.
- El nombre de archivo **no lleva** nombre, cédula, teléfono ni correo:
  `ODL-Solicitud-<número>.pdf` / `ODL-Application-<número>.pdf`
  (`dossier-filename.ts`, saneado a `[A-Za-z0-9._-]`).
- **No se persiste**: sin Storage, sin tabla de PDFs, sin enlaces firmados. Es
  una foto de hoy, y por eso lleva fecha y hora de generación en el pie de cada
  página.
- **No genera evento de auditoría** — decisión explícita y aprobada del usuario
  en 26B-27A.1. **No añadas `application_dossier_pdf_downloaded`.**

### 4.10 Tiempo de negocio

`src/lib/config/business-time.ts` — `BUSINESS_TIME_ZONE = "America/Panama"`,
resuelto con `Intl`. **Nunca** codifiques un offset de −5 a mano. En SQL,
`at time zone 'America/Panama'`.

Modelo de periodo del reporting: intervalo **semiabierto `[from, to)`**;
el calendario se resuelve en TypeScript y la agregación en SQL.

### 4.11 Semántica de "cero" en reporting

Dos reglas ganadas a base de correcciones (26B-26F.1 y .2), en
`src/lib/reporting/excel/summary.ts`:

- `approvedCount === 0` ⇒ **«Sin aprobaciones»**, jamás `B/. 0,00`.
- Tasa con denominador 0 ⇒ **«Sin decisiones»**, jamás celda vacía, `0%`, `NaN`
  ni `Infinity`.
- En hojas de detalle, `approved_amount` nulo ⇒ **celda vacía**. No conviertas
  `null` en `0`.
- El formato de porcentaje es `0.0"%"` con valores 0–100 — **no** el `0.0%`
  nativo, que mostraría 4000%.

### 4.12 ES/EN

`messages/es.json` y `messages/en.json` deben mantener **drift 0**
(hoy 2009/2009). Toda cadena visible es traducible. Comprobación rápida:

```bash
node -e 'const es=require("./messages/es.json"),en=require("./messages/en.json");const w=(o,p="")=>Object.entries(o).flatMap(([k,v])=>typeof v==="object"&&v!==null?w(v,p+k+"."):[p+k]);const a=w(es),b=w(en),sa=new Set(a),sb=new Set(b);console.log(a.length,b.length,a.filter(k=>!sb.has(k)),b.filter(k=>!sa.has(k)))'
```

---

## 5. INVARIANTES DE SEGURIDAD

Cada línea de aquí es una regla que ya está implementada. Romperla es una
regresión, no una decisión de diseño.

### Base de datos
- **RLS activo en todas las tablas, con cero políticas.** El acceso autoritativo
  es la capa de servicios del servidor, no una política. No añadas políticas ni
  desactives RLS sin un milestone que lo autorice explícitamente.
- `crm_events`: `service_role` tiene **solo SELECT**. Toda escritura auditada va
  por RPC `SECURITY DEFINER` estrecha, con `search_path` fijado, revocada de
  `public`/`anon`/`authenticated`.
- `monthly_management_closures`: inmutable por triggers. Un cierre **no se
  actualiza ni se borra**.
- Toda función `SECURITY DEFINER` lleva `set search_path = public, pg_temp`.
- El evento-trigger `rls_auto_enable()` está restringido (Milestone 16). No
  amplíes sus grants.

### Aplicación
- `SUPABASE_SECRET_KEY` solo en `src/lib/supabase/server.ts`, protegido por
  `import "server-only"`. **Nunca** detrás del prefijo `NEXT_PUBLIC_`.
- El proxy revalida con `getUser()`, no confía en la cookie.
- `/api/cierres-mensuales` **falla cerrado** sin `CRON_SECRET`.
- Aislamiento por sucursal en toda consulta; fuera de alcance ⇒ 404.
- Los grants delegados se filtran contra `DELEGATABLE_CAPABILITIES` **en tiempo
  de resolución**, así que un grant corrupto no concede nada.

### PII y documentos
- Bucket `dossier-documents` es **privado**. Un único punto firma URLs
  (`document-evidence.ts`), con TTL.
- **Nunca** incluyas en un PDF o un export: URLs firmadas, rutas de storage,
  JWT, UUIDs internos, nombres de archivo del bucket, hashes de documento,
  contenido de documentos.
- **Nunca** metas datos personales en el nombre de un archivo descargable.
- Cabeceras de un PDF con PII: `Cache-Control: private, no-store,
  must-revalidate`.
- Las notas internas **no salen** del CRM.
- Los números de cuenta bancaria viajan por contrato con **solo 4 dígitos**;
  el detalle completo tiene su propio servicio (`getBankAccountDetail`).
- El Excel sensible **se audita**; el expediente PDF **no** — y eso está
  decidido, no pendiente.

### Registros
- **Nunca** loguees contenido de expediente. El handler del PDF registra solo el
  identificador técnico y el mensaje del error, **no la traza**, porque una
  traza puede arrastrar justo lo que se estaba imprimiendo.
- **Nunca** loguees secretos, tokens ni cabeceras `Authorization`. Hay tests que
  lo comprueban (`src/lib/auth/route-access.test.ts`).
- No añadas eventos de auditoría "por si acaso": ver §3.10 sobre hechos ya
  probados por su propia fila.

### Production
- No crear, editar ni borrar datos de negocio durante una auditoría.
- No ejecutar migraciones destructivas. `supabase/cutover/` está **revisado y NO
  aplicado**, y vive fuera de `migrations/` justamente para que
  `supabase db push` no pueda ejecutarlo por accidente. **No lo muevas.**
- `supabase/dev-seeds/` **jamás** contra Production.

---

## 6. BASE DE DATOS

### Proyecto Supabase

Ref: **`eazqlwdfkillcwjpdkhg`** — proyecto `odl-finance-crm`.
Documentado desde antes en [`AUDIT_TRAIL_ARCHITECTURE.md`](AUDIT_TRAIL_ARCHITECTURE.md),
por lo que aparecer aquí no expone nada nuevo. **No es un secreto** — un ref de
proyecto no concede acceso; las claves sí, y ninguna clave está en el repo.

⚠️ **Existe otro proyecto Supabase en la misma cuenta que no pertenece a ODL.**
Confirma el ref antes de **cada** operación. Si el MCP o el CLI no te lo
confirman, detente.

### Migraciones

- **85 ficheros** en `supabase/migrations/`, `YYYYMMDDHHMMSS_<slug>.sql`.
- **Son la fuente de verdad del esquema.** No existe un `schema.sql` generado ni
  tipos autogenerados versionados.
- Convención observada en todo el directorio: cada migración empieza con un
  bloque de comentario que explica **por qué**, qué **no** hace, la
  reversibilidad conceptual y la idempotencia. Sigue esa convención — es el
  activo documental más valioso del repositorio.
- Muchas son **aditivas sobre vocabularios cerrados** (`crm_events`
  `entity_type` se amplió en al menos cinco migraciones distintas). Amplía,
  no bifurques.
- ⚠️ **Hay drift conocido entre las migraciones del repo y la base de datos
  aplicada** (ver §9-B). Antes de cualquier cambio de esquema, **compara lo
  aplicado con el directorio** — no asumas que coinciden.

### Tablas críticas

| Tabla | Por qué es crítica |
|---|---|
| `applications` | invariante draft⟺número; grafo de estados; `approved_amount` |
| `clients` | PII del titular |
| `profiles` + `profile_branch_memberships` + `profile_capability_grants` | identidad, alcance y permisos |
| `branches` | el eje de aislamiento |
| `crm_events` | historia durable; solo escribible por RPC |
| `monthly_management_closures` | inmutable por trigger |
| `requirement_slots` / `requirement_templates` | catálogo vs instancia |
| `dossier_documents` | apunta a objetos del bucket privado |
| `public_application_tokens` | credencial *bearer* del portal, **hasheada** |

### Funciones / RPC relevantes

| Función | Nota |
|---|---|
| `generate_application_number(uuid)` | `SECURITY INVOKER`, Panamá, meses ES |
| `odl_spanish_month_abbrev(int)` | `IMMUTABLE`, lookup explícito |
| `submit_application(...)` | única salida de `draft`; asigna número |
| `record_application_status_change(...)` | guard `status = expected` |
| aprobación con monto (26B-23D) | estado + monto + 2 eventos, una transacción |
| `record_client_profile_update(...)` y demás del audit trail | ver `AUDIT_TRAIL_ARCHITECTURE.md` |
| `record_email_sent_event(...)` | 26B-9B |
| `record_monthly_management_closure(...)` | `on conflict do nothing` |
| RPC de auditoría de export sensible | 26B-26F |
| `find_or_create_direct_conversation(...)` | chat |
| `rls_auto_enable()` | event trigger, grants restringidos |

### Secuencias

| Secuencia | Estado |
|---|---|
| `applications_official_number_seq` | **la activa**; global, nunca se reinicia |
| `applications_number_seq` | retirada; se deja en su sitio (owned by column) |

### Grants — el patrón

`revoke all from public / anon / authenticated` → `grant` mínimo a
`service_role`. Repetido en cada migración. Cópialo.

---

## 7. ESTADO DE PRODUCTION — CIERRE 26B-27A.P

**MILESTONE 26B-27A.P — PRODUCTION VERIFICATION → VERDICT: CLOSED**
(verificado el 2026-09-01 contra Production real, no en local)

| Comprobación | Resultado |
|---|---|
| SHA en Production | `b602bf4…` = HEAD = origin |
| Deployment | `6210936509`, success, `2026-09-01T21:42:43Z` |
| Ruta PDF sin sesión | **307 → `/login`** (no entrega PDF) |
| Modelo de autorización | branch scope + `isStaffManageableApplication`; **sin capability**, aprobado |
| Descarga | 200 · `application/pdf` · `Content-Length` correcto · `attachment` · `private, no-store, must-revalidate` |
| PDF | `%PDF-1.3`, 2 páginas, `%%EOF`, abre sin avisos |
| Nombre de archivo | seguro, sin PII |
| Barrido de contenido (bytes crudos + streams inflados) | 0 URLs · 0 rutas de storage · 0 JWT · 0 UUID · 0 nombres de archivo · 0 api-key/bearer |
| Contenido de documentos / notas privadas | **ausentes** |
| Semántica de monto | «Sin monto aprobado», nunca un cero |
| Layout | sin solapamientos, sin encabezados partidos, sin páginas vacías |
| ES / EN | ambos verificados visualmente en Production |
| PDF persistido | **NO** |
| Evento de auditoría creado | **NO** (por diseño aprobado) |
| Datos de negocio modificados | **NO** — conteos y secuencias idénticos antes/después |
| Regresiones | dashboard, informe ejecutivo, semántica de ceros: **PASS** |
| **Borrador manual** | **NOT TESTED** — no existe ninguno en Production y crear datos estaba prohibido. Cubierto por tests unitarios. |

**27A está cerrado. No lo re-implementes.** Si algo del expediente PDF necesita
cambiar, es un milestone nuevo, no una corrección de 27A.

---

## 8. REGLAS DE TRABAJO PARA EL PRÓXIMO AGENTE

### Antes de cualquier cambio
1. Leer **este documento entero**.
2. Leer [`CLAUDE.md`](CLAUDE.md) → [`AGENTS.md`](AGENTS.md) (Next.js 16: lee
   `node_modules/next/dist/docs/` antes de escribir código de framework).
3. Leer [`AUDIT_TRAIL_ARCHITECTURE.md`](AUDIT_TRAIL_ARCHITECTURE.md) si vas a
   tocar auditoría.
4. Completar **§10 PHASE 0** y **esperar revisión del usuario**.

### Verificaciones obligatorias en cada sesión
- Repositorio correcto (`makomgrp/makom-finance-platform`).
- Branch (`feature/client-engine`, **no `main`**).
- `git rev-parse HEAD` y `git rev-parse origin/feature/client-engine`.
- SHA desplegado en Production.
- `git status` limpio antes de empezar.
- Proyecto Supabase = `eazqlwdfkillcwjpdkhg`.

### Durante el trabajo
- **Auditoría read-only primero**, siempre. Lee antes de escribir.
- **Nunca asumas el esquema.** Inspecciona `supabase/migrations/` y compáralo
  con lo aplicado.
- **Nunca ejecutes migraciones destructivas.**
- **Nunca elimines RLS** ni añadas políticas sin autorización.
- **Nunca relajes seguridad para que pase un test.**
- **Nunca expongas PII**, URLs firmadas ni rutas de storage en PDFs o exports.
- **Preserva la paridad ES/EN** — drift 0.
- **No crees datos en Production para probar** sin autorización explícita.
- **No modifiques Production durante una auditoría.**
- `npm test` debe seguir en verde (**307/307** a día de hoy).
- **Detente ante cualquier discrepancia** entre handoff, código, DB y
  Production, y repórtala en lugar de resolverla por tu cuenta.

### Git
- **Nunca** `git add .` / `-A` / `--all`. Pathspecs explícitos.
- Un commit por milestone, y **un solo intento de push**. Si fallan las
  credenciales: **detente**. No reintentes, no uses `gh`, no fuerces, no cambies
  el remote.
- No reescribas historia ya empujada.

### Secretos
- Nunca pidas, imprimas, registres ni commitees credenciales.
- `.mcp.json` está en `.gitignore` **porque contiene una credencial**. No lo
  leas para citarlo, no lo copies y no lo saques del ignore.
- Si necesitas generar un secreto (p. ej. `CRON_SECRET`), genéralo y consúmelo
  **dentro de un mismo pipeline de shell**, de modo que el valor nunca entre en
  el contexto, la salida ni git.

---

## 9. PENDIENTES Y BACKLOG

### A. Siguiente milestone autorizado conceptualmente

**26B-27B — NEXT.**

Estado real, sin adornos: **el usuario lo ha nombrado como el siguiente, y nada
más.** No hay especificación, no hay diseño y **no está autorizado a
implementarse**. Durante la preparación de este handoff se prohibió
explícitamente iniciarlo.

⛔ **No implementes 27B hasta que el usuario entregue su especificación.**
En particular, y por instrucción expresa, **no** implementes por iniciativa
propia: ZIP de expedientes, combinación de documentos, ni snapshots.

⛔ **No infieras el alcance de 27B.** Ni a partir de las ideas listadas en §9-C,
ni del backlog de §9-B, ni de lo que 27A dejó deliberadamente fuera de su
alcance, ni de lo que parezca el siguiente paso lógico del expediente PDF.
27B **no tiene contenido conocido**: lo que sea, lo dirá el usuario. Un
alcance deducido es un alcance inventado.

⛔ **Que algo aparezca mencionado en este documento no lo autoriza.** ZIP de
expedientes, combinación de documentos y snapshots figuran aquí **precisamente
porque están prohibidos**, no porque estén en cola. Lo mismo vale para todo
§9-B y §9-C: se escriben para que no se redescubran, no para que se
implementen. La autorización llega del usuario, en su propio mensaje, y de
ningún otro sitio.

### B. Backlog conocido (identificado, no programado)

| # | Asunto | Detalle |
|---|---|---|
| B1 | **`main` vs `feature/client-engine`** | `origin/main` está 88 commits por detrás. Production despliega desde la rama de feature. Hay que decidir cómo se reconcilian. |
| B2 | **Drift de migraciones** | Diferencias conocidas entre `supabase/migrations/` y el esquema aplicado. Requiere una reconciliación deliberada. |
| B3 | **`CHAT_ARCHITECTURE.md` desactualizado** | Describe el chat como demo en memoria y sus tablas como un plan; las migraciones ya existen. |
| B4 | **`README.md` es el boilerplate de `create-next-app`** | No dice nada del proyecto. |
| B5 | **Marca CONFIDENCIAL en el Excel** | El export sensible no lleva marca de confidencialidad en el propio archivo. |
| B6 | **Asimetría Equipo/Adquisición con cero aprobados** | Las dos hojas no tratan igual el caso de cero aprobaciones. |
| B7 | **Overflow del app-shell** | ~50px a 768px y ~15px a 390px. |
| B8 | **Modelo de desembolso** | No implementado. Las etapas `disbursement` / `servicing` existen en `RequirementStage` sin flujo detrás. |
| B9 | **Analítica de WhatsApp / compliance** | No implementada. |
| B10 | **Borrador manual del expediente PDF** | Sin probar en Production (no existe ninguno). |

**Procedencia de cada punto** — importa, porque no todos tienen el mismo peso
probatorio:

- **Verificados contra el repositorio el 2026-09-07**: B1 (`git rev-list`), B3
  (contraste entre `CHAT_ARCHITECTURE.md` y
  `20260808050441_create_chat_tables.sql`), B4 (contenido de `README.md`), B8
  (`RequirementStage` sin servicio detrás).
- **Heredados de sesiones anteriores y NO re-verificados hoy**: B2, B5, B6, B7,
  B9, B10. Se conservan porque perderlos costaría redescubrirlos, pero
  **confírmalos antes de actuar sobre ellos**. B2 en particular solo puede
  comprobarse con acceso de lectura a la base de datos — está en §10.6.

> Ninguno de estos está autorizado. Están aquí para que **no se descubran otra
> vez desde cero**, no para que se arreglen sin permiso.

### C. Ideas NO aprobadas

- ZIP de expedientes, combinación de documentos, snapshots de expediente.
- Reapertura de solicitudes en estado terminal.
- Cualquier capability nueva para el expediente o su PDF.
- Evento de auditoría para la descarga del expediente PDF
  (**decidido que NO**, 26B-27A.1).
- Políticas RLS por fila (el modelo actual es RLS sin políticas + capa de
  servicios).

---

## 10. PHASE 0 — VERIFICACIÓN DESDE LA CUENTA NUEVA (READ-ONLY)

> **La primera sesión de la cuenta nueva no escribe nada.** Ejecuta esto,
> entrega el reporte al usuario y **espera autorización** antes de continuar.

### 10.1 Identidad del repositorio

```bash
git remote -v
git rev-parse --show-toplevel
git log --oneline -1
```
Esperado: `github.com/makomgrp/makom-finance-platform`.

### 10.2 Estado de git

```bash
git status --short --untracked-files=all
git branch -a
git rev-parse HEAD
git rev-parse origin/feature/client-engine
git rev-parse origin/main
git rev-list --left-right --count origin/main...HEAD
```
Esperado en el punto de corte: rama `feature/client-engine`,
HEAD = `b602bf4f73eeacf6aa4ca6fd086a206d62409a9b`, árbol limpio,
`origin/main` = `a144037…` y 88 commits de diferencia.

### 10.3 Fetch sin modificar nada

```bash
git fetch --all --prune --dry-run
```
Luego, si procede, `git fetch --all --prune` — **`fetch` nunca modifica el árbol
de trabajo. No hagas `pull`, `merge` ni `rebase`.**

### 10.4 Salud local

```bash
npm test
```
Esperado: **307/307 pass**.

```bash
node -e 'const es=require("./messages/es.json"),en=require("./messages/en.json");const w=(o,p="")=>Object.entries(o).flatMap(([k,v])=>typeof v==="object"&&v!==null?w(v,p+k+"."):[p+k]);const a=w(es),b=w(en),sa=new Set(a),sb=new Set(b);console.log("es",a.length,"en",b.length,"drift",a.filter(k=>!sb.has(k)).length+b.filter(k=>!sa.has(k)).length)'
```
Esperado: `es 2009 en 2009 drift 0`.

### 10.5 Production responde

Verificar, **sin sesión**, que la ruta del expediente PDF **no** entrega
documento:
```
GET https://makom-finance-platform.vercel.app/api/solicitudes/<uuid-cualquiera>/pdf
```
Esperado: **307 → `/login`**. Si devuelve 200 con un PDF, **detente
inmediatamente y repórtalo como incidente de seguridad**.

Confirmar el deployment actual y su SHA (Vercel CLI o panel). Contrastar con §2.

### 10.6 Supabase — solo lectura

- Confirmar que el MCP/CLI apunta a **`eazqlwdfkillcwjpdkhg`**.
- Listar migraciones aplicadas y **compararlas con `supabase/migrations/`**
  (85 ficheros). Anotar cualquier drift; **no lo corrijas**.
- Comprobar invariantes críticas, todo con `SELECT`:
  - `applications`: no existe fila con `status = 'draft'` y
    `application_number IS NOT NULL`, ni al revés.
  - `applications`: no existe fila con `status = 'approved'` y
    `approved_amount IS NULL`.
  - `crm_events`: RLS activo, cero políticas, `service_role` solo con SELECT.
  - `monthly_management_closures`: existe, con sus triggers de inmutabilidad.
  - `applications_official_number_seq` existe y `last_value` es coherente.
  - `products`: los `application_code` son únicos y de una letra.
- Registrar los conteos base (clientes, solicitudes, intakes, documentos, slots,
  perfiles, `crm_events`, cierres) para poder demostrar después que una
  auditoría no modificó nada.

### 10.7 Prohibiciones de PHASE 0

- ❌ Ninguna escritura en base de datos.
- ❌ Ningún commit.
- ❌ Ningún push.
- ❌ Ningún deploy.
- ❌ Ninguna migración.
- ❌ Ningún dato de prueba creado en Production.

### 10.8 Entregable

Un reporte con: repo · branch · HEAD · origin · working tree · resultado de
tests · paridad i18n · SHA y estado del deployment · ref de Supabase ·
migraciones aplicadas vs repo · invariantes comprobadas · conteos base ·
discrepancias encontradas.

**Después: DETENTE y espera la revisión del usuario.**

---

## 11. HISTORIAL Y REGISTRO DE DECISIONES

### Dónde vive hoy

El repositorio **sí** conserva sus decisiones arquitectónicas, pero no en un
ADR: viven en **cabeceras de comentario extensas** dentro de las migraciones y
de los módulos, escritas con el patrón *qué se hizo · por qué · qué se descartó
y por qué · qué NO hace · reversibilidad · idempotencia*.

Ejemplos representativos, y muy vale la pena leerlos antes de tocar su área:

| Fuente | Decisión que documenta |
|---|---|
| `20260822015644_…_26b5_draft_lifecycle…` | por qué el número se emite al enviar, no antes |
| `20260820064114_…_26a1_official_loan_catalog` | formato del número, meses ES, hora de Panamá, padding |
| `20260829040000_…_26b23d_approve_with_amount` | por qué aprobar es una sola transacción |
| `20260817062939_…_16_security_floor` | qué NO hace una migración de seguridad |
| `20260901010000_…_26b26g_monthly_…_closures` | inmutabilidad, y por qué la validación va en la RPC |
| `AUDIT_TRAIL_ARCHITECTURE.md` | el modelo de auditoría completo |
| `supabase/cutover/README.md` | por qué un DELETE destructivo vive fuera de `migrations/` |
| `src/lib/reporting/pdf/layout.ts` | por qué `table()` valida anchuras |
| `src/lib/auth/route-access.ts` | por qué la ruta de máquina es exacta y no prefijo |

**Esa es la fuente de verdad, y este handoff no la duplica.**

### Estructura mínima propuesta (NO creada — requiere aprobación)

Falta un **índice** que permita responder «¿dónde se decidió X?» sin leer 85
migraciones. Propuesta deliberadamente pequeña:

```
DECISION_LOG.md      # una tabla, append-only, en la raíz
```

Con exactamente cinco columnas y **una línea por decisión**:

| Milestone | Fecha | Decisión (una frase) | Fuente de verdad (ruta) | Estado |
|---|---|---|---|---|
| 26B-5 | 2026-08-22 | El número oficial se emite al enviar, no al empezar | `supabase/migrations/20260822015644_…` | vigente |

Reglas: **append-only**; nunca se edita una línea, se añade otra que la
supersede marcando la anterior como `superseded by <milestone>`; la columna
«Decisión» es **una frase**, y todo el razonamiento se queda donde ya está.

**No lo he creado.** Crear un índice vacío es churn; crearlo retroactivamente
con 117 commits es un milestone en sí mismo. Queda como propuesta.

---

## 12. SECRET HYGIENE — DECLARACIÓN

Este documento fue inspeccionado antes de entregarse. **No contiene:**

- ❌ contraseñas · ❌ access tokens · ❌ refresh tokens · ❌ tokens de GitHub
- ❌ claves service-role de Supabase · ❌ claves publishable/anon (ningún valor)
- ❌ JWT · ❌ cookies · ❌ session IDs · ❌ API keys
- ❌ contenido de `.env.local` ni de ningún `.env`
- ❌ contenido de `.mcp.json` (fichero deliberadamente ignorado por git)
- ❌ `CRON_SECRET` ni ningún otro secreto de máquina
- ❌ datos personales de clientes: ningún nombre, cédula, teléfono, correo,
  dirección, patrono ni monto de un expediente real
- ❌ UUIDs de expedientes, clientes o perfiles reales

**Sí contiene**, deliberadamente y con justificación:

- **Nombres** de variables de entorno — ya publicados en `.env.example`, que es
  el único fichero de entorno versionado a propósito y no lleva ningún valor.
- El **ref del proyecto Supabase** `eazqlwdfkillcwjpdkhg` — ya versionado en
  `AUDIT_TRAIL_ARCHITECTURE.md` desde el milestone 20. Un ref de proyecto no
  concede acceso por sí solo.
- La **URL pública de Production** y el ID del deployment.
- SHAs de git.

---

*Fin del handoff. El siguiente paso es §10 — PHASE 0, y nada más.*
