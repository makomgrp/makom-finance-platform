-- ============================================================================
-- MILESTONE 26A-1A — LEAST-PRIVILEGE GRANTS ON THE NUMBER GENERATOR
-- ============================================================================
--
-- A corrective follow-up to 20260820064114, which created three functions and
-- left them with PostgreSQL's default grant of EXECUTE to PUBLIC. Every other
-- function this schema has added since Milestone 25A explicitly revokes that
-- and grants service_role only (see profile_has_operational_branch_scope,
-- staff_target_within_actor_branch_scope, transfer_client_branch,
-- transfer_application_branch). These three should match.
--
-- A SEPARATE MIGRATION, NOT AN EDIT. 20260820064114 is already applied; this
-- schema's standing discipline is that an applied migration is never rewritten,
-- only corrected forward.
--
-- WAS THE DEFAULT EXPLOITABLE? No — and the reason is worth recording, because
-- it is why SECURITY INVOKER was the right choice for these functions:
--
--   * generate_application_number() is SECURITY INVOKER, so nextval() runs with
--     the CALLER's rights. anon and authenticated hold no USAGE on
--     applications_official_number_seq, so the call fails for them. Had the
--     function been SECURITY DEFINER, PUBLIC EXECUTE would have let anyone burn
--     sequence values and punch permanent gaps in ODL's application numbering.
--   * they also hold no INSERT on applications, and RLS on products carries no
--     policy, so neither the read nor the write behind it is reachable.
--   * set_application_number() is a trigger function and cannot be invoked
--     directly at all; odl_spanish_month_abbrev() returns a three-letter
--     constant.
--
-- So this changes no behaviour. It removes a privilege nobody could use, so
-- that the posture of these functions matches the rest of the schema and does
-- not have to be re-reasoned about later.
--
-- REVOKING FROM A TRIGGER FUNCTION IS SAFE: PostgreSQL checks EXECUTE on a
-- trigger function when the TRIGGER IS CREATED, not each time it fires. The
-- existing applications_set_application_number trigger keeps working, which the
-- milestone's verification re-confirms after this runs.

revoke all on function public.odl_spanish_month_abbrev(integer) from public;
revoke all on function public.generate_application_number(uuid) from public;
revoke all on function public.set_application_number() from public;

grant execute on function public.odl_spanish_month_abbrev(integer) to service_role;
grant execute on function public.generate_application_number(uuid) to service_role;
grant execute on function public.set_application_number() to service_role;
