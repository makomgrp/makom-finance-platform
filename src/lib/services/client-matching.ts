import "server-only";
import { findClientByIdentification, findClientsByEmail, findClientsByPhone } from "./clients";
import type { ApplicationIntake } from "@/types";

/**
 * Deterministic Client-matching for the Application Intake pipeline
 * (Milestone 15B — see the Milestone 15A architecture review's "Client
 * Matching Strategy" section). Pure decision logic over the existing
 * `clients` table via clients.ts's own narrow lookups — this module
 * never queries Supabase directly, keeping "one service per table"
 * discipline intact.
 *
 * Signal priority, authoritative to advisory:
 *   1. identification (type + number) — has a real unique constraint,
 *      so a match here is as strong a signal as this system has.
 *   2. email — no unique constraint; a match is corroborating, not proof.
 *   3. phone — same caveat as email.
 *
 * Deliberately does NOT: fuzzy-match on applicantFullName, weight
 * partial/normalized string similarity, or auto-merge Clients under any
 * circumstance. Every outcome below is one of exactly three shapes:
 * a confident single match, an explicit new-Client candidate, or a
 * needs_review signal — there is no fourth "probably fine" path.
 */

export type ClientMatchResult =
  | { outcome: "matched"; clientId: string }
  | { outcome: "new_client_candidate" }
  | { outcome: "needs_review"; reason: "conflicting_client_identity" | "low_confidence_client_match" };

export type MatchClientForIntakeResult = { status: "ok"; match: ClientMatchResult } | { status: "error" };

/**
 * Cases A–E (Milestone 15B brief, section 11):
 *   A. identification matches exactly one Client, and any email/phone
 *      present on the intake belongs to that same Client (or to no
 *      Client at all) → matched.
 *   B. identification matches Client A, but email or phone on the
 *      intake belongs to a DIFFERENT existing Client → needs_review
 *      (conflicting_client_identity). A real identity mismatch is a
 *      review case, never a silent override of the identification match.
 *   C. no identification match, but email and/or phone resolve to
 *      exactly one Client → needs_review (low_confidence_client_match).
 *      Never auto-attached — email/phone alone is medium confidence at
 *      best, per the brief's explicit "prefer needs_review / candidate
 *      behavior for medium-confidence matching."
 *   D. no identification match, and email/phone resolve to two or more
 *      DISTINCT Clients → needs_review (conflicting_client_identity).
 *   E. no identification, email, or phone match anything → new-Client
 *      candidate (subject to the separate required-field completeness
 *      check in application-intake-processing.ts before a Client can
 *      actually be created).
 */
export async function matchClientForIntake(intake: ApplicationIntake): Promise<MatchClientForIntakeResult> {
  const hasIdentification = Boolean(intake.applicantIdentificationType && intake.applicantIdentificationNumber);

  if (hasIdentification) {
    const identificationResult = await findClientByIdentification(
      intake.applicantIdentificationType!,
      intake.applicantIdentificationNumber!
    );
    if (identificationResult.status === "error") {
      return { status: "error" };
    }

    if (identificationResult.client) {
      const candidate = identificationResult.client;

      const [emailResult, phoneResult] = await Promise.all([
        intake.applicantEmail ? findClientsByEmail(intake.applicantEmail) : Promise.resolve(null),
        intake.applicantPhone ? findClientsByPhone(intake.applicantPhone) : Promise.resolve(null),
      ]);
      if (emailResult?.status === "error" || phoneResult?.status === "error") {
        return { status: "error" };
      }

      const conflictingEmailMatch = emailResult?.clients.some((c) => c.id !== candidate.id) ?? false;
      const conflictingPhoneMatch = phoneResult?.clients.some((c) => c.id !== candidate.id) ?? false;

      if (conflictingEmailMatch || conflictingPhoneMatch) {
        return { status: "ok", match: { outcome: "needs_review", reason: "conflicting_client_identity" } };
      }

      return { status: "ok", match: { outcome: "matched", clientId: candidate.id } };
    }
    // Identification supplied but matched no Client: fall through to
    // email/phone signals exactly as if no identification had been
    // supplied at all — a mistyped or not-yet-registered identification
    // number is not itself a conflict signal.
  }

  const [emailResult, phoneResult] = await Promise.all([
    intake.applicantEmail ? findClientsByEmail(intake.applicantEmail) : Promise.resolve(null),
    intake.applicantPhone ? findClientsByPhone(intake.applicantPhone) : Promise.resolve(null),
  ]);
  if (emailResult?.status === "error" || phoneResult?.status === "error") {
    return { status: "error" };
  }

  const matchedClientIds = new Set<string>();
  emailResult?.clients.forEach((c) => matchedClientIds.add(c.id));
  phoneResult?.clients.forEach((c) => matchedClientIds.add(c.id));

  if (matchedClientIds.size === 0) {
    return { status: "ok", match: { outcome: "new_client_candidate" } };
  }
  if (matchedClientIds.size === 1) {
    return { status: "ok", match: { outcome: "needs_review", reason: "low_confidence_client_match" } };
  }
  return { status: "ok", match: { outcome: "needs_review", reason: "conflicting_client_identity" } };
}
