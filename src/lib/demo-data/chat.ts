import type { ChatMessage } from "@/types";

/**
 * Deterministic conversation id for a 1:1 pair, independent of argument order.
 * Mirrors how a future `conversations` lookup keyed by member pair would work.
 */
export function getConversationId(userIdA: string, userIdB: string): string {
  return [userIdA, userIdB].sort().join("__");
}

export function getMessagesForConversation(conversationId: string, messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter((message) => message.conversationId === conversationId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}
