import "server-only";

import sanitizeHtml from "sanitize-html";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { applyBranchScope, isEmptyScope, withScopedParent } from "@/lib/services/branch-scope-query";
import { findClientsByEmail } from "./clients";
import { getMailboxAddress } from "@/lib/config/mail";
import type { FetchedMessage } from "./email-imap";
import type { BranchScope } from "@/types";

/**
 * ============================================================================
 * MILESTONE 26B-9A — THE CRM'S COPY OF THE MAILBOX
 * ============================================================================
 *
 * Everything the Email page renders comes from here, which reads the database.
 * IMAP is touched only by an explicit Sync; opening the inbox does not open a
 * mail connection, and a message body is never re-fetched from the server to
 * display it.
 */

export type EmailMatchStatus = "unlinked" | "auto_linked" | "manual_linked" | "ambiguous";

export interface EmailAttachmentMeta {
  id: string;
  filename?: string;
  mimeType?: string;
  sizeBytes?: number;
}

export interface EmailMessageListItem {
  id: string;
  /** MILESTONE 26B-9B — which way this message travelled. */
  direction: "inbound" | "outbound";
  fromAddress: string;
  fromName?: string;
  subject?: string;
  /** When it arrived (inbound) or left (outbound) — the single ordering key,
   * resolved by the generated `occurred_at` column. */
  receivedAt: string;
  hasAttachments: boolean;
  attachmentCount: number;
  matchStatus: EmailMatchStatus;
  linkedClientId?: string;
  linkedClientName?: string;
  /** Recipients, so a SENT row can lead with who it went to rather than with
   * ODL's own address — which is the same for every sent message and therefore
   * tells the reader nothing. */
  toAddresses: string[];
}

export interface EmailMessageDetail extends EmailMessageListItem {
  ccAddresses: string[];
  bodyText?: string;
  /** ALREADY SANITISED. See sanitizeEmailHtml — never the raw source. */
  bodySafeHtml?: string;
  attachments: EmailAttachmentMeta[];
  linkedByFullName?: string;
  linkedAt?: string;
}

/**
 * ============================================================================
 * UNTRUSTED CONTENT
 * ============================================================================
 *
 * An email body is authored by whoever sent it. It reaches this CRM having
 * passed through nothing that vouches for it, and staff open it while holding
 * an authenticated session — which is exactly the shape of a stored-XSS
 * delivery. So the HTML is rewritten on the SERVER, before it is ever stored
 * in a prop, using an allow-list.
 *
 * WHAT IS REMOVED, AND WHY EACH ONE:
 *   <script>, <iframe>, <object>, <embed>, <style>
 *       Executable or capable of loading executable content.
 *   on* attributes
 *       Not on the allow-list, so they are dropped — an allow-list means a tag
 *       or attribute nobody thought about is removed by default rather than
 *       permitted by default.
 *   <img> ENTIRELY
 *       Not merely unsafe — a remote image IS the tracking pixel. Rendering it
 *       tells the sender the exact moment ODL staff opened their mail, and for
 *       a spam or phishing sender that confirms the mailbox is live and read.
 *       Dropping the tag is the only reliable way not to make that request.
 *   javascript: and data: URLs
 *       Only http/https/mailto survive on links, so a crafted href cannot
 *       execute or smuggle a payload.
 *
 * Links keep their href but are forced to open detached from this window —
 * `rel="noopener noreferrer"` stops the opened page reaching back through
 * `window.opener`, and stops the CRM URL leaking as a referrer.
 *
 * PLAIN TEXT IS STILL PREFERRED. The UI renders `bodyText` when the message
 * has one, and only falls back to this. Most mail carries both.
 */
export function sanitizeEmailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [
      "p", "br", "hr", "div", "span", "blockquote", "pre", "code",
      "strong", "b", "em", "i", "u", "s", "sub", "sup",
      "h1", "h2", "h3", "h4", "h5", "h6",
      "ul", "ol", "li", "dl", "dt", "dd",
      "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
      "a",
    ],
    allowedAttributes: {
      a: ["href", "title"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    // Belt and braces: these are already absent from allowedTags, but naming
    // them means their CONTENT is discarded too rather than surfacing as loose
    // text if the allow-list is ever widened.
    nonTextTags: ["style", "script", "textarea", "option", "noscript"],
    transformTags: {
      a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }),
    },
  });
}

/**
 * ============================================================================
 * WHO SENT THIS?
 * ============================================================================
 *
 * Deliberately the most conservative rule that is still useful: the sender
 * address, compared exactly and case-insensitively, against clients the CALLER
 * can already reach. Nothing else. No name similarity, no subject parsing, no
 * phone numbers scraped from a body, and no model deciding who a person is —
 * a wrong link here attaches one customer's correspondence to another's file.
 *
 * THREE OUTCOMES, AND ONLY ONE OF THEM IS A LINK:
 *   exactly one match  -> auto_linked
 *   none               -> unlinked   (a prospect, a supplier, or spam)
 *   several            -> ambiguous  (a human decides; never guessed)
 *
 * ODL'S OWN ADDRESS IS NEVER A CUSTOMER. If the mailbox itself appears as the
 * sender the message is left unlinked, even if some client row happens to
 * carry that address — that would link ODL's own mail to a customer file.
 *
 * SCOPE IS THE CALLER'S. findClientsByEmail applies the branch predicate, so a
 * client outside the syncing user's scope cannot be matched, and cannot be
 * discovered by watching whether a link appeared.
 */
async function resolveSenderMatch(
  scope: BranchScope,
  fromAddress: string
): Promise<{ matchStatus: EmailMatchStatus; clientId: string | null }> {
  const mailbox = getMailboxAddress()?.toLowerCase();
  if (mailbox && fromAddress.toLowerCase() === mailbox) {
    return { matchStatus: "unlinked", clientId: null };
  }

  const result = await findClientsByEmail(scope, fromAddress);
  if (result.status !== "ok") return { matchStatus: "unlinked", clientId: null };

  if (result.clients.length === 1) {
    return { matchStatus: "auto_linked", clientId: result.clients[0].id };
  }
  if (result.clients.length > 1) {
    return { matchStatus: "ambiguous", clientId: null };
  }
  return { matchStatus: "unlinked", clientId: null };
}

export interface PersistSyncResult {
  imported: number;
  /** Already present — the idempotency path, not an error. */
  skipped: number;
  failed: number;
}

/**
 * Writes fetched messages, skipping ones already held.
 *
 * IDEMPOTENCY IS THE DATABASE'S JOB, NOT THIS FUNCTION'S. Two unique indexes
 * (mailbox+folder+uidValidity+uid, and mailbox+message_id) make a duplicate
 * unrepresentable; this inserts row by row and reads 23505 as "already known".
 * A read-then-insert check would race with itself the moment two people press
 * Sync at the same moment, and would still need the constraint to be correct.
 *
 * ROW BY ROW ON PURPOSE. A batch insert would abort the whole sync on one bad
 * message; per-row insert lets a single unparseable or duplicate message be
 * counted and stepped over.
 */
export async function persistFetchedMessages(
  scope: BranchScope,
  mailbox: string,
  messages: FetchedMessage[]
): Promise<PersistSyncResult> {
  const supabase = getSupabaseServerClient();
  let imported = 0;
  let skipped = 0;
  let failed = 0;

  for (const message of messages) {
    try {
      const match = await resolveSenderMatch(scope, message.fromAddress);

      const { data, error } = await supabase
        .from("email_messages")
        .insert({
          mailbox,
          folder: "INBOX",
          imap_uid: message.imapUid,
          uid_validity: message.uidValidity,
          message_id: message.messageId,
          direction: "inbound",
          from_address: message.fromAddress,
          from_name: message.fromName,
          to_addresses: message.toAddresses,
          cc_addresses: message.ccAddresses,
          subject: message.subject,
          body_text: message.bodyText,
          body_html: message.bodyHtml,
          received_at: message.receivedAt,
          has_attachments: message.attachments.length > 0,
          attachment_count: message.attachments.length,
          linked_client_id: match.clientId,
          match_status: match.matchStatus,
        })
        .select("id")
        .single<{ id: string }>();

      if (error) {
        // 23505 — one of the two idempotency indexes fired. This is the normal
        // outcome of pressing Sync twice and is not a failure.
        if (error.code === "23505") {
          skipped += 1;
          continue;
        }
        console.error("[email service] Failed to persist message:", error.code ?? error.message);
        failed += 1;
        continue;
      }

      if (message.attachments.length > 0) {
        // METADATA ONLY — filename, type, size. No bytes are downloaded and
        // nothing here can become requirement evidence.
        const { error: attachmentError } = await supabase.from("email_attachments").insert(
          message.attachments.map((attachment) => ({
            email_message_id: data.id,
            filename: attachment.filename,
            mime_type: attachment.mimeType,
            size_bytes: attachment.sizeBytes,
          }))
        );
        if (attachmentError) {
          // The message itself is stored and useful; losing its attachment
          // metadata is not worth discarding it.
          console.error(
            "[email service] Message stored but attachment metadata failed:",
            attachmentError.code ?? attachmentError.message
          );
        }
      }

      imported += 1;
    } catch (error) {
      console.error(
        "[email service] Unexpected failure persisting a message:",
        error instanceof Error ? error.message : "unknown error"
      );
      failed += 1;
    }
  }

  return { imported, skipped, failed };
}

const MESSAGE_SELECT =
  "id, direction, from_address, from_name, subject, received_at, sent_at, occurred_at, " +
  "has_attachments, attachment_count, " +
  "match_status, linked_client_id, to_addresses, cc_addresses, bcc_addresses, body_text, body_html, linked_at, " +
  "reply_to_email_id, in_reply_to, " +
  "linked_client:clients!email_messages_linked_client_id_fkey(full_name), " +
  "linked_by:profiles!email_messages_linked_by_profile_id_fkey(full_name)";

interface EmailRow {
  id: string;
  direction: "inbound" | "outbound";
  from_address: string;
  from_name: string | null;
  subject: string | null;
  received_at: string | null;
  sent_at: string | null;
  occurred_at: string;
  has_attachments: boolean;
  attachment_count: number;
  match_status: EmailMatchStatus;
  linked_client_id: string | null;
  to_addresses: string[] | null;
  cc_addresses: string[] | null;
  bcc_addresses: string[] | null;
  reply_to_email_id: string | null;
  in_reply_to: string | null;
  body_text: string | null;
  body_html: string | null;
  linked_at: string | null;
  linked_client: { full_name: string } | null;
  linked_by: { full_name: string } | null;
}

function toListItem(row: EmailRow): EmailMessageListItem {
  return {
    id: row.id,
    direction: row.direction,
    fromAddress: row.from_address,
    fromName: row.from_name ?? undefined,
    subject: row.subject ?? undefined,
    receivedAt: row.occurred_at,
    hasAttachments: row.has_attachments,
    attachmentCount: row.attachment_count,
    matchStatus: row.match_status,
    linkedClientId: row.linked_client_id ?? undefined,
    linkedClientName: row.linked_client?.full_name ?? undefined,
    toAddresses: row.to_addresses ?? [],
  };
}

export type EmailFilter = "all" | "linked" | "unlinked";
/** MILESTONE 26B-9B — Recibidos / Enviados, alongside the link filter. */
export type EmailDirectionFilter = "all" | "inbound" | "outbound";

export type GetEmailMessagesResult =
  | { status: "ok"; messages: EmailMessageListItem[] }
  | { status: "error" };

/**
 * The inbox list.
 *
 * BOUNDED. A mailbox grows without limit and a page that renders all of it
 * would get slower every week; the newest `limit` is what an operator actually
 * works from.
 *
 * SCOPE, AND WHY UNLINKED IS SEPARATE. A LINKED message inherits the branch of
 * the client it points at, so it is filtered by joining through `clients` with
 * the same predicate every other read uses. An UNLINKED message has no client
 * and therefore no branch — it cannot be scoped at all, which is exactly why
 * the caller must hold mailbox-level authorization to ask for it (enforced in
 * the Server Action, and reflected by `includeUnlinked` here).
 */
export async function getEmailMessages(
  scope: BranchScope,
  options: {
    filter: EmailFilter;
    direction?: EmailDirectionFilter;
    search?: string;
    limit?: number;
    includeUnlinked: boolean;
  }
): Promise<GetEmailMessagesResult> {
  if (isEmptyScope(scope)) return { status: "ok", messages: [] };

  const limit = options.limit ?? 100;
  // Expressed as a set so one `.in()` serves all three states and "all" needs
  // no branch of its own.
  const directions =
    options.direction === "inbound"
      ? ["inbound"]
      : options.direction === "outbound"
        ? ["outbound"]
        : ["inbound", "outbound"];

  try {
    const supabase = getSupabaseServerClient();

    // Two disjoint reads rather than one clever query: a linked message is
    // scoped through its client, an unlinked one has nothing to scope through,
    // and expressing both as a single OR would either leak the unlinked queue
    // into a branch user's list or scope away every unlinked row for everyone.
    const linkedPromise =
      options.filter === "unlinked"
        ? null
        : applyBranchScope(
            supabase
              .from("email_messages")
              .select(withScopedParent(MESSAGE_SELECT, scope, "scope_client:clients!inner(branch_id)"))
              .in("match_status", ["auto_linked", "manual_linked"])
            .in("direction", directions),
            scope,
            "scope_client.branch_id"
          )
            .order("occurred_at", { ascending: false })
            .limit(limit);

    const unlinkedPromise =
      options.filter === "linked" || !options.includeUnlinked
        ? null
        : supabase
            .from("email_messages")
            .select(MESSAGE_SELECT)
            .in("match_status", ["unlinked", "ambiguous"])
            .in("direction", directions)
            .order("occurred_at", { ascending: false })
            .limit(limit);

    const [linkedResult, unlinkedResult] = await Promise.all([linkedPromise, unlinkedPromise]);

    if (linkedResult?.error) {
      console.error("[email service] Failed to load linked messages:", linkedResult.error.message);
      return { status: "error" };
    }
    if (unlinkedResult?.error) {
      console.error("[email service] Failed to load unlinked messages:", unlinkedResult.error.message);
      return { status: "error" };
    }

    const rows = [
      ...((linkedResult?.data ?? []) as unknown as EmailRow[]),
      ...((unlinkedResult?.data ?? []) as unknown as EmailRow[]),
    ];

    const term = options.search?.trim().toLowerCase();
    const filtered = term
      ? rows.filter(
          (row) =>
            row.from_address.toLowerCase().includes(term) ||
            // Sent mail is found by who it went TO, not who it came from.
            (row.to_addresses ?? []).some((address) => address.toLowerCase().includes(term)) ||
            (row.subject ?? "").toLowerCase().includes(term) ||
            (row.linked_client?.full_name ?? "").toLowerCase().includes(term)
        )
      : rows;

    filtered.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
    return { status: "ok", messages: filtered.slice(0, limit).map(toListItem) };
  } catch (error) {
    console.error(
      "[email service] Unexpected failure loading messages:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

export type GetEmailMessageResult =
  | { status: "ok"; message: EmailMessageDetail }
  | { status: "not_found" }
  | { status: "error" };

/**
 * One message, with its body already made safe to render.
 *
 * OUT OF SCOPE READS AS NOT FOUND, deliberately: distinguishing "you may not
 * see this" from "this does not exist" tells an unauthorized reader that a
 * message exists, which is itself the disclosure.
 */
export async function getEmailMessageById(
  scope: BranchScope,
  id: string,
  includeUnlinked: boolean
): Promise<GetEmailMessageResult> {
  if (isEmptyScope(scope)) return { status: "not_found" };

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("email_messages")
      .select(MESSAGE_SELECT)
      .eq("id", id)
      .maybeSingle<EmailRow>();

    if (error) {
      console.error("[email service] Failed to load message:", error.message);
      return { status: "error" };
    }
    if (!data) return { status: "not_found" };

    if (data.linked_client_id) {
      // Scope is re-checked against the CLIENT, not assumed from the fact that
      // the caller knew an id.
      const accessible = await applyBranchScope(
        supabase.from("clients").select("id").eq("id", data.linked_client_id),
        scope
      );
      if (accessible.error || (accessible.data ?? []).length === 0) return { status: "not_found" };
    } else if (!includeUnlinked) {
      return { status: "not_found" };
    }

    const { data: attachmentRows } = await supabase
      .from("email_attachments")
      .select("id, filename, mime_type, size_bytes")
      .eq("email_message_id", id);

    return {
      status: "ok",
      message: {
        ...toListItem(data),
        ccAddresses: data.cc_addresses ?? [],
        bodyText: data.body_text ?? undefined,
        bodySafeHtml: data.body_html ? sanitizeEmailHtml(data.body_html) : undefined,
        linkedByFullName: data.linked_by?.full_name ?? undefined,
        linkedAt: data.linked_at ?? undefined,
        attachments: (
          (attachmentRows ?? []) as { id: string; filename: string | null; mime_type: string | null; size_bytes: number | null }[]
        ).map((row) => ({
          id: row.id,
          filename: row.filename ?? undefined,
          mimeType: row.mime_type ?? undefined,
          sizeBytes: row.size_bytes ?? undefined,
        })),
      },
    };
  } catch (error) {
    console.error(
      "[email service] Unexpected failure loading a message:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

export type LinkEmailResult =
  | { status: "ok" }
  | { status: "error"; code: "NOT_FOUND" | "CLIENT_NOT_ACCESSIBLE" | "UPDATE_FAILED" };

/**
 * Attaches a message to a customer, or detaches it.
 *
 * THE BROWSER CANNOT ESTABLISH OWNERSHIP BY ASSERTING IT. A submitted client
 * id is re-read through the caller's own branch scope before it is written, so
 * a hand-crafted request naming a client in another branch is rejected as
 * inaccessible rather than silently honoured.
 *
 * MANUAL ALWAYS OUTRANKS AUTOMATIC. Correcting an auto-match writes
 * `manual_linked` with the actor and timestamp, so the record never claims a
 * person's decision was the computer's — or the reverse.
 *
 * UNLINKING RETURNS TO `unlinked`, NOT TO THE PREVIOUS AUTO-MATCH. Staff
 * removing a link are saying the automatic answer was wrong; re-deriving it on
 * the next read would put it straight back.
 */
export async function setEmailMessageLink(
  scope: BranchScope,
  messageId: string,
  clientId: string | null,
  actorProfileId: string
): Promise<LinkEmailResult> {
  const supabase = getSupabaseServerClient();

  try {
    const { data: existing, error: readError } = await supabase
      .from("email_messages")
      .select("id, linked_client_id")
      .eq("id", messageId)
      .maybeSingle<{ id: string; linked_client_id: string | null }>();

    if (readError) {
      console.error("[email service] Failed to read message for linking:", readError.message);
      return { status: "error", code: "UPDATE_FAILED" };
    }
    if (!existing) return { status: "error", code: "NOT_FOUND" };

    // Re-linking a message that is currently attached to a client the caller
    // cannot see would let a branch user detach another branch's mail.
    if (existing.linked_client_id) {
      const current = await applyBranchScope(
        supabase.from("clients").select("id").eq("id", existing.linked_client_id),
        scope
      );
      if (current.error || (current.data ?? []).length === 0) {
        return { status: "error", code: "NOT_FOUND" };
      }
    }

    if (clientId === null) {
      const { error } = await supabase
        .from("email_messages")
        .update({
          linked_client_id: null,
          linked_application_id: null,
          match_status: "unlinked",
          linked_by_profile_id: actorProfileId,
          linked_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", messageId);

      if (error) {
        console.error("[email service] Failed to unlink message:", error.message);
        return { status: "error", code: "UPDATE_FAILED" };
      }
      return { status: "ok" };
    }

    const target = await applyBranchScope(
      supabase.from("clients").select("id").eq("id", clientId),
      scope
    );
    if (target.error || (target.data ?? []).length === 0) {
      return { status: "error", code: "CLIENT_NOT_ACCESSIBLE" };
    }

    const { error } = await supabase
      .from("email_messages")
      .update({
        linked_client_id: clientId,
        match_status: "manual_linked",
        linked_by_profile_id: actorProfileId,
        linked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", messageId);

    if (error) {
      console.error("[email service] Failed to link message:", error.message);
      return { status: "error", code: "UPDATE_FAILED" };
    }
    return { status: "ok" };
  } catch (error) {
    console.error(
      "[email service] Unexpected failure linking a message:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error", code: "UPDATE_FAILED" };
  }
}

export interface EmailSyncState {
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastImportedCount?: number;
  lastErrorCode?: string;
}

export async function getEmailSyncState(mailbox: string): Promise<EmailSyncState | null> {
  try {
    const supabase = getSupabaseServerClient();
    const { data } = await supabase
      .from("email_sync_state")
      .select("last_attempt_at, last_success_at, last_imported_count, last_error_code")
      .eq("mailbox", mailbox)
      .maybeSingle<{
        last_attempt_at: string | null;
        last_success_at: string | null;
        last_imported_count: number | null;
        last_error_code: string | null;
      }>();

    if (!data) return null;
    return {
      lastAttemptAt: data.last_attempt_at ?? undefined,
      lastSuccessAt: data.last_success_at ?? undefined,
      lastImportedCount: data.last_imported_count ?? undefined,
      lastErrorCode: data.last_error_code ?? undefined,
    };
  } catch {
    return null;
  }
}

/** Records the outcome of a sync attempt. Stores codes and counts — never a
 * credential, and never a raw server string. */
export async function recordSyncOutcome(
  mailbox: string,
  outcome: { success: boolean; imported?: number; skipped?: number; errorCode?: string }
): Promise<void> {
  try {
    const supabase = getSupabaseServerClient();
    const now = new Date().toISOString();
    await supabase.from("email_sync_state").upsert(
      {
        mailbox,
        last_attempt_at: now,
        ...(outcome.success
          ? {
              last_success_at: now,
              last_imported_count: outcome.imported ?? 0,
              last_skipped_count: outcome.skipped ?? 0,
              last_error_code: null,
            }
          : { last_error_code: outcome.errorCode ?? "unknown" }),
        updated_at: now,
      },
      { onConflict: "mailbox" }
    );
  } catch (error) {
    // A missing status row must never fail a sync that actually worked.
    console.error(
      "[email service] Failed to record sync outcome:",
      error instanceof Error ? error.message : "unknown error"
    );
  }
}

/**
 * ============================================================================
 * MILESTONE 26B-9B — OUTBOUND
 * ============================================================================
 */

/** RFC 5322 is far looser than this; the goal is to reject obvious mistakes,
 * not to litigate the standard. Anything that passes still has to be accepted
 * by the receiving server. */
const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export interface RecipientParseResult {
  valid: string[];
  invalid: string[];
}

/**
 * Splits, trims, lowercases and de-duplicates a recipient list.
 *
 * INVALID ADDRESSES ARE RETURNED, NOT DROPPED. Silently discarding a
 * mistyped recipient means staff believe they wrote to someone they did not —
 * the caller surfaces them so the person can fix the typo.
 *
 * DE-DUPLICATION IS CASE-INSENSITIVE because mail addresses are, in practice:
 * `Juan@x.com` and `juan@x.com` are one person and must not receive two copies.
 */
export function parseRecipients(raw: string | string[]): RecipientParseResult {
  const parts = (Array.isArray(raw) ? raw : raw.split(/[,;\n]/))
    .map((value) => value.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];

  for (const part of parts) {
    const normalised = part.toLowerCase();
    if (!EMAIL_PATTERN.test(normalised)) {
      invalid.push(part);
      continue;
    }
    if (seen.has(normalised)) continue;
    seen.add(normalised);
    valid.push(normalised);
  }

  return { valid, invalid };
}

export interface PersistOutboundInput {
  mailbox: string;
  messageId: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyText: string;
  sentAt: string;
  sentByProfileId: string;
  linkedClientId: string | null;
  linkedApplicationId: string | null;
  replyToEmailId: string | null;
  forwardedFromEmailId: string | null;
  inReplyTo: string | null;
  sendKey: string;
}

export type PersistOutboundResult =
  | { status: "ok"; id: string }
  | { status: "duplicate" }
  | { status: "error" };

/**
 * Records a message the CRM has ALREADY SENT.
 *
 * Called only after SMTP confirmed acceptance, so this row is a statement of
 * fact rather than an intention. `match_status` follows the same vocabulary as
 * inbound: a message sent from a customer's dossier is `manual_linked`, because
 * a person chose that customer — nothing here was matched by machine.
 *
 * A `send_key` collision returns `duplicate` rather than an error: it means the
 * same compose was submitted twice, which the caller reports as success for the
 * first send rather than as a failure.
 */
export async function persistOutboundMessage(
  input: PersistOutboundInput
): Promise<PersistOutboundResult> {
  const supabase = getSupabaseServerClient();

  const { data, error } = await supabase
    .from("email_messages")
    .insert({
      mailbox: input.mailbox,
      folder: "SENT",
      direction: "outbound",
      message_id: input.messageId,
      from_address: input.mailbox,
      to_addresses: input.to,
      cc_addresses: input.cc,
      bcc_addresses: input.bcc,
      subject: input.subject,
      body_text: input.bodyText,
      sent_at: input.sentAt,
      sent_by_profile_id: input.sentByProfileId,
      linked_client_id: input.linkedClientId,
      linked_application_id: input.linkedApplicationId,
      match_status: input.linkedClientId ? "manual_linked" : "unlinked",
      linked_by_profile_id: input.linkedClientId ? input.sentByProfileId : null,
      linked_at: input.linkedClientId ? input.sentAt : null,
      reply_to_email_id: input.replyToEmailId,
      forwarded_from_email_id: input.forwardedFromEmailId,
      in_reply_to: input.inReplyTo,
      send_key: input.sendKey,
      has_attachments: false,
      attachment_count: 0,
    })
    .select("id")
    .single<{ id: string }>();

  if (error) {
    if (error.code === "23505") return { status: "duplicate" };
    console.error("[email service] Failed to persist outbound message:", error.code ?? error.message);
    return { status: "error" };
  }
  return { status: "ok", id: data.id };
}

export interface ReplyContext {
  id: string;
  messageId?: string;
  fromAddress: string;
  toAddresses: string[];
  ccAddresses: string[];
  subject?: string;
  bodyText?: string;
  linkedClientId?: string;
  linkedApplicationId?: string;
  direction: "inbound" | "outbound";
  occurredAt: string;
}

export type GetReplyContextResult =
  | { status: "ok"; context: ReplyContext }
  | { status: "not_found" }
  | { status: "error" };

/**
 * Loads the message a reply or forward is built from, through the caller's
 * scope.
 *
 * THE CONTEXT IS RE-READ SERVER-SIDE rather than trusted from the browser: the
 * recipient of a reply, and the customer it stays attached to, are decided from
 * the stored row. A request that names a message the caller cannot reach gets
 * `not_found`, which is also what a non-existent id gets.
 */
export async function getReplyContext(
  scope: BranchScope,
  emailId: string,
  includeUnlinked: boolean
): Promise<GetReplyContextResult> {
  if (isEmptyScope(scope)) return { status: "not_found" };

  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await supabase
      .from("email_messages")
      .select(
        "id, message_id, from_address, to_addresses, cc_addresses, subject, body_text, " +
          "linked_client_id, linked_application_id, direction, occurred_at"
      )
      .eq("id", emailId)
      .maybeSingle<{
        id: string;
        message_id: string | null;
        from_address: string;
        to_addresses: string[] | null;
        cc_addresses: string[] | null;
        subject: string | null;
        body_text: string | null;
        linked_client_id: string | null;
        linked_application_id: string | null;
        direction: "inbound" | "outbound";
        occurred_at: string;
      }>();

    if (error) {
      console.error("[email service] Failed to load reply context:", error.message);
      return { status: "error" };
    }
    if (!data) return { status: "not_found" };

    if (data.linked_client_id) {
      const accessible = await applyBranchScope(
        supabase.from("clients").select("id").eq("id", data.linked_client_id),
        scope
      );
      if (accessible.error || (accessible.data ?? []).length === 0) return { status: "not_found" };
    } else if (!includeUnlinked) {
      return { status: "not_found" };
    }

    return {
      status: "ok",
      context: {
        id: data.id,
        messageId: data.message_id ?? undefined,
        fromAddress: data.from_address,
        toAddresses: data.to_addresses ?? [],
        ccAddresses: data.cc_addresses ?? [],
        subject: data.subject ?? undefined,
        bodyText: data.body_text ?? undefined,
        linkedClientId: data.linked_client_id ?? undefined,
        linkedApplicationId: data.linked_application_id ?? undefined,
        direction: data.direction,
        occurredAt: data.occurred_at,
      },
    };
  } catch (error) {
    console.error(
      "[email service] Unexpected failure loading reply context:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

/**
 * Emails belonging to one customer, both directions.
 *
 * SCOPED THROUGH THE CLIENT, which is the whole authorization story: if the
 * caller can reach the client they can read that client's correspondence, and
 * if they cannot, this returns nothing. No separate ownership rule was invented
 * for email — the dossier's existing boundary is reused, so an advisor sees the
 * mail for customers they already work and nothing else. Unlinked global mail
 * has no client and therefore never appears here.
 */
export async function getClientEmails(
  scope: BranchScope,
  clientId: string,
  limit = 25
): Promise<GetEmailMessagesResult> {
  if (isEmptyScope(scope)) return { status: "ok", messages: [] };

  try {
    const supabase = getSupabaseServerClient();

    const accessible = await applyBranchScope(
      supabase.from("clients").select("id").eq("id", clientId),
      scope
    );
    if (accessible.error || (accessible.data ?? []).length === 0) {
      return { status: "ok", messages: [] };
    }

    const { data, error } = await supabase
      .from("email_messages")
      .select(MESSAGE_SELECT)
      .eq("linked_client_id", clientId)
      .order("occurred_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.error("[email service] Failed to load client emails:", error.message);
      return { status: "error" };
    }

    return { status: "ok", messages: ((data ?? []) as unknown as EmailRow[]).map(toListItem) };
  } catch (error) {
    console.error(
      "[email service] Unexpected failure loading client emails:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}

/** Is this client inside the caller's branch scope? The single question every
 * "the browser sent me an id" path has to answer before trusting it. */
export async function isClientAccessible(scope: BranchScope, clientId: string): Promise<boolean> {
  if (isEmptyScope(scope)) return false;
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await applyBranchScope(
      supabase.from("clients").select("id").eq("id", clientId),
      scope
    );
    return !error && (data ?? []).length > 0;
  } catch {
    return false;
  }
}

/** Is this application both reachable AND actually this client's? The second
 * half matters: a customer may have several processes, and filing a message
 * against the wrong one is a quieter error than filing it against the wrong
 * person but just as wrong. */
export async function isApplicationAccessible(
  scope: BranchScope,
  applicationId: string,
  clientId: string
): Promise<boolean> {
  if (isEmptyScope(scope)) return false;
  try {
    const supabase = getSupabaseServerClient();
    const { data, error } = await applyBranchScope(
      supabase
        .from("applications")
        .select("id")
        .eq("id", applicationId)
        .eq("client_id", clientId),
      scope
    );
    return !error && (data ?? []).length > 0;
  } catch {
    return false;
  }
}

/**
 * Records "we wrote to them" in the customer's activity.
 *
 * THROUGH AN RPC, NOT A DIRECT INSERT. `crm_events` grants service_role SELECT
 * only — every event in this system is written from inside a SECURITY DEFINER
 * function, which is what keeps the audit log closed to ordinary application
 * code. A first attempt here inserted directly and was silently refused: the
 * email sent, the row saved, and the customer's activity stayed empty. Widening
 * the grant would have fixed the symptom by opening the audit log to anything
 * holding the service role; calling an RPC gives email the same treatment
 * alerts and advisor assignments already get.
 *
 * SUBJECT AND ID ONLY — never the body. `crm_events` is append-only with no
 * delete path, so a message copied into it could never be corrected or erased.
 *
 * NON-FATAL BY DESIGN. The email has already been sent and recorded; failing
 * the operation because a history row did not write would report a success as
 * a failure.
 */
export async function recordEmailSentEvent(input: {
  emailId: string;
  clientId: string | null;
  applicationId: string | null;
  subject: string;
  actorProfileId: string;
}): Promise<void> {
  // No customer means no customer activity to append to. The RPC also guards
  // this; returning early saves a round trip.
  if (!input.clientId) return;

  try {
    const supabase = getSupabaseServerClient();
    const { error } = await supabase.rpc("record_email_sent_event", {
      p_email_id: input.emailId,
      p_client_id: input.clientId,
      p_application_id: input.applicationId,
      p_subject: input.subject,
      p_actor_profile_id: input.actorProfileId,
    });
    if (error) {
      console.error("[email service] Failed to record email_sent activity:", error.message);
    }
  } catch (error) {
    console.error(
      "[email service] Failed to record email_sent activity:",
      error instanceof Error ? error.message : "unknown error"
    );
  }
}
