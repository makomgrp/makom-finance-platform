import { ChatView } from "@/components/chat/chat-view";
import { loadChatDataForUser } from "@/lib/services/chat";
import { getChatColleagues } from "@/lib/services/profiles";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import type { ChatColleague, ChatConversation, ChatMessage } from "@/types";

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
  let colleagues: ChatColleague[] = [];
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
    // MILESTONE 21: the colleague directory is a live query against
    // `profiles`, not a static list. Eligibility is active AND auth-linked —
    // see getChatColleagues for why each clause is there. Identities are
    // `profiles.id` UUIDs end to end; no email matching, no legacy ids.
    const colleaguesResult = await getChatColleagues(profile.id);
    if (colleaguesResult.status === "error") {
      hasLoadError = true;
    } else {
      colleagues = colleaguesResult.colleagues;
    }

    try {
      const result = await loadChatDataForUser(
        profile.id,
        colleagues.map((colleague) => colleague.id)
      );
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
      colleagues={colleagues}
      hasLoadError={hasLoadError}
    />
  );
}
