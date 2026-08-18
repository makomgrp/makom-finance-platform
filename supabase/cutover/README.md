# PRODUCTION CUTOVER — REVIEWED, NOT APPLIED

This directory holds the **destructive** fixture-removal procedure for the
production cutover. Nothing here has been executed.

---

## Why this is NOT in `supabase/migrations/`

Deliberate, and the single most important thing in this file.

Any `.sql` in `supabase/migrations/` is applied automatically by the next
`supabase db push`. Putting an unreviewed, irreversible `DELETE` of every
client row into the auto-applied directory would create exactly the class of
hazard Milestone 23 exists to remove — the same shape as the fixture `INSERT`
hidden inside `20260810210000_create_clients_table.sql`.

So the draft lives here, where it is **safe to read and impossible to run by
accident**.

**At cutover time**, after review and after the prerequisites below are met,
move `milestone_23_production_fixture_cleanup.sql` into `supabase/migrations/`
with a fresh timestamp prefix, then apply it once. Do not apply it from here.

---

## Prerequisites — ALL must be true before this runs

1. Real ODL staff accounts exist, are Auth-linked, and at least one **real
   administrador** has signed in successfully.
2. Real ODL loan products and requirement templates are configured.
3. The two `@odl.local` development Auth accounts are no longer the only way
   in.
4. Someone has re-read the script against the live data and confirmed the
   guard passes for the right reason.

If ODL has already entered real clients when this runs, **the guard aborts the
whole transaction.** That is intended.

---

## The historical migration hazard

`supabase/migrations/20260810210000_create_clients_table.sql` creates the
`clients` table **and inserts 17 fixture clients** in the same file.

That migration is applied history. It is **not edited, not rewritten, and not
re-run** — the repository does not rewrite applied migrations to make them
tidier, and doing so here would make the file disagree with what the database
actually received.

The consequence is concrete and must be understood by anyone rebuilding an
environment:

> **Replaying this repository's migrations from zero produces a database
> containing 17 fabricated clients.** That is true of any fresh Supabase
> project bootstrapped from these files.

The cleanup script in this directory **is the canonical corrective step**. A
rebuilt environment is not considered correctly provisioned until it has been
applied. It is written to be idempotent and safe to run against a database
that has already been cleaned (every delete is predicate-scoped; a second run
removes nothing and reports zero).

---

## What the script does NOT do

| Not done | Why |
|---|---|
| Delete products / requirement templates | Fixture identity cannot be proven in SQL. `personal_loan`, `mortgage` etc. are plausible codes ODL may genuinely reuse, and deleting a product ODL has since configured would be unrecoverable. Handled as a reviewed manual step — see below. |
| Delete or deactivate profiles | Out of scope by authorization, and they are FK targets for retained audit facts. `messages.sender_profile_id` is `ON DELETE RESTRICT`. |
| Touch `auth.users` | Auth is managed through the Supabase Auth API, never SQL. |
| Delete `crm_events` rows | Append-only by design. See the note below on what does happen to them. |
| Delete Storage objects | SQL cannot remove Supabase Storage objects. See below. |
| Reset `applications_number_seq` | A business decision, not a technical one. See below. |

### What happens to `crm_events`

Nothing is deleted from it. But `crm_events.client_id`, `.application_id` and
`.actor_profile_id` are all `ON DELETE SET NULL`, so events that referenced a
deleted fixture client or application **survive with those references
nulled**. Since `crm_events` is currently empty and every event it could hold
before cutover would be *about a fixture*, this is harmless. It is documented
because it is the one place where a delete elsewhere silently changes a row in
the audit table.

### Products and requirement templates — manual step

After the script runs, an administrador should, through the CRM's own admin
UI:

1. Configure ODL's real products.
2. Configure the real requirement templates per product.
3. Deactivate (not delete) any fixture product still present.

Note that requirement templates cannot be deleted while requirement slots
reference them — but the script removes all fixture slots first, so the path is
clear if deletion is later chosen.

### Storage objects — out-of-band operation

`DELETE FROM storage.objects` does not free the underlying file and is not the
supported removal path. Storage cleanup is a **separate cutover operation**
performed through the Supabase Storage API/dashboard, after the SQL cleanup.

Inventory at the time of writing — bucket `dossier-documents`, 8 objects,
**4 of them already orphaned** (no `dossier_documents` row):

| Object | Orphan |
|---|---|
| `cl-001/ap-001/cedula_pasaporte/20260808T190000Z-f11e0001-….pdf` | **yes** |
| `cl-001/ap-001/carta_trabajo/20260808T190000Z-f11e0002-….pdf` | no |
| `cl-001/ap-001/ficha_css/20260808T190000Z-f11e0003-….pdf` | no |
| `cl-001/ap-001/comprobante_pago/20260808T190000Z-f11e0004-….pdf` | **yes** |
| `cl-001/ap-001/cedula_pasaporte/20260809T033536Z-4a3b8fe4-….pdf` | no |
| `cl-001/ap-001/comprobante_pago/20260809T040518Z-ad0dd2c0-….pdf` | no |
| `applications/ea7cba21-…/requirements/5ba8bd8b-…/2026-08-09T23-07-22-747Z-….pdf` | **yes** (references an application id that no longer exists) |
| `cl-001/ap-001/recibo_servicios/.emptyFolderPlaceholder` | **yes** (0 bytes, UI placeholder) |

Every one of these is fixture or test material. After the SQL cleanup the
remaining four also become orphaned, so **all 8 objects are removable** — the
whole `cl-001/` prefix, the stray `applications/ea7cba21-…/` prefix, and the
placeholder.

### Application number sequence — DECISION REQUIRED

`applications_number_seq` is currently at **18** while only 2 application rows
exist; 16 numbers were consumed by discarded test inserts.

After the fixture purge the table is empty, so **resetting to 1 is
technically safe** — no collision is possible, because `application_number` is
generated from this sequence and no row will remain to clash with.

This is left as an explicit choice, not made silently:

- **Start ODL at `ODL-2026-000001`** — cleanest for a business that has filed
  no real applications. Recommended.
- **Continue at `ODL-2026-000019`** — leaves a visible numbering gap that
  correctly implies "records existed before", which is *false* for ODL.

The `alter sequence` statement is present in the script but **commented out**.
Uncomment the chosen line at cutover.
