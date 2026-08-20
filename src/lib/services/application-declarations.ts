import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { CURRENT_DECLARATION_VERSIONS } from "@/types";
import type {
  ApplicationDeclaration,
  ApplicationDeclarationSet,
  DeclarationAcceptedVia,
  DeclarationType,
  SourceOfFundsCategory,
} from "@/types";

/**
 * ============================================================================
 * DECLARATIONS — RECORDING WHAT THE APPLICANT ATTESTED TO (26A-4)
 * ============================================================================
 *
 * PEP status, source of funds, consent to a credit consultation.
 *
 * THERE IS NO UPDATE FUNCTION IN THIS FILE, AND THERE CANNOT BE ONE. The
 * database grants service_role SELECT on `application_declarations` and nothing
 * else — no INSERT, no UPDATE, no DELETE. Every write goes through the
 * `record_application_declaration` SECURITY DEFINER function, which only ever
 * appends. That is the same privilege-withholding mechanism that keeps
 * `crm_events` append-only, and it means "we never rewrite an accepted
 * declaration" is a property of the schema rather than a rule someone has to
 * remember while editing this file.
 *
 * A REVISION IS A NEW ROW. When an applicant changes an answer before
 * submitting, revision N+1 is inserted and revision N stays exactly as it was
 * accepted. `version` travels with each row, so the answer and the wording it
 * answered are never separated — which is what makes a consent record still
 * meaningful after ODL rewrites the text.
 *
 * AUTHORIZATION IS THE CALLER'S JOB, AND IT IS DELIBERATE THAT IT IS NOT HERE.
 * Two very different callers need these functions: the internal CRM, which
 * resolves an application through the branch-scoped `getApplicationById`, and
 * the public portal, which resolves one through a continuation token. Baking
 * either check in would make the other impossible. Both paths must establish
 * their right to the application id BEFORE calling in — the portal path does
 * this in portal-snapshot.ts.
 */

const DECLARATION_SELECT =
  "id, application_id, declaration_type, version, revision, is_pep, pep_details, " +
  "source_of_funds_category, source_of_funds_description, consent_granted, payload, " +
  "accepted_at, accepted_via, created_at";

interface DeclarationRow {
  id: string;
  application_id: string;
  declaration_type: string;
  version: string;
  revision: number;
  is_pep: boolean | null;
  pep_details: string | null;
  source_of_funds_category: string | null;
  source_of_funds_description: string | null;
  consent_granted: boolean | null;
  payload: Record<string, unknown> | null;
  accepted_at: string;
  accepted_via: string;
  created_at: string;
}

function toDeclaration(row: DeclarationRow): ApplicationDeclaration {
  return {
    id: row.id,
    applicationId: row.application_id,
    declarationType: row.declaration_type as DeclarationType,
    version: row.version,
    revision: row.revision,
    // `?? undefined` and NOT `?? false`: "not answered" and "answered no" are
    // different facts, and collapsing them would silently turn a missing PEP
    // answer into a declared non-PEP.
    isPep: row.is_pep ?? undefined,
    pepDetails: row.pep_details ?? undefined,
    sourceOfFundsCategory:
      (row.source_of_funds_category as SourceOfFundsCategory | null) ?? undefined,
    sourceOfFundsDescription: row.source_of_funds_description ?? undefined,
    consentGranted: row.consent_granted ?? undefined,
    payload: row.payload ?? {},
    acceptedAt: row.accepted_at,
    acceptedVia: row.accepted_via as DeclarationAcceptedVia,
    createdAt: row.created_at,
  };
}

export type RecordDeclarationResult =
  | { status: "ok"; declarationId: string }
  | { status: "error"; code: "APPLICATION_NOT_FOUND" | "INVALID_DECLARATION" | "RECORD_FAILED" };

interface RecordDeclarationArgs {
  applicationId: string;
  declarationType: DeclarationType;
  acceptedVia: DeclarationAcceptedVia;
  isPep?: boolean;
  pepDetails?: string;
  sourceOfFundsCategory?: SourceOfFundsCategory;
  sourceOfFundsDescription?: string;
  consentGranted?: boolean;
  payload?: Record<string, unknown>;
}

async function recordDeclaration(args: RecordDeclarationArgs): Promise<RecordDeclarationResult> {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase.rpc("record_application_declaration", {
    p_application_id: args.applicationId,
    p_declaration_type: args.declarationType,
    // The version is taken from the constant, never from the caller. A caller
    // that could name its own version could claim an applicant accepted wording
    // they were never shown.
    p_version: CURRENT_DECLARATION_VERSIONS[args.declarationType],
    p_accepted_via: args.acceptedVia,
    p_is_pep: args.isPep ?? null,
    p_pep_details: args.pepDetails ?? null,
    p_source_of_funds_category: args.sourceOfFundsCategory ?? null,
    p_source_of_funds_description: args.sourceOfFundsDescription ?? null,
    p_consent_granted: args.consentGranted ?? null,
    p_payload: args.payload ?? {},
  });

  if (error) {
    if (error.code === "P0002") {
      return { status: "error", code: "APPLICATION_NOT_FOUND" };
    }
    // 23514 = check_violation. The database's per-type shape constraints are
    // the real validator here, so a malformed declaration is reported as such
    // rather than as an unexplained failure.
    if (error.code === "23514") {
      return { status: "error", code: "INVALID_DECLARATION" };
    }
    console.error("[declarations service] Failed to record declaration:", error.message);
    return { status: "error", code: "RECORD_FAILED" };
  }

  return { status: "ok", declarationId: data as string };
}

/**
 * Record a PEP declaration.
 *
 * `isPep: false` is a complete, valid answer — most applicants are not PEPs and
 * saying so is the whole point of asking. `details` is required when the answer
 * is yes; the database rejects a bare "yes" because a PEP declaration with no
 * context tells compliance nothing.
 */
export function recordPepDeclaration(
  applicationId: string,
  isPep: boolean,
  details: string | undefined,
  acceptedVia: DeclarationAcceptedVia
): Promise<RecordDeclarationResult> {
  return recordDeclaration({
    applicationId,
    declarationType: "pep",
    acceptedVia,
    isPep,
    // Never carry details for a "no" — that would leave text attached to an
    // answer it does not describe.
    pepDetails: isPep ? details : undefined,
  });
}

/**
 * Record a source-of-funds declaration.
 *
 * See `SourceOfFundsCategory` — the category list is a placeholder pending ODL
 * compliance confirmation, not approved policy. `description` is mandatory for
 * `other`, enforced in the database.
 */
export function recordSourceOfFundsDeclaration(
  applicationId: string,
  category: SourceOfFundsCategory,
  description: string | undefined,
  acceptedVia: DeclarationAcceptedVia
): Promise<RecordDeclarationResult> {
  return recordDeclaration({
    applicationId,
    declarationType: "source_of_funds",
    acceptedVia,
    sourceOfFundsCategory: category,
    sourceOfFundsDescription: description,
  });
}

/**
 * Record consent (or refusal) for a credit consultation.
 *
 * CONSENT IS NOT A CREDIT CHECK. This records permission and nothing else — no
 * bureau is contacted, no result is stored, and the two must never be conflated.
 * A refusal is recorded exactly like a grant, because "we asked and they said
 * no" is the fact that protects ODL from having appeared to check anyway.
 */
export function recordCreditConsentDeclaration(
  applicationId: string,
  granted: boolean,
  acceptedVia: DeclarationAcceptedVia
): Promise<RecordDeclarationResult> {
  return recordDeclaration({
    applicationId,
    declarationType: "credit_consultation_consent",
    acceptedVia,
    consentGranted: granted,
  });
}

export type GetDeclarationsResult =
  | { status: "ok"; declarations: ApplicationDeclarationSet }
  | { status: "error"; code: "LOAD_FAILED" };

/**
 * The CURRENT revision of each declaration type for one application.
 *
 * Ordered by revision descending and reduced first-wins, so the highest
 * revision of each type is what comes back. Superseded revisions are still in
 * the table — `getDeclarationHistory` returns them — they are simply not what
 * "the applicant's answer" means.
 */
export async function getApplicationDeclarations(
  applicationId: string
): Promise<GetDeclarationsResult> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("application_declarations")
    .select(DECLARATION_SELECT)
    .eq("application_id", applicationId)
    .order("revision", { ascending: false });

  if (error) {
    console.error("[declarations service] Failed to load declarations:", error.message);
    return { status: "error", code: "LOAD_FAILED" };
  }

  const rows = (data ?? []) as unknown as DeclarationRow[];
  const set: ApplicationDeclarationSet = { applicationId };

  for (const row of rows) {
    const declaration = toDeclaration(row);
    if (declaration.declarationType === "pep") {
      set.pep ??= declaration;
    } else if (declaration.declarationType === "source_of_funds") {
      set.sourceOfFunds ??= declaration;
    } else {
      set.creditConsent ??= declaration;
    }
  }

  return { status: "ok", declarations: set };
}

/**
 * Every revision, newest first — the audit view.
 *
 * This exists because the append-only model is worthless if nothing can read
 * the history it preserves.
 */
export async function getDeclarationHistory(
  applicationId: string,
  declarationType: DeclarationType
): Promise<
  { status: "ok"; declarations: ApplicationDeclaration[] } | { status: "error"; code: "LOAD_FAILED" }
> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("application_declarations")
    .select(DECLARATION_SELECT)
    .eq("application_id", applicationId)
    .eq("declaration_type", declarationType)
    .order("revision", { ascending: false });

  if (error) {
    console.error("[declarations service] Failed to load declaration history:", error.message);
    return { status: "error", code: "LOAD_FAILED" };
  }

  return {
    status: "ok",
    declarations: ((data ?? []) as unknown as DeclarationRow[]).map(toDeclaration),
  };
}

/**
 * Are all three required declarations satisfactorily answered?
 *
 * The rules, and why each is what it is:
 *   * PEP — any answer completes it. "No" is an answer.
 *   * SOURCE OF FUNDS — a category must be chosen.
 *   * CREDIT CONSENT — must be GRANTED, not merely answered. A refusal is a
 *     valid, recorded declaration but leaves Step 3 incomplete, because ODL
 *     cannot proceed without permission to verify. This is the one place where
 *     "answered" and "complete" deliberately differ.
 */
export function areRequiredDeclarationsComplete(set: ApplicationDeclarationSet): boolean {
  const pepAnswered = set.pep?.isPep !== undefined;
  const sourceAnswered = set.sourceOfFunds?.sourceOfFundsCategory !== undefined;
  const consentGranted = set.creditConsent?.consentGranted === true;
  return pepAnswered && sourceAnswered && consentGranted;
}
