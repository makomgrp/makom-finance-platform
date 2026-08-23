import "server-only";

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { getImapConfig } from "@/lib/config/mail";

/**
 * ============================================================================
 * MILESTONE 26B-9A — READING ODL'S MAILBOX
 * ============================================================================
 *
 * One IMAP session per explicit Sync, opened read-only, closed in a `finally`.
 * Nothing here runs on a timer: there is no cron, no IDLE, no worker, and the
 * Email page never touches this module — it renders from the CRM database.
 *
 * ----------------------------------------------------------------------------
 * READ-ONLY IS A PROMISE TO ROUNDCUBE
 * ----------------------------------------------------------------------------
 * `mailboxOpen(..., { readOnly: true })` opens the INBOX with EXAMINE rather
 * than SELECT. The distinction matters operationally, not just semantically:
 * under EXAMINE the server will not set \Seen when a body is fetched, so
 * synchronising cannot silently mark ODL's unread mail as read. Nothing here
 * deletes, moves, expunges or reflags anything — the CRM takes a copy and
 * leaves the mailbox exactly as it found it.
 *
 * ----------------------------------------------------------------------------
 * TLS IS NEVER WEAKENED TO MAKE A CONNECTION WORK
 * ----------------------------------------------------------------------------
 * No `rejectUnauthorized: false`, no custom trust store, no hostname override.
 * If the certificate does not validate, that is reported as a distinct failure
 * for a human to fix at the server — a CRM that silently accepts an unverified
 * certificate is a CRM whose mail can be intercepted.
 *
 * ----------------------------------------------------------------------------
 * NOTHING SENSITIVE IS LOGGED
 * ----------------------------------------------------------------------------
 * imapflow's own logger is disabled: at its default level it prints protocol
 * traffic, which includes the AUTHENTICATE exchange and message content. Errors
 * are reduced to a short machine code before they leave this module, so a stack
 * trace carrying a credential or a customer's message can never reach a log
 * line or a toast.
 */

/** Short, safe failure codes. Never a raw server string. */
export type MailErrorCode =
  | "not_configured"
  | "auth_failed"
  | "tls_failed"
  | "connection_failed"
  | "mailbox_unavailable"
  | "unknown";

export type MailboxProbeResult =
  | { status: "ok"; mailbox: string; total: number; uidValidity: string }
  | { status: "error"; code: MailErrorCode; missing?: string[] };

/** One parsed message, already reduced to what the CRM stores. */
export interface FetchedMessage {
  imapUid: number;
  uidValidity: string;
  messageId: string | null;
  fromAddress: string;
  fromName: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  receivedAt: string;
  attachments: { filename: string | null; mimeType: string | null; sizeBytes: number | null }[];
}

export type FetchRecentResult =
  | { status: "ok"; mailbox: string; messages: FetchedMessage[]; failed: number }
  | { status: "error"; code: MailErrorCode; missing?: string[] };

/**
 * Reduces any thrown value to one of a handful of codes.
 *
 * The message text is inspected only to CLASSIFY, and is then discarded — it
 * is never returned, so nothing a server chose to say can reach a user or a
 * log through this path.
 */
function classifyError(error: unknown): MailErrorCode {
  const raw = error instanceof Error ? `${error.message}` : String(error ?? "");
  const text = raw.toLowerCase();

  if (text.includes("invalid credentials") || text.includes("authentication") || text.includes("auth")) {
    return "auth_failed";
  }
  if (
    text.includes("certificate") ||
    text.includes("self-signed") ||
    text.includes("self signed") ||
    text.includes("altname") ||
    text.includes("tls") ||
    text.includes("depth_zero")
  ) {
    return "tls_failed";
  }
  if (
    text.includes("timeout") ||
    text.includes("etimedout") ||
    text.includes("econnrefused") ||
    text.includes("enotfound") ||
    text.includes("econnreset") ||
    text.includes("socket")
  ) {
    return "connection_failed";
  }
  if (text.includes("mailbox") || text.includes("nonexistent")) return "mailbox_unavailable";
  return "unknown";
}

function createClient(): ImapFlow | { missing: string[] } {
  const configResult = getImapConfig();
  if (configResult.status !== "ok") return { missing: configResult.missing };

  const { host, port, secure, user, password } = configResult.config;
  return new ImapFlow({
    host,
    port,
    secure,
    auth: { user, pass: password },
    // Protocol logging OFF. See the header: imapflow's default logger emits the
    // authentication exchange and message payloads.
    logger: false,
    // BOUNDED, BUT NOT IMPATIENT. A Server Action must not hang forever, yet
    // these were originally 15s and the very first connection to ODL's server
    // failed on the greeting timeout — a cold DNS and TCP path costs seconds
    // before Dovecot says a word, even though the greeting itself arrives in
    // well under a second once the route is warm. Timing out a HEALTHY mailbox
    // is worse than waiting: it teaches staff that Sync is unreliable and
    // sends them looking for a fault that does not exist.
    greetingTimeout: 30_000,
    connectionTimeout: 30_000,
    socketTimeout: 90_000,
  });
}

/**
 * The §26 connection test: TLS, authentication, INBOX open, message count.
 * Fetches no bodies and touches no flags.
 */
export async function probeMailbox(): Promise<MailboxProbeResult> {
  const client = createClient();
  if ("missing" in client) return { status: "error", code: "not_configured", missing: client.missing };

  try {
    await client.connect();
    const mailbox = await client.mailboxOpen("INBOX", { readOnly: true });
    const address = getImapConfig();
    return {
      status: "ok",
      mailbox: address.status === "ok" ? address.config.user : "",
      total: mailbox.exists,
      uidValidity: String(mailbox.uidValidity),
    };
  } catch (error) {
    return { status: "error", code: classifyError(error) };
  } finally {
    // `logout()` can itself throw on an already-broken socket; a failed
    // teardown must not mask the real outcome above.
    try {
      await client.logout();
    } catch {
      /* connection already gone */
    }
  }
}

function addressList(value: unknown): string[] {
  // mailparser's address objects vary in shape by header; this reads the one
  // field that is always present and drops anything unparseable rather than
  // guessing at a malformed header.
  const container = value as { value?: { address?: string }[] } | undefined;
  return (container?.value ?? [])
    .map((entry) => entry.address?.trim().toLowerCase())
    .filter((address): address is string => Boolean(address));
}

/**
 * The newest `limit` messages in INBOX, parsed.
 *
 * BOUNDED BY CONSTRUCTION. The UID range is computed from the mailbox's own
 * message count, so this cannot walk an entire historical mailbox even if the
 * caller asks for a large number — ODL's inbox already holds years of mail and
 * an unbounded first import would be both slow and unreviewable.
 *
 * ONE BAD MESSAGE DOES NOT ABORT THE SYNC. A message that fails to parse is
 * counted and skipped, because the alternative is that a single malformed
 * header from years ago permanently blocks every future sync.
 */
export async function fetchRecentMessages(limit: number): Promise<FetchRecentResult> {
  const client = createClient();
  if ("missing" in client) return { status: "error", code: "not_configured", missing: client.missing };

  const messages: FetchedMessage[] = [];
  let failed = 0;

  try {
    await client.connect();
    const mailbox = await client.mailboxOpen("INBOX", { readOnly: true });
    const uidValidity = String(mailbox.uidValidity);
    const address = getImapConfig();
    const mailboxAddress = address.status === "ok" ? address.config.user : "";

    if (mailbox.exists === 0) {
      return { status: "ok", mailbox: mailboxAddress, messages: [], failed: 0 };
    }

    // Sequence numbers, not UIDs: `exists` is a count, and the newest `limit`
    // messages are always the last `limit` sequence numbers. UIDs are sparse
    // (deletions leave gaps) so arithmetic on them would silently under-fetch.
    const start = Math.max(1, mailbox.exists - limit + 1);
    const range = `${start}:${mailbox.exists}`;

    for await (const item of client.fetch(range, { uid: true, source: true, internalDate: true })) {
      try {
        if (!item.source) {
          failed += 1;
          continue;
        }
        const parsed = await simpleParser(item.source);

        const from = parsed.from?.value?.[0];
        const fromAddress = from?.address?.trim().toLowerCase();
        if (!fromAddress) {
          // Without a sender there is nothing to match on and nothing to show.
          failed += 1;
          continue;
        }

        messages.push({
          imapUid: Number(item.uid),
          uidValidity,
          // A Message-ID is optional in practice; the (mailbox, uid) key
          // covers rows that lack one.
          messageId: parsed.messageId?.trim() || null,
          fromAddress,
          fromName: from?.name?.trim() || null,
          toAddresses: addressList(parsed.to),
          ccAddresses: addressList(parsed.cc),
          subject: parsed.subject?.trim() || null,
          bodyText: parsed.text?.trim() || null,
          bodyHtml: typeof parsed.html === "string" ? parsed.html : null,
          // `date` is the sender's Date header and can be absent or a lie;
          // internalDate is when THIS server received it, which is the fact
          // the CRM is actually reporting.
          receivedAt: new Date(item.internalDate ?? parsed.date ?? Date.now()).toISOString(),
          attachments: (parsed.attachments ?? []).map((attachment) => ({
            filename: attachment.filename?.trim() || null,
            mimeType: attachment.contentType?.trim() || null,
            sizeBytes: typeof attachment.size === "number" ? attachment.size : null,
          })),
        });
      } catch {
        // Deliberately swallowed: the thrown value may quote message content.
        failed += 1;
      }
    }

    return { status: "ok", mailbox: mailboxAddress, messages, failed };
  } catch (error) {
    return { status: "error", code: classifyError(error) };
  } finally {
    try {
      await client.logout();
    } catch {
      /* connection already gone */
    }
  }
}
