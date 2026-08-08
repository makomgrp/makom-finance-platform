import { ChatView } from "@/components/chat/chat-view";
import { CURRENT_USER, USERS } from "@/lib/demo-data";
import { loadChatDataForUser } from "@/lib/services/chat";
import type { ChatConversation, ChatMessage } from "@/types";

// This project uses Next's previous rendering model (no `cacheComponents`
// in next.config.ts), where `export const dynamic` is the correct,
// current mechanism to control this. /chat renders per-user CRM data
// (conversations, messages) that must never be served from a stale
// prerendered shell — force-dynamic makes that explicit rather than
// relying on Next's default inference.
export const dynamic = "force-dynamic";

// Same "active, not me" rule chat-view.tsx uses for who's reachable — kept
// here too so this file knows who to load data for. Small, deliberate
// duplication: restructuring identity handling is out of scope for this
// read-path migration (see the chat migration plan).
const COLLEAGUE_LEGACY_IDS = USERS.filter(
  (user) => user.active && user.id !== CURRENT_USER.id
).map((user) => user.id);

export default async function ChatPage() {
  let initialMessages: ChatMessage[] = [];
  let initialConversations: ChatConversation[] = [];
  let hasLoadError = false;

  try {
    const result = await loadChatDataForUser(CURRENT_USER.id, COLLEAGUE_LEGACY_IDS);
    initialMessages = result.messages;
    initialConversations = result.conversations;
  } catch (error) {
    console.error(
      "[chat/page] Failed to load chat data:",
      error instanceof Error ? error.message : "unknown error"
    );
    hasLoadError = true;
  }

  return (
    <ChatView
      initialMessages={initialMessages}
      initialConversations={initialConversations}
      hasLoadError={hasLoadError}
    />
  );
}
