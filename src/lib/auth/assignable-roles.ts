import type { UserRole } from "@/types";
import { USER_ROLE_VALUES } from "@/lib/config/user-role";

/**
 * ============================================================================
 * WHICH ROLES MAY THIS CALLER HAND OUT (Milestone 25C-3)
 * ============================================================================
 *
 * THIS IS NOT A SECOND AUTHORIZATION MATRIX, and it must never grow into one.
 *
 * It mirrors exactly ONE existing database rule — rule A2, enforced inside
 * create_staff_profile() and update_staff_role():
 *
 *     only an administrador may create or assign the administrador role
 *
 * Every other role is assignable by anyone already holding `user:invite` /
 * `user:set_role`, which is the capability check that runs first and stays the
 * real gate. So this file encodes one boolean, not a matrix, and deliberately
 * knows nothing about capabilities, branches or memberships.
 *
 * WHY MIRROR IT AT ALL. Before this, the invite dialog offered "Administrador"
 * to every caller who could invite, and a gerente choosing it got a 42501 from
 * the database after filling in the whole form. Offering an option that always
 * fails is a worse experience than not offering it, and it teaches people that
 * errors are normal. Hiding it is a courtesy; the server still refuses.
 *
 * THE SERVER REMAINS CANONICAL. create_staff_profile and update_staff_role
 * re-check A2 on every call regardless of what this returned, so a crafted
 * request gains nothing. If the two ever disagree, the database wins and the
 * user sees the server's refusal — which is the correct failure direction.
 */
export function assignableRolesFor(actorRole: UserRole): UserRole[] {
  if (actorRole === "administrador") return [...USER_ROLE_VALUES];
  return USER_ROLE_VALUES.filter((role) => role !== "administrador");
}
