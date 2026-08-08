"use server";

import { sendMessage, markConversationRead, ensureMessageTranslation } from "@/lib/services/chat";
import { SUPPORTED_LANGUAGE_VALUES } from "@/lib/config/language";
import type { ChatMessage, SupportedLanguage } from "@/types";

/**
 * Thin Server Action wrappers around src/lib/services/chat.ts — the only
 * database logic here is none: every function below just validates its
 * input, delegates to the chat service, and maps the outcome to a safe,
 * client-facing result. No Supabase query and no DeepL call is ever made
 * directly in this file — sendChatMessage and retryChatMessageTranslation
 * delegate to the chat service, which is the only thing that talks to
 * either.
 *
 * SECURITY NOTE (still true as of Milestone 4): sendChatMessage and
 * markChatConversationRead currently trust senderLegacyId/viewerLegacyId
 * as supplied by the caller — Milestone 4 added real route protection
 * (you must have a valid session + active profile to reach this page at
 * all), but route protection is NOT the same guarantee as "this action
 * verified who's calling it." Nothing here calls getCurrentProfile() yet.
 * A signed-in user could today still invoke this action claiming to be a
 * different legacy id. Closing that gap — deriving the actor from
 * getCurrentProfile() instead of a client-supplied id, per the
 * "Server Actions never receive client-supplied identity" rule in the Auth
 * migration plan — is Milestone 5's job, alongside the rest of the
 * CURRENT_USER migration. Do not treat proxy.ts/(app)/layout.tsx's route
 * protection as a substitute for that.
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
  senderLegacyId: string;
  recipientLegacyId: string;
  text: string;
  originalLanguage: SupportedLanguage;
}

export type SendChatMessageResult =
  | { status: "success"; message: ChatMessage; conversationRealId: string }
  | { status: "error"; code: "INVALID_INPUT" | "SEND_FAILED" };

export async function sendChatMessage(input: SendChatMessageInput): Promise<SendChatMessageResult> {
  if (!isNonEmptyString(input.id) || !UUID_PATTERN.test(input.id)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!isNonEmptyString(input.senderLegacyId) || !isNonEmptyString(input.recipientLegacyId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (input.senderLegacyId === input.recipientLegacyId) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  const text = isNonEmptyString(input.text) ? input.text.trim() : "";
  if (!text || text.length > MAX_MESSAGE_LENGTH) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!isSupportedLanguage(input.originalLanguage)) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  try {
    const { message, conversationRealId } = await sendMessage({
      id: input.id,
      senderLegacyId: input.senderLegacyId,
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
  viewerLegacyId: string;
  colleagueLegacyId: string;
}

export type MarkChatConversationReadResult =
  | { status: "success" }
  | { status: "error"; code: "INVALID_INPUT" | "MARK_READ_FAILED" };

export async function markChatConversationRead(
  input: MarkChatConversationReadInput
): Promise<MarkChatConversationReadResult> {
  if (!isNonEmptyString(input.viewerLegacyId) || !isNonEmptyString(input.colleagueLegacyId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (input.viewerLegacyId === input.colleagueLegacyId) {
    return { status: "error", code: "INVALID_INPUT" };
  }

  try {
    await markConversationRead(input.viewerLegacyId, input.colleagueLegacyId);
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
  | { status: "error"; code: "INVALID_INPUT" | "TRANSLATION_FAILED" };

export async function retryChatMessageTranslation(
  input: RetryChatMessageTranslationInput
): Promise<RetryChatMessageTranslationResult> {
  if (!isNonEmptyString(input.messageId) || !UUID_PATTERN.test(input.messageId)) {
    return { status: "error", code: "INVALID_INPUT" };
  }
  if (!isSupportedLanguage(input.targetLanguage)) {
    return { status: "error", code: "INVALID_INPUT" };
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
