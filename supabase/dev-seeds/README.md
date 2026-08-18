# DEVELOPMENT SEED DATA — DO NOT RUN IN PRODUCTION

**Every file in this directory inserts fabricated data. None of it is real ODL
business data. Running any of these against a production database corrupts it
with fictitious clients, loan products and staff records.**

Moved here from `supabase/` by Milestone 23 (Production Cutover Preparation) so
that "development-only" is a property of the location, not a convention someone
has to remember.

---

## Why this directory is safe

The Supabase CLI auto-runs exactly one seed file: `supabase/seed.sql`.

- That file has never existed in this repository.
- These files were named `seed_*_dev.sql`, which the CLI does **not** pick up.
- They are now one directory further away and named in a directory that says so.

**Nothing here has ever run automatically, and nothing here can.** Every one of
these files has only ever been executed by a human pasting it deliberately.

Moving them broke nothing executable: the only references to these paths
anywhere in the repository are **comments** inside migrations, plus two
`raise exception` *message strings* that name a file as guidance to a developer.
No migration reads, includes or executes a file from this directory.

---

## What is in here

| File | Inserts |
|---|---|
| `seed_profiles.sql` | 7 demo staff personas (`legacy_id` `u-001`…`u-007`, `@odlfinancial.com`) |
| `seed_qa_test_profile.sql` | 1 intentionally-inactive QA account |
| `seed_products_dev.sql` | 6 example loan products — its own header says *"MUST be deleted before production delivery"* |
| `seed_requirement_templates_dev.sql` | 8 requirement templates for two of those products |
| `seed_requirement_slots_dev.sql` | Requirement slots for the fixture application |
| `seed_applications_dev.sql` | Fixture application `ap-001` |
| `seed_dossier_notes_dev.sql` | 3 notes |
| `seed_dossier_alerts_dev.sql` | 4 alerts |
| `seed_dossier_documents_dev.sql` | Fixture evidence rows |
| `seed_dossier_documents_backfill_dev.sql` | Backfill for the above |
| `seed_chat_dev.sql` | 8 conversations / 30 messages / 23 translations |

The 17 fixture **clients** are *not* seeded from this directory — they are
inserted by migration `20260810210000_create_clients_table.sql`. See
`supabase/cutover/README.md`.

---

## Before production delivery

These fixtures must be removed from the live database. The reviewed removal
procedure is **not** in this directory and is **not** applied — see:

    supabase/cutover/

Do not attempt cleanup by hand. Do not re-run any file here against a database
that contains real ODL records.
