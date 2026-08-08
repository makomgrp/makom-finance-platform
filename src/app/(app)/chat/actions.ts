"use server";

import { sendMessage, markConversationRead, ensureMessageTranslation } from "@/lib/services/chat";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { SUPPORTED_LANGUAGE_VALUES } from "@/lib/config/language";
import type { ChatMessage, SupportedLanguage } from "@/types";

/**
 * Thin Server Action wrappers around src/lib/services/chat.ts — the only
 * database logic here is none: every function below just validates its
 * input, authenticates the caller, delegates to the chat service, and maps
 * the outcome to a safe, client-facing result. No Supabase query and no
 * DeepL call is ever made directly in this file.
 *
 * MILESTONE 5B: none of these actions accept any parameter whose purpose
 * is to tell the server who the acting user is — no senderLegacyId,
 * viewerLegacyId, senderProfileId, viewerProfileId, or currentUserId.
 * Every one of them calls getCurrentProfile() itself and derives the actor
 * from that, never from client input. This closes the gap flagged as of
 * Milestone 4: route protection guarantees a valid session reached this
 * page, but never guaranteed *this specific action call* verified who's
 * behind it — these do that independently now, per the
 * "Server Actions never receive client-supplied identity" rule in the Auth
 * migration plan.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MESSAGE_LENGTH = 4000;

function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return typeof value === "string" && (SUPPORTED_LANGUAGE_VALUES as string[]).includes(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// ============================================================================
// sendChatMessage
// ============================================================================

export interface SendChatMessageInput {
  id: string;
  /** The colleague being messaged — still legacy-id-space (see
   * src/lib/services/chat.ts's module doc comment). Never the acting
   * user's identity. */
  recipientLegacyId: string;
  text: string;
  originalLanguage: SupportedLanguage;
}

export type SendChatMessageResult =
  | { status: "success"; message: ChatMessage; conversationRealId: string }
  | { status: "error"; code: "INVALID_INPUT" | "UNAUTHENTICATED" | "SEND_FAILED" };

export async function sendChatMessage(input: SendChatMessageInput): Promise<SendChatMessageResult> {
  if (!isNonEmptyString(input.id) || !UUID_PATTERN.test(input.id)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!isNonEmptyString(input.recipientLegacyId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  const text = isNonEmptyString(input.text) ? input.text.trim() : "";
  if (!text || text.length > MAX_MESSAGE_LENGTH) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!isSupportedLanguage(input.originalLanguage)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    console.error("[chat actions] sendChatMessage rejected: no authenticated profile.");
    return { status: "error", code: "UNAUTHENTICATED" };
  }

  try {
    const { message, conversationRealId } = await sendMessage({
      id: input.id,
      senderProfileId: profile.id,
      recipientLegacyId: input.recipientLegacyId,
      text,
      originalLanguage: input.originalLanguage,
    });
    return { status: "success", message, conversationRealId };
  } catch (error) {
    console.error(
      "[chat actions] sendChatMessage failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error", code: "SEND_FAILED" };
  }
}

// ============================================================================
// markChatConversationRead
// ============================================================================

export interface MarkChatConversationReadInput {
  /** Which conversation to mark read, identified by the colleague on the
   * other side — still legacy-id-space. The viewer is always the caller's
   * own authenticated identity, never accepted from input. */
  colleagueLegacyId: string;
}

export type MarkChatConversationReadResult =
  | { status: "success" }
  | { status: "error"; code: "INVALID_INPUT" | "UNAUTHENTICATED" | "MARK_READ_FAILED" };

export async function markChatConversationRead(
  input: MarkChatConversationReadInput
): Promise<MarkChatConversationReadResult> {
  if (!isNonEmptyString(input.colleagueLegacyId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    console.error("[chat actions] markChatConversationRead rejected: no authenticated profile.");
    return { status: "error", code: "UNAUTHENTICATED" };
  }

  try {
    await markConversationRead(profile.id, input.colleagueLegacyId);
    return { status: "success" };
  } catch (error) {
    console.error(
      "[chat actions] markChatConversationRead failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error", code: "MARK_READ_FAILED" };
  }
}

// ============================================================================
// retryChatMessageTranslation
// ============================================================================

export interface RetryChatMessageTranslationInput {
  messageId: string;
  targetLanguage: SupportedLanguage;
}

export type RetryChatMessageTranslationResult =
  | { status: "success"; text: string }
  | { status: "error"; code: "INVALID_INPUT" | "UNAUTHENTICATED" | "TRANSLATION_FAILED" };

export async function retryChatMessageTranslation(
  input: RetryChatMessageTranslationInput
): Promise<RetryChatMessageTranslationResult> {
  if (!isNonEmptyString(input.messageId) || !UUID_PATTERN.test(input.messageId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!isSupportedLanguage(input.targetLanguage)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  // This action never took an actor-identity parameter to begin with, but
  // per Milestone 5B it must not rely on route protection alone either —
  // independently confirm a real session is behind this call before
  // touching translation state at all.
  const profile = await getCurrentProfile();
  if (!profile) {
    console.error("[chat actions] retryChatMessageTranslation rejected: no authenticated profile.");
    return { status: "error", code: "UNAUTHENTICATED" };
  }

  try {
    const result = await ensureMessageTranslation(input.messageId, input.targetLanguage);
    if (result.status === "ok") {
      return { status: "success", text: result.text };
    }
    return { status: "error", code: "TRANSLATION_FAILED" };
  } catch (error) {
    console.error(
      "[chat actions] retryChatMessageTranslation failed:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error", code: "TRANSLATION_FAILED" };
  }
}
