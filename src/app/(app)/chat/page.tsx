import { ChatView } from "@/components/chat/chat-view";
import { USERS } from "@/lib/demo-data";
import { loadChatDataForUser } from "@/lib/services/chat";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import type { ChatConversation, ChatMessage } from "@/types";

// This project uses Next's previous rendering model (no `cacheComponents`
// in next.config.ts), where `export const dynamic` is the correct,
// current mechanism to control this. /chat renders per-user CRM data
// (conversations, messages) that must never be served from a stale
// prerendered shell — force-dynamic makes that explicit rather than
// relying on Next's default inference.
export const dynamic = "force-dynamic";

export default async function ChatPage() {
  let initialMessages: ChatMessage[] = [];
  let initialConversations: ChatConversation[] = [];
  let hasLoadError = false;

  // getCurrentProfile() is wrapped in React's cache(), so this and the
  // (app) layout's own call within the same request share one actual
  // session/DB lookup — see get-current-profile.ts.
  const profile = await getCurrentProfile();

  if (!profile) {
    // Unreachable in practice — src/app/(app)/layout.tsx already redirects
    // to /login before this page ever renders (see Milestone 4). Treated
    // as a load error rather than duplicating that redirect here (see the
    // "do not duplicate auth checks" rule in the Auth migration plan).
    hasLoadError = true;
  } else {
    // Colleagues remain legacy-id-space (see the chat migration plan) —
    // matched against the real authenticated profile by email, since
    // Profile deliberately carries no legacy_id (see get-current-profile.ts).
    // Display/targeting only — the acting user's own identity below is
    // always profile.id, the real UUID, never this bridge.
    const colleagueLegacyIds = USERS.filter(
      (user) => user.active && user.email !== profile.email
    ).map((user) => user.id);

    try {
      const result = await loadChatDataForUser(profile.id, colleagueLegacyIds);
      initialMessages = result.messages;
      initialConversations = result.conversations;
    } catch (error) {
      console.error(
        "[chat/page] Failed to load chat data:",
        error instanceof Error ? error.message : "unknown error"
      );
      hasLoadError = true;
    }
  }

  return (
    <ChatView
      initialMessages={initialMessages}
      initialConversations={initialConversations}
      hasLoadError={hasLoadError}
    />
  );
}
