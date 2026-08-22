-- ============================================================================
-- MILESTONE 26B-8 — WHY WAS THIS ALERT CLEARED?
-- ============================================================================
--
-- `dossier_alerts` recorded WHO resolved an alert and WHEN, but never WHY. For
-- a control whose whole purpose is to flag fraud concerns and internal
-- restrictions, "Marisol closed it on Tuesday" is not an answer anyone can
-- audit — the reason for clearing a risk flag is the part that matters.
--
-- ----------------------------------------------------------------------------
-- NULLABLE, AND DELIBERATELY NOT CONSTRAINED TO THE RESOLVED STATE
-- ----------------------------------------------------------------------------
-- Two reasons, both about history rather than convenience.
--
-- One: a resolved alert already exists in this database from the development
-- seed, and it has no note. Back-filling one would be inventing a reason a
-- human never gave.
--
-- Two, and more important: an alert can be REACTIVATED, and the existing RPC
-- clears resolved_at / resolved_by when that happens. The note is deliberately
-- NOT cleared with them. It stays as the record of why the alert was last
-- stood down, which is exactly the context somebody reopening it needs. A
-- CHECK requiring `active = false` would forbid that, and would trade a real
-- piece of history for a tidier invariant.
--
-- Requiring a note is enforced where the decision is actually made — the
-- Server Action and the RPC both reject a blank one on resolve — rather than
-- by a column constraint that would also have to be true of rows nobody is
-- resolving.
-- ============================================================================

alter table public.dossier_alerts
  add column if not exists resolution_note text;

comment on column public.dossier_alerts.resolution_note is
  'Why the alert was last stood down. Set when resolving; intentionally retained through reactivation as historical context.';
