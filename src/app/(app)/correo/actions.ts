"use server";

import { requireCapability } from "@/lib/auth/authorize";
import { getMailboxAddress } from "@/lib/config/mail";
import { fetchRecentMessages, type MailErrorCode } from "@/lib/services/email-imap";
import { sendMail, type SmtpErrorCode } from "@/lib/services/email-smtp";
import {
  getReplyContext,
  isApplicationAccessible,
  isClientAccessible,
  parseRecipients,
  persistFetchedMessages,
  persistOutboundMessage,
  recordEmailSentEvent,
  recordSyncOutcome,
  setEmailMessageLink,
} from "@/lib/services/email-messages";
import { revalidatePath } from "next/cache";

/**
 * ============================================================================
 * MILESTONE 26B-9A — MAILBOX ACTIONS
 * ============================================================================
 *
 * Two mutations, both `email:manage`, both server-authorized before they
 * validate anything — the same order every action in this app uses, because a
 * validation error returned to someone who was never allowed to call is itself
 * a disclosure.
 *
 * THESE RUN IN THE NODE RUNTIME. Server Actions in this app are Node by
 * default and IMAP is a raw TCP protocol: it cannot run on Edge, and the
 * `server-only` marker on the config and IMAP modules makes a client import a
 * build error rather than a runtime surprise.
 *
 * NOTHING HERE SENDS MAIL. There is no transport, no Compose, no Reply.
 */

/** The bounded window a normal sync reads. See the action's note.
 *
 * Not exported: a "use server" module may only export async functions, and a
 * shared constant here would become a Server Action boundary for no reason. */
const DEFAULT_SYNC_LIMIT = 50;

export type SyncEmailResult =
  | { status: "success"; imported: number; skipped: number; failed: number }
  | { status: "error"; code: "UNAUTHENTICATED" | "FORBIDDEN" | MailErrorCode };

/**
 * Pulls the newest messages from INBOX and stores the ones not already held.
 *
 * BOUNDED, NEVER A FULL HISTORICAL IMPORT. ODL's mailbox already holds years
 * of operational mail; importing all of it in one click would be slow, would
 * be impossible to review, and would bury the recent messages that actually
 * need working. 50 is the routine window — comfortably more than a day's mail
 * for this business, so nothing is missed between syncs, while staying small
 * enough to complete inside one request.
 *
 * THE COUNTS ARE THE HONEST OUTCOME. `skipped` is messages already held, which
 * is what a second press should report; it is not an error and is not hidden.
 */
export async function syncEmailAction(limit?: number): Promise<SyncEmailResult> {
  const auth = await requireCapability("email:manage");
  if (auth.status === "denied") return { status: "error", code: auth.code };

  const mailbox = getMailboxAddress();
  if (!mailbox) return { status: "error", code: "not_configured" };

  const window = limit && limit > 0 && limit <= 200 ? limit : DEFAULT_SYNC_LIMIT;

  const fetched = await fetchRecentMessages(window);
  if (fetched.status === "error") {
    await recordSyncOutcome(mailbox, { success: false, errorCode: fetched.code });
    return { status: "error", code: fetched.code };
  }

  const persisted = await persistFetchedMessages(auth.profile.branchScope, mailbox, fetched.messages);
  await recordSyncOutcome(mailbox, {
    success: true,
    imported: persisted.imported,
    skipped: persisted.skipped,
  });

  revalidatePath("/correo");
  return {
    status: "success",
    imported: persisted.imported,
    skipped: persisted.skipped,
    // Parse failures at the IMAP layer and persistence failures are both
    // "this message did not make it", and are reported as one number.
    failed: persisted.failed + fetched.failed,
  };
}

export interface LinkEmailInput {
  messageId: string;
  /** null removes the link. */
  clientId: string | null;
}

export type LinkEmailActionResult =
  | { status: "success" }
  | {
      status: "error";
      code: "UNAUTHENTICATED" | "FORBIDDEN" | "INVALID_INPUT" | "NOT_FOUND" | "CLIENT_NOT_ACCESSIBLE" | "UPDATE_FAILED";
    };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Links a message to a customer, changes an existing link, or removes one.
 *
 * THE CLIENT ID IS A REQUEST, NOT A GRANT. It is re-read through the caller's
 * own branch scope in the service before anything is written, so submitting
 * another branch's client id is rejected as inaccessible. The browser never
 * establishes ownership by asserting it.
 */
export async function setEmailLinkAction(input: LinkEmailInput): Promise<LinkEmailActionResult> {
  const auth = await requireCapability("email:manage");
  if (auth.status === "denied") return { status: "error", code: auth.code };

  if (!input.messageId || !UUID_PATTERN.test(input.messageId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (input.clientId !== null && !UUID_PATTERN.test(input.clientId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const result = await setEmailMessageLink(
    auth.profile.branchScope,
    input.messageId,
    input.clientId,
    auth.profile.id
  );
  if (result.status === "error") return { status: "error", code: result.code };

  revalidatePath("/correo");
  return { status: "success" };
}

// ============================================================================
// MILESTONE 26B-9B — SENDING
// ============================================================================

export type SendEmailMode = "compose" | "reply" | "reply_all" | "forward";

export interface SendEmailInput {
  mode: SendEmailMode;
  /** Free text; parsed, validated and de-duplicated server-side. */
  to: string;
  cc?: string;
  subject: string;
  body: string;
  /** The inbound/outbound message this replies to or forwards. */
  contextEmailId?: string;
  /** Only honoured when the caller can actually reach this client. */
  clientId?: string;
  applicationId?: string;
  /**
   * Idempotency token minted by the browser per compose. A double-submitted
   * form carries the SAME key, so the second insert collides on the unique
   * index instead of delivering a second email.
   */
  sendKey: string;
}

export type SendEmailResult =
  | { status: "success"; emailId: string }
  /** Delivered, but the CRM could not record it. Deliberately distinct from
   * both success and failure — see the action's note. */
  | { status: "sent_not_recorded" }
  | { status: "duplicate" }
  | { status: "invalid"; invalidRecipients: string[] }
  | {
      status: "error";
      code:
        | "UNAUTHENTICATED"
        | "FORBIDDEN"
        | "INVALID_INPUT"
        | "CLIENT_NOT_ACCESSIBLE"
        | "CONTEXT_NOT_FOUND"
        | SmtpErrorCode
        | "uncertain";
    };

/**
 * ============================================================================
 * THE ONE SEND PATH
 * ============================================================================
 *
 * Compose, Reply, Reply All and Forward all arrive here. They differ only in
 * what the browser pre-filled; the authorization, validation, recipient
 * handling, sending and recording are identical, because four copies of this
 * would be four chances to get one of them wrong.
 *
 * ----------------------------------------------------------------------------
 * WHAT THE BROWSER CANNOT DECIDE
 * ----------------------------------------------------------------------------
 * The sender. The mailbox. The credential. And, crucially, WHICH CUSTOMER a
 * message is filed against: a submitted `clientId` is re-read through the
 * caller's own branch scope before it is written, and a reply's linkage is
 * taken from the stored original rather than from the request at all.
 *
 * ----------------------------------------------------------------------------
 * SMTP SUCCESS WITH A FAILED WRITE IS NOT A FAILURE
 * ----------------------------------------------------------------------------
 * These two steps cannot be made atomic — one is a remote mail server, the
 * other a database. Once the mail is accepted it is GONE, and no rollback
 * exists. So a persistence failure afterwards returns `sent_not_recorded`,
 * which tells the operator the customer did receive the message and only the
 * CRM's copy is missing. Reporting that as an error would invite them to send
 * again; reporting it as success would quietly lose the history.
 *
 * AN UNCERTAIN SEND IS NEVER RETRIED. If the connection died after the payload
 * was handed over, nobody knows whether it arrived. A duplicate email from a
 * lender cannot be withdrawn, while a missing history row can be reconciled by
 * a person — so the uncertainty is surfaced and the decision left to a human.
 */
export async function sendEmailAction(input: SendEmailInput): Promise<SendEmailResult> {
  const auth = await requireCapability("email:manage");
  if (auth.status === "denied") return { status: "error", code: auth.code };

  const mailbox = getMailboxAddress();
  if (!mailbox) return { status: "error", code: "not_configured" };

  if (!input.sendKey || input.sendKey.length < 8 || input.sendKey.length > 100) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  const subject = input.subject?.trim() ?? "";
  const body = input.body?.trim() ?? "";
  if (!subject || !body) return { status: "error", code: "INVALID_INPUT" };

  const toParsed = parseRecipients(input.to ?? "");
  const ccParsed = parseRecipients(input.cc ?? "");
  // Invalid addresses are reported, never silently dropped: staff must not
  // believe they wrote to someone they mistyped.
  if (toParsed.invalid.length > 0 || ccParsed.invalid.length > 0) {
    return { status: "invalid", invalidRecipients: [...toParsed.invalid, ...ccParsed.invalid] };
  }
  if (toParsed.valid.length === 0) return { status: "error", code: "INVALID_INPUT" };

  // ---- Context: what this replies to, and who it belongs to ---------------
  let replyToEmailId: string | null = null;
  let forwardedFromEmailId: string | null = null;
  let inReplyTo: string | null = null;
  let references: string[] = [];
  let linkedClientId: string | null = null;
  let linkedApplicationId: string | null = null;

  if (input.contextEmailId) {
    const context = await getReplyContext(auth.profile.branchScope, input.contextEmailId, true);
    if (context.status !== "ok") return { status: "error", code: "CONTEXT_NOT_FOUND" };

    if (input.mode === "forward") {
      forwardedFromEmailId = context.context.id;
      // A forward goes to whoever staff chose. It does NOT inherit the
      // original's customer — the new recipient is usually a third party, and
      // filing the message under that customer would misattribute it.
    } else {
      replyToEmailId = context.context.id;
      inReplyTo = context.context.messageId ?? null;
      references = context.context.messageId ? [context.context.messageId] : [];
      // A reply stays with the conversation it answers. Taken from the stored
      // row, so the browser cannot re-file someone else's thread.
      linkedClientId = context.context.linkedClientId ?? null;
      linkedApplicationId = context.context.linkedApplicationId ?? null;
    }
  }

  // An explicitly chosen customer (dossier compose, or a forward staff filed
  // deliberately) is validated against the caller's scope before it is trusted.
  if (!linkedClientId && input.clientId) {
    if (!UUID_PATTERN.test(input.clientId)) return { status: "error", code: "INVALID_INPUT" };
    const accessible = await isClientAccessible(auth.profile.branchScope, input.clientId);
    if (!accessible) return { status: "error", code: "CLIENT_NOT_ACCESSIBLE" };
    linkedClientId = input.clientId;
    if (input.applicationId) {
      if (!UUID_PATTERN.test(input.applicationId)) return { status: "error", code: "INVALID_INPUT" };
      const application = await isApplicationAccessible(
        auth.profile.branchScope,
        input.applicationId,
        linkedClientId
      );
      if (!application) return { status: "error", code: "CLIENT_NOT_ACCESSIBLE" };
      linkedApplicationId = input.applicationId;
    }
  }

  // ---- Send ---------------------------------------------------------------
  const sent = await sendMail({
    to: toParsed.valid,
    cc: ccParsed.valid,
    subject,
    text: body,
    inReplyTo: inReplyTo ?? undefined,
    references,
  });

  if (sent.status === "uncertain") {
    // No retry. See the header.
    return { status: "error", code: "uncertain" };
  }
  if (sent.status === "error") {
    return { status: "error", code: sent.code };
  }

  // ---- Record -------------------------------------------------------------
  const persisted = await persistOutboundMessage({
    mailbox,
    messageId: sent.messageId,
    to: toParsed.valid,
    cc: ccParsed.valid,
    bcc: [],
    subject,
    bodyText: body,
    sentAt: new Date().toISOString(),
    sentByProfileId: auth.profile.id,
    linkedClientId,
    linkedApplicationId,
    replyToEmailId,
    forwardedFromEmailId,
    inReplyTo,
    sendKey: input.sendKey,
  });

  if (persisted.status === "duplicate") {
    // The same compose was submitted twice. The first send is already on
    // record; this is not an error to show as one.
    return { status: "duplicate" };
  }
  if (persisted.status === "error") {
    console.error(
      "[correo actions] SMTP accepted a message the CRM failed to record. messageId:",
      sent.messageId
    );
    return { status: "sent_not_recorded" };
  }

  await recordEmailSentEvent({
    emailId: persisted.id,
    clientId: linkedClientId,
    applicationId: linkedApplicationId,
    subject,
    actorProfileId: auth.profile.id,
  });

  revalidatePath("/correo");
  return { status: "success", emailId: persisted.id };
}
