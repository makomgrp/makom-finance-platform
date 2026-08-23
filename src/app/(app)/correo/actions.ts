"use server";

import { requireCapability } from "@/lib/auth/authorize";
import { getMailboxAddress } from "@/lib/config/mail";
import { fetchRecentMessages, type MailErrorCode } from "@/lib/services/email-imap";
import {
  persistFetchedMessages,
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
