import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import type {
  ContinuationTokenFailure,
  IssuedContinuationToken,
  PublicApplicationToken,
  PublicApplicationTokenPurpose,
  PublicApplicationTokenRevokedReason,
  ResolvedContinuation,
} from "@/types";

/**
 * ============================================================================
 * CONTINUATION TOKENS — LETTING AN APPLICANT COME BACK (26A-4)
 * ============================================================================
 *
 * A loan application takes days. The applicant has to find pay slips, get a
 * vehicle inspected, talk a relative into being a guarantor. Requiring them to
 * create an account with a password to do that would lose most of them, so they
 * get a link instead.
 *
 * A link is a BEARER CREDENTIAL: whoever holds it is treated as the applicant.
 * Everything below exists to bound what that costs when the link inevitably
 * ends up somewhere it should not — a forwarded email, a shared screen, a
 * browser history on a family computer.
 *
 * ----------------------------------------------------------------------------
 * THE FIVE PROPERTIES THAT MAKE THIS SAFE
 * ----------------------------------------------------------------------------
 * 1. UNGUESSABLE — 256 bits from the OS CSPRNG. Not a UUID (a v4 UUID carries
 *    122 bits and is designed for uniqueness, not secrecy), not a counter, not
 *    anything derived from the applicant.
 *
 * 2. NOT STORED — only a SHA-256 digest reaches the database. A leaked backup
 *    or a compromised read yields hashes, and a hash cannot be presented as a
 *    token.
 *
 * 3. MEANINGLESS — the token encodes nothing. No application id, no email, no
 *    cédula, no ODL application number. The URL it travels in is safe to appear
 *    in a referrer header or a chat preview because it discloses nothing about
 *    who the applicant is or even that they exist.
 *
 * 4. SCOPED TO ONE INTAKE — resolving a token yields exactly one intake id.
 *    Reaching another applicant's data is not a policy that could be
 *    misconfigured; there is no expressible request for it.
 *
 * 5. NOT A CRM CREDENTIAL — no role, no capability, no branch scope, and no
 *    Supabase key ever reaches the browser. The applicant's browser holds an
 *    opaque string; only server-side code exchanges it, and only through the
 *    SECURITY DEFINER functions this module calls.
 */

/**
 * 32 bytes = 256 bits. Well beyond brute force: even at a trillion guesses per
 * second against an endpoint that did not rate-limit at all, the expected time
 * to find one live token exceeds the age of the universe by many orders of
 * magnitude.
 */
const TOKEN_BYTES = 32;

/**
 * FOURTEEN DAYS.
 *
 * Chosen against the real job: gathering pay slips, a bank letter, possibly a
 * vehicle inspection and a guarantor's documents. A 48-hour link would expire
 * mid-errand and generate support calls; a 90-day link is a credential sitting
 * in an inbox long after anyone remembers it exists. Two weeks comfortably
 * covers a normal document-gathering cycle while keeping a leaked link's useful
 * life bounded, and reissuing is cheap.
 *
 * This is a business decision ODL can revisit — it is one constant, and
 * changing it affects only tokens issued afterwards.
 */
export const CONTINUATION_TOKEN_TTL_DAYS = 14;

/**
 * base64url, so the token is safe in a path segment with no escaping. 32 bytes
 * encodes to 43 characters — which cannot satisfy the database's
 * `^[0-9a-f]{64}$` hash CHECK, so passing a raw token where a digest belongs
 * fails loudly instead of storing the secret in plaintext.
 */
function generateRawToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

/**
 * SHA-256, deliberately, and NOT bcrypt/scrypt/argon2.
 *
 * Slow KDFs exist to make guessing a low-entropy human-chosen password
 * expensive. This input is 256 bits of uniform CSPRNG output: there is no
 * dictionary to try and no shortcut, so hashing speed changes an attacker's
 * odds not at all. What a slow KDF WOULD do is add tens of milliseconds to
 * every single portal page load. The tradeoff only holds because the token is
 * machine-generated at full entropy — which is why `generateRawToken` above is
 * the only thing in this codebase allowed to produce one.
 */
function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

/**
 * Constant-time comparison of two digests.
 *
 * Not used on the lookup path (that is an indexed equality on the hash, where
 * an attacker would need the preimage before timing told them anything), but
 * exported for any future path that compares a stored digest to a computed one
 * in application code — the situation where `===` genuinely leaks.
 */
export function tokenDigestsMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export type IssueContinuationTokenResult =
  | { status: "ok"; issued: IssuedContinuationToken }
  | { status: "error"; code: "INTAKE_NOT_FOUND" | "ISSUE_FAILED" };

/**
 * Mint a continuation token for one intake, revoking any previous live one.
 *
 * ROTATION IS DESTRUCTIVE BY DESIGN. Issuing a replacement revokes the old
 * token rather than letting both work. The reason a customer asks for a new
 * link is often that the old one went somewhere it should not have, and a
 * policy that leaves it alive for another fortnight defeats the request. It
 * also means "is this the live link?" has exactly one answer, which matters
 * when a support agent is on the phone. The revoke-and-insert happens inside
 * one SECURITY DEFINER function so there is never a moment with zero live
 * tokens or two.
 *
 * THE RETURNED RAW TOKEN EXISTS ONLY HERE. It is generated in this process,
 * hashed here, and only the hash is sent to PostgreSQL — so the raw value
 * cannot appear in statement logs, in `pg_stat_statements`, or in a database
 * error message. The caller must deliver it and then drop it. It is not
 * recoverable, because recovering it would mean it had been stored.
 */
export async function issueContinuationToken(
  intakeId: string,
  purpose: PublicApplicationTokenPurpose = "continue"
): Promise<IssueContinuationTokenResult> {
  const supabase = getSupabaseServerClient();

  const rawToken = generateRawToken();
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(
    Date.now() + CONTINUATION_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase.rpc("issue_public_application_token", {
    p_intake_id: intakeId,
    p_token_hash: tokenHash,
    p_expires_at: expiresAt,
    p_purpose: purpose,
  });

  if (error) {
    // 'no_data_found' is the function's signal that the intake does not exist.
    if (error.code === "P0002") {
      return { status: "error", code: "INTAKE_NOT_FOUND" };
    }
    // NEVER log rawToken or tokenHash. error.message cannot contain the raw
    // token because the raw token was never sent to the database.
    console.error("[continuation-tokens service] Failed to issue token:", error.message);
    return { status: "error", code: "ISSUE_FAILED" };
  }

  return {
    status: "ok",
    issued: { token: rawToken, tokenId: data as string, expiresAt },
  };
}

export type ResolveContinuationTokenResult =
  | { status: "ok"; resolved: ResolvedContinuation }
  | { status: "invalid"; reason: ContinuationTokenFailure }
  | { status: "error"; code: "RESOLVE_FAILED" };

/**
 * Exchange a raw token for the intake (and application) it unlocks.
 *
 * THE ENTRY POINT FOR EVERY FUTURE PORTAL REQUEST. Validation, expiry,
 * revocation and use-recording all happen inside one database function, so
 * there is no read-then-write window for two browser tabs to race through, and
 * no way for a caller to skip the checks by doing its own lookup.
 *
 * WHY IT DISTINGUISHES 'expired' FROM 'not_found'. An attacker submitting
 * guessed tokens receives `not_found` every time — the distinction is
 * unreachable without already holding a real 256-bit token, and for the
 * customer who does hold one it is the difference between a dead end and
 * "request a new link". Hiding it would degrade a legitimate applicant's
 * experience while protecting nothing.
 *
 * CHEAP BY CONSTRUCTION. One indexed lookup on the hash, no joins beyond the
 * intake row, and identical work for valid and invalid tokens — so this
 * endpoint cannot be used as an amplification lever, and it does not need a
 * rate limiter to avoid being expensive. (Volumetric limiting is still a real
 * gap; see this module's note in the milestone report.)
 */
export async function resolveContinuationToken(
  rawToken: string
): Promise<ResolveContinuationTokenResult> {
  // Reject structurally impossible tokens before touching the database. Cheap,
  // and it keeps absurd input out of the query path entirely.
  if (typeof rawToken !== "string" || rawToken.length < 20 || rawToken.length > 200) {
    return { status: "invalid", reason: "not_found" };
  }

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.rpc("redeem_public_application_token", {
    p_token_hash: hashToken(rawToken),
  });

  if (error) {
    console.error("[continuation-tokens service] Failed to redeem token:", error.message);
    return { status: "error", code: "RESOLVE_FAILED" };
  }

  const rows = (data ?? []) as Array<{
    outcome: string;
    intake_id: string | null;
    application_id: string | null;
  }>;
  const row = rows[0];
  if (!row) {
    return { status: "invalid", reason: "not_found" };
  }

  if (row.outcome !== "valid") {
    return { status: "invalid", reason: row.outcome as ContinuationTokenFailure };
  }

  return {
    status: "ok",
    resolved: {
      intakeId: row.intake_id!,
      // Undefined is normal: a lead that has not selected a product has no
      // application yet, and creating one here would forge an official number.
      applicationId: row.application_id ?? undefined,
    },
  };
}

export type RevokeContinuationTokensResult =
  | { status: "ok"; revokedCount: number }
  | { status: "error"; code: "REVOKE_FAILED" };

/**
 * Revoke the live token for an intake.
 *
 * `reason` is required rather than defaulted: "why is this link dead?" is the
 * first question support will ask, and a default would quietly answer it wrong.
 * Submission will use `'submitted'` in a later milestone — see the note on
 * post-submission read access in the milestone report.
 */
export async function revokeContinuationTokens(
  intakeId: string,
  reason: PublicApplicationTokenRevokedReason,
  purpose: PublicApplicationTokenPurpose = "continue"
): Promise<RevokeContinuationTokensResult> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.rpc("revoke_public_application_tokens", {
    p_intake_id: intakeId,
    p_reason: reason,
    p_purpose: purpose,
  });

  if (error) {
    console.error("[continuation-tokens service] Failed to revoke tokens:", error.message);
    return { status: "error", code: "REVOKE_FAILED" };
  }

  return { status: "ok", revokedCount: (data as number) ?? 0 };
}

const TOKEN_SELECT =
  "id, application_intake_id, purpose, expires_at, revoked_at, revoked_reason, " +
  "last_used_at, use_count, created_at";

interface TokenRow {
  id: string;
  application_intake_id: string;
  purpose: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_reason: string | null;
  last_used_at: string | null;
  use_count: number;
  created_at: string;
}

/**
 * Token metadata for support and audit.
 *
 * DELIBERATELY CANNOT RETURN THE TOKEN. `token_hash` is absent from the select
 * list and from the return type, so this cannot become the accidental route by
 * which a digest — or worse, an assumption that a digest is a token — escapes
 * into a page or a log.
 */
export async function getIntakeContinuationTokens(
  intakeId: string
): Promise<
  { status: "ok"; tokens: PublicApplicationToken[] } | { status: "error"; code: "LOAD_FAILED" }
> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("public_application_tokens")
    .select(TOKEN_SELECT)
    .eq("application_intake_id", intakeId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[continuation-tokens service] Failed to load tokens:", error.message);
    return { status: "error", code: "LOAD_FAILED" };
  }

  const rows = (data ?? []) as unknown as TokenRow[];
  return {
    status: "ok",
    tokens: rows.map((row) => ({
      id: row.id,
      applicationIntakeId: row.application_intake_id,
      purpose: row.purpose as PublicApplicationTokenPurpose,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at ?? undefined,
      revokedReason: (row.revoked_reason as PublicApplicationTokenRevokedReason | null) ?? undefined,
      lastUsedAt: row.last_used_at ?? undefined,
      useCount: row.use_count,
      createdAt: row.created_at,
    })),
  };
}
