import "server-only";

/**
 * ============================================================================
 * MILESTONE 26B-9A — ODL'S MAILBOX, AS THE SERVER SEES IT
 * ============================================================================
 *
 * ODL runs one operational mailbox on cPanel: prestamo@odlfinanciera.com,
 * reached over IMAPS on 993. Roundcube is the webmail UI in front of it and is
 * NOT what the CRM talks to — the CRM speaks IMAP to the same server, so
 * anything staff do in Roundcube keeps working exactly as before.
 *
 * ----------------------------------------------------------------------------
 * `server-only` IS THE ENFORCEMENT, NOT THE CONVENTION
 * ----------------------------------------------------------------------------
 * Importing this file from a `"use client"` module is a BUILD ERROR, which is
 * what keeps the password out of the browser bundle by construction rather
 * than by everyone remembering. Same posture as src/lib/supabase/server.ts.
 *
 * ----------------------------------------------------------------------------
 * THE PASSWORD IS READ, NEVER RETURNED ALONGSIDE ANYTHING RENDERABLE
 * ----------------------------------------------------------------------------
 * `getImapConfig()` hands the credential straight to the IMAP client and
 * nothing else. `getMailboxDisplayInfo()` exists so the UI can name the
 * mailbox without importing anything that has ever seen the password.
 *
 * Absence is a FIRST-CLASS RESULT, not a thrown error: the Email page must
 * still render, and the Sync button must be able to say "not configured"
 * rather than 500. Same degraded-mode discipline as DEEPL_API_KEY.
 */

/** cPanel's verified secure ports. Used when the env var is absent. */
const DEFAULT_IMAP_PORT = 993;
const DEFAULT_SMTP_PORT = 465;

export interface ImapConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  /** Handed to the IMAP client and nowhere else. Never logged, never returned
   * to a caller that renders. */
  password: string;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
}

export type MailConfigResult<T> =
  | { status: "ok"; config: T }
  /** Which variable is missing — a NAME, never a value. Safe to log. */
  | { status: "not_configured"; missing: string[] };

function readPort(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * TLS IS ON UNLESS SOMEONE EXPLICITLY WRITES "false".
 *
 * A typo, an empty string or a missing variable must all mean ENCRYPTED. The
 * opposite default would let a misconfigured deployment authenticate in the
 * clear, and the only signal would be that it happened to work.
 */
function readSecure(value: string | undefined): boolean {
  return value?.trim().toLowerCase() !== "false";
}

function collectMissing(entries: Record<string, string | undefined>): string[] {
  return Object.entries(entries)
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name);
}

export function getImapConfig(): MailConfigResult<ImapConfig> {
  const user = process.env.ODL_EMAIL_ADDRESS;
  const host = process.env.ODL_IMAP_HOST;
  const password = process.env.ODL_EMAIL_PASSWORD;

  const missing = collectMissing({
    ODL_EMAIL_ADDRESS: user,
    ODL_IMAP_HOST: host,
    ODL_EMAIL_PASSWORD: password,
  });
  if (missing.length > 0) return { status: "not_configured", missing };

  return {
    status: "ok",
    config: {
      host: host!.trim(),
      port: readPort(process.env.ODL_IMAP_PORT, DEFAULT_IMAP_PORT),
      secure: readSecure(process.env.ODL_IMAP_SECURE),
      user: user!.trim(),
      password: password!,
    },
  };
}

/**
 * SMTP configuration ONLY. 26B-9A sends nothing and deliberately ships no
 * transport, no Compose and no Reply — this exists so 9B adds outbound behind
 * a configuration surface that has already been reviewed, rather than
 * inventing one under deadline.
 */
export function getSmtpConfig(): MailConfigResult<SmtpConfig> {
  const user = process.env.ODL_EMAIL_ADDRESS;
  const host = process.env.ODL_SMTP_HOST;
  const password = process.env.ODL_EMAIL_PASSWORD;

  const missing = collectMissing({
    ODL_EMAIL_ADDRESS: user,
    ODL_SMTP_HOST: host,
    ODL_EMAIL_PASSWORD: password,
  });
  if (missing.length > 0) return { status: "not_configured", missing };

  return {
    status: "ok",
    config: {
      host: host!.trim(),
      port: readPort(process.env.ODL_SMTP_PORT, DEFAULT_SMTP_PORT),
      secure: readSecure(process.env.ODL_SMTP_SECURE),
      user: user!.trim(),
      password: password!,
    },
  };
}

/** The mailbox address, for display and for scoping stored rows. Contains no
 * secret, so this is the only mail config a page component ever needs. */
export function getMailboxAddress(): string | null {
  return process.env.ODL_EMAIL_ADDRESS?.trim() || null;
}
