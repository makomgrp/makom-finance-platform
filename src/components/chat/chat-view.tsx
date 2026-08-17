"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, MessageCircle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmptyState } from "@/components/shared/empty-state";
import { ConversationList } from "@/components/chat/conversation-list";
import { ChatHeader } from "@/components/chat/chat-header";
import { MessageBubble } from "@/components/chat/message-bubble";
import { MessageComposer } from "@/components/chat/message-composer";
import { USERS, getConversationId, getMessagesForConversation } from "@/lib/demo-data";
import {
  sendChatMessage,
  markChatConversationRead,
  retryChatMessageTranslation,
} from "@/app/(app)/chat/actions";
import { getSupabaseClient } from "@/lib/supabase/client";
import { useCurrentProfile } from "@/lib/auth/current-profile-context";
import { useCapability } from "@/lib/auth/use-capability";
import type { ChatConversation, ChatMessage, SupportedLanguage, User } from "@/types";

/**
 * MILESTONE 5B IDENTITY MODEL — read before touching this file.
 *
 * The acting/authenticated user (whoever is really signed in, via
 * useCurrentProfile()) is always represented by their real `profiles.id`
 * UUID throughout this component's state — never a legacy id, never
 * CURRENT_USER. The colleague side of any conversation stays legacy-id-
 * space (drawn from the static USERS list in src/lib/demo-data), since
 * colleague selection isn't migrated yet — see src/lib/services/chat.ts's
 * module doc comment for the full reasoning. Every `*.id`/`senderId`/
 * `recipientId` comparison below is against `profile.id` (real UUID), not
 * any legacy constant.
 */

/** Colleagues are "everyone active except the real signed-in user,"
 * matched by email since Profile carries no legacy_id (display/targeting
 * only — see the module doc comment above). */
function computeColleagues(currentUserEmail: string): User[] {
  return USERS.filter((user) => user.active && user.email !== currentUserEmail);
}

function mostRecentColleagueId(messages: ChatMessage[], currentUserId: string, colleagues: User[]): string | null {
  let latest: { userId: string; at: number } | null = null;
  for (const colleague of colleagues) {
    const conversationId = getConversationId(currentUserId, colleague.id);
    const conversationMessages = getMessagesForConversation(conversationId, messages);
    const last = conversationMessages[conversationMessages.length - 1];
    if (last) {
      const at = new Date(last.createdAt).getTime();
      if (!latest || at > latest.at) latest = { userId: colleague.id, at };
    }
  }
  return latest?.userId ?? colleagues[0]?.id ?? null;
}

/**
 * The language a message currently needs for display: the colleague's, for
 * one of the viewer's own messages (so the "translated automatically"
 * badge can resolve); the viewer's own, for a message they received.
 * Undefined when the message's recipient isn't in `colleagues` (shouldn't
 * happen for real data, but keeps this total). Pure — no side effects.
 */
function resolveNeededLanguage(
  message: ChatMessage,
  currentUserId: string,
  currentUserLanguage: SupportedLanguage,
  colleagues: User[]
): SupportedLanguage | undefined {
  const isOwnMessage = message.senderId === currentUserId;
  return isOwnMessage
    ? colleagues.find((user) => user.id === message.recipientId)?.preferredLanguage
    : currentUserLanguage;
}

/** Marks a conversation's inbound messages as read. Pure — no side effects. */
function markConversationRead(
  messages: ChatMessage[],
  conversationId: string | null,
  currentUserId: string
): ChatMessage[] {
  if (!conversationId) return messages;
  const hasUnread = messages.some(
    (message) =>
      message.conversationId === conversationId &&
      message.recipientId === currentUserId &&
      !message.readAt
  );
  if (!hasUnread) return messages;
  const readAt = new Date().toISOString();
  return messages.map((message) =>
    message.conversationId === conversationId &&
    message.recipientId === currentUserId &&
    !message.readAt
      ? { ...message, readAt }
      : message
  );
}

interface ChatViewProps {
  /** Real Supabase messages for this session's user, already shaped to
   * match the demo ChatMessage type (see src/lib/services/chat.ts). Empty
   * when the read failed — see hasLoadError. */
  initialMessages: ChatMessage[];
  /** Real Supabase conversations for this session's user — used only to
   * seed the colleague→real-conversation-UUID map that Realtime
   * subscriptions key off of (see conversationRealIds below). */
  initialConversations: ChatConversation[];
  /** True when the server-side Supabase read failed. No demo fallback —
   * an explicit error state is shown instead, on purpose. */
  hasLoadError: boolean;
}

export function ChatView({ initialMessages, initialConversations, hasLoadError }: ChatViewProps) {
  const t = useTranslations();
  // The one and only source of "who am I" in this component — resolved
  // once server-side (src/app/(app)/layout.tsx) and provided via context.
  // See the module doc comment above.
  const profile = useCurrentProfile();
  // Milestone 16 — reading chat needs no capability; contributing to it
  // does. Enforced server-side by sendChatMessage's own guard.
  const canSendChat = useCapability("chat:send");
  const colleagues = useMemo(() => computeColleagues(profile.email), [profile.email]);

  const [selectedUserId, setSelectedUserId] = useState<string | null>(() =>
    mostRecentColleagueId(initialMessages, profile.id, colleagues)
  );
  // The initially auto-selected conversation starts already marked read;
  // manual selections are marked read directly in handleSelectUser below —
  // neither needs a reactive effect (see memory: avoid setState-in-effect).
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    markConversationRead(
      initialMessages,
      selectedUserId ? getConversationId(profile.id, selectedUserId) : null,
      profile.id
    )
  );
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");
  const [draft, setDraft] = useState("");
  // Session-only bookkeeping for translation requests — whether requested
  // by the mount effect below (for messages loaded without a needed
  // translation yet), after a send, or from a manual retry. Which ones are
  // currently awaiting a DeepL response, and which ones failed. Never
  // persisted itself; loadChatDataForUser never populates these, since it
  // never attempts a translation in the first place.
  //
  // translatingIds starts pre-computed (synchronously, in this initializer)
  // with every message the mount effect below is about to request — the
  // effect itself only fires the actual network requests and never calls
  // setState synchronously, since marking something "translating" the
  // instant it's known to need one is exactly what the initial render
  // should already reflect, the same way `messages` itself is seeded here.
  const [translatingIds, setTranslatingIds] = useState<Set<string>>(() => {
    const ids = new Set<string>();
    for (const message of initialMessages) {
      const neededLanguage = resolveNeededLanguage(message, profile.id, profile.preferredLanguage, colleagues);
      if (neededLanguage && message.originalLanguage !== neededLanguage && !message.translations[neededLanguage]) {
        ids.add(message.id);
      }
    }
    return ids;
  });
  const [translationErrorIds, setTranslationErrorIds] = useState<Set<string>>(new Set());
  // Session-only bookkeeping for persisting a sent message: which ones are
  // currently being saved, and which ones failed to save. Never persisted
  // itself — a database write either succeeds (the message becomes a real
  // row) or it doesn't (nothing is written), so there's no "sending"/
  // "failed" state to store server-side, only to track locally while it's
  // in flight.
  const [sendingIds, setSendingIds] = useState<Set<string>>(new Set());
  const [failedSendIds, setFailedSendIds] = useState<Set<string>>(new Set());
  // Colleague legacy id -> real Supabase conversations.id UUID, needed only
  // to name the Realtime channel to subscribe to (see the effect below).
  // Seeded from the server-provided initialConversations; extended locally
  // whenever a send creates a brand-new conversation (see persistMessage).
  const [conversationRealIds, setConversationRealIds] = useState<Record<string, string>>(() => {
    const map: Record<string, string> = {};
    for (const conversation of initialConversations) {
      const colleagueId = conversation.participantIds.find((id) => id !== profile.id);
      if (colleagueId) map[colleagueId] = conversation.realId;
    }
    return map;
  });
  const bottomRef = useRef<HTMLDivElement>(null);

  const selectedUser = colleagues.find((user) => user.id === selectedUserId) ?? null;

  const conversationId = selectedUser ? getConversationId(profile.id, selectedUser.id) : null;

  const conversationMessages = useMemo(
    () => (conversationId ? getMessagesForConversation(conversationId, messages) : []),
    [conversationId, messages]
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [conversationMessages.length, selectedUserId]);

  const activeConversationRealId = selectedUser ? conversationRealIds[selectedUser.id] ?? null : null;

  // Patches a translation result into `messages`, clearing any pending/error
  // state for that message. Shared by runTranslationRequest's success
  // branch and the chat.translation.created broadcast handler below, so a
  // translation is applied identically no matter which of the two delivers
  // it first — deliberately idempotent (re-applying the same patch is a
  // no-op in effect).
  const applyTranslationResult = (
    messageId: string,
    targetLanguage: SupportedLanguage,
    translatedText: string
  ) => {
    setTranslatingIds((prev) => {
      if (!prev.has(messageId)) return prev;
      const next = new Set(prev);
      next.delete(messageId);
      return next;
    });
    setTranslationErrorIds((prev) => {
      if (!prev.has(messageId)) return prev;
      const next = new Set(prev);
      next.delete(messageId);
      return next;
    });
    setMessages((prev) =>
      prev.map((existing) =>
        existing.id === messageId
          ? { ...existing, translations: { ...existing.translations, [targetLanguage]: translatedText } }
          : existing
      )
    );
  };

  // Subscribes to the selected conversation's Realtime broadcast channel
  // only — never all conversations at once (see the chat migration plan).
  // Resubscribes whenever the active conversation's real UUID changes
  // (including from null, e.g. the very first message to a brand-new
  // colleague, once persistMessage below learns the new UUID). Public
  // channel, no Realtime Authorization/RLS — matches the current pre-auth
  // MVP scope; the server is still the only thing that ever writes to the
  // database.
  useEffect(() => {
    if (!activeConversationRealId || !selectedUser) return;

    // Recomputed locally rather than closing over the outer `conversationId`
    // (typed `string | null`) — TypeScript can't trace that it's non-null
    // here just because `selectedUser` was checked above, and this is a
    // cheap, pure recomputation anyway.
    const currentConversationClientId = getConversationId(profile.id, selectedUser.id);

    const supabase = getSupabaseClient();
    const channel = supabase.channel(`chat:conversation:${activeConversationRealId}`);

    channel
      .on("broadcast", { event: "chat.message.created" }, ({ payload }) => {
        const data = payload as {
          id: string;
          senderProfileId: string;
          originalText: string;
          originalLanguage: SupportedLanguage;
          createdAt: string;
        };
        setMessages((prev) => {
          // Dedupe by id: this fires for the sender's own optimistic send
          // too (it's already in `messages` from handleSend), not only for
          // the other window.
          if (prev.some((existing) => existing.id === data.id)) return prev;
          // senderProfileId (the real UUID) tells us whether this is
          // genuinely from the colleague, or my own send echoed back to a
          // different tab of my own session — this channel is scoped to
          // exactly one conversation, but "me" can still show up here from
          // elsewhere. See src/lib/services/chat.ts's module doc comment.
          const isFromMe = data.senderProfileId === profile.id;
          const incoming: ChatMessage = {
            id: data.id,
            conversationId: currentConversationClientId,
            senderId: isFromMe ? profile.id : selectedUser.id,
            recipientId: isFromMe ? selectedUser.id : profile.id,
            originalText: data.originalText,
            originalLanguage: data.originalLanguage,
            translations: {},
            createdAt: data.createdAt,
          };
          return [...prev, incoming];
        });
      })
      .on("broadcast", { event: "chat.translation.created" }, ({ payload }) => {
        const data = payload as {
          messageId: string;
          targetLanguage: SupportedLanguage;
          translatedText: string;
        };
        applyTranslationResult(data.messageId, data.targetLanguage, data.translatedText);
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeConversationRealId, selectedUser, profile.id]);

  // Fire-and-forget: persists conversation_members.last_read_at for
  // whichever colleague is passed. Never blocks the UI — the optimistic
  // local unread-clearing already happened synchronously wherever this is
  // called from. A failure here shouldn't interrupt chat, just get logged.
  const persistMarkRead = (colleagueLegacyId: string) => {
    markChatConversationRead({ colleagueLegacyId })
      .then((result) => {
        if (result.status === "error") {
          console.error("[chat-view] markChatConversationRead failed:", result.code);
        }
      })
      .catch((error) => {
        console.error(
          "[chat-view] markChatConversationRead threw:",
          error instanceof Error ? error.message : "unknown error"
        );
      });
  };

  // Persists read state for the initially auto-selected conversation once
  // on mount — later selections are persisted directly in handleSelectUser.
  // No setState here, so this doesn't fall under the set-state-in-effect
  // rule (see memory) — it's a fire-and-forget side effect, not a state
  // sync.
  useEffect(() => {
    if (selectedUserId) persistMarkRead(selectedUserId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only, see comment above
  }, []);

  const handleSelectUser = (userId: string) => {
    setSelectedUserId(userId);
    setMobileView("chat");
    setMessages((prev) => markConversationRead(prev, getConversationId(profile.id, userId), profile.id));
    persistMarkRead(userId);
  };

  // Fires the actual network request for one message/language and patches
  // the result into `messages` (or marks it failed) once it resolves.
  // Deliberately has no synchronous setState of its own — every state
  // update it makes happens inside a .then()/.catch() continuation — so
  // it's safe to call both from a user-triggered event handler (see
  // requestTranslation below) and directly from an effect. Goes through
  // the same server-side ensureMessageTranslation used by the load and
  // send paths, so this can never create a duplicate message_translations
  // row no matter which caller triggered it.
  const runTranslationRequest = (messageId: string, targetLanguage: SupportedLanguage) => {
    retryChatMessageTranslation({ messageId, targetLanguage })
      .then((result) => {
        if (result.status === "success") {
          applyTranslationResult(messageId, targetLanguage, result.text);
        } else {
          setTranslatingIds((prev) => {
            const next = new Set(prev);
            next.delete(messageId);
            return next;
          });
          setTranslationErrorIds((prev) => new Set(prev).add(messageId));
        }
      })
      .catch((error) => {
        setTranslatingIds((prev) => {
          const next = new Set(prev);
          next.delete(messageId);
          return next;
        });
        setTranslationErrorIds((prev) => new Set(prev).add(messageId));
        console.error(
          "[chat-view] retryChatMessageTranslation threw:",
          error instanceof Error ? error.message : "unknown error"
        );
      });
  };

  // User-triggered (retry button, or right after a send — see
  // persistMessage): marks the message translating immediately for
  // instant feedback, then delegates the actual request to
  // runTranslationRequest.
  const requestTranslation = (message: ChatMessage, targetLanguage: SupportedLanguage) => {
    if (message.translations[targetLanguage]) return; // already have it — reuse, don't re-call.
    if (message.originalLanguage === targetLanguage) return;

    setTranslationErrorIds((prev) => {
      if (!prev.has(message.id)) return prev;
      const next = new Set(prev);
      next.delete(message.id);
      return next;
    });
    setTranslatingIds((prev) => new Set(prev).add(message.id));

    runTranslationRequest(message.id, targetLanguage);
  };

  // loadChatDataForUser is strictly read-only — it never calls DeepL or
  // writes a translation, even when a message needs one, so that simply
  // rendering /chat (including Next.js prerendering it at build time) can
  // never trigger a real translation as a side effect. This effect is the
  // explicit, runtime-only trigger that replaces that: once on mount, fire
  // the actual request (via runTranslationRequest, not requestTranslation)
  // for every message the translatingIds initializer above already marked
  // as needing one — through the exact same persistent Server Action a
  // manual retry uses. This calls no setState synchronously itself, so it
  // doesn't fall under the set-state-in-effect rule (see memory) the way
  // calling requestTranslation directly here would have.
  useEffect(() => {
    for (const message of initialMessages) {
      const neededLanguage = resolveNeededLanguage(message, profile.id, profile.preferredLanguage, colleagues);
      if (neededLanguage && message.originalLanguage !== neededLanguage && !message.translations[neededLanguage]) {
        runTranslationRequest(message.id, neededLanguage);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally mount-only, scans the initial server-provided snapshot once; see comment above
  }, []);

  // Persists one message (or re-persists it, for retry — always reusing the
  // SAME id, never generating a new one, so a retry after a lost response
  // can't create a duplicate row if the original insert actually
  // succeeded).
  const persistMessage = (message: ChatMessage) => {
    setFailedSendIds((prev) => {
      if (!prev.has(message.id)) return prev;
      const next = new Set(prev);
      next.delete(message.id);
      return next;
    });
    setSendingIds((prev) => new Set(prev).add(message.id));

    sendChatMessage({
      id: message.id,
      recipientLegacyId: message.recipientId,
      text: message.originalText,
      originalLanguage: message.originalLanguage,
    })
      .then((result) => {
        setSendingIds((prev) => {
          const next = new Set(prev);
          next.delete(message.id);
          return next;
        });

        if (result.status === "success") {
          // Reconcile in place by id — never appended, so this can't
          // produce a duplicate.
          setMessages((prev) =>
            prev.map((existing) => (existing.id === result.message.id ? result.message : existing))
          );

          // Learn the real conversation UUID here too — not just from
          // initialConversations — since this send may be exactly what just
          // created the conversation (first message ever to this
          // colleague), in which case the subscribe effect above had
          // nothing to key off of until now.
          setConversationRealIds((prev) =>
            prev[message.recipientId] === result.conversationRealId
              ? prev
              : { ...prev, [message.recipientId]: result.conversationRealId }
          );

          // sendChatMessage's server-side service best-effort translates
          // right after persisting the original — if the recipient needed
          // one and it isn't there, that attempt failed. Surface it through
          // the same translationErrorIds path a manual retry failure uses,
          // so the existing retry affordance (and only that affordance,
          // not a second "send failed" indicator) shows up here too —
          // keeping translation errors and send errors visibly distinct.
          const neededLanguage = resolveNeededLanguage(
            result.message,
            profile.id,
            profile.preferredLanguage,
            colleagues
          );
          if (
            neededLanguage &&
            result.message.originalLanguage !== neededLanguage &&
            !result.message.translations[neededLanguage]
          ) {
            setTranslationErrorIds((prev) => new Set(prev).add(result.message.id));
          }
        } else {
          setFailedSendIds((prev) => new Set(prev).add(message.id));
        }
      })
      .catch((error) => {
        setSendingIds((prev) => {
          const next = new Set(prev);
          next.delete(message.id);
          return next;
        });
        setFailedSendIds((prev) => new Set(prev).add(message.id));
        console.error(
          "[chat-view] sendChatMessage threw:",
          error instanceof Error ? error.message : "unknown error"
        );
      });
  };

  const handleSend = () => {
    if (!selectedUser || !draft.trim() || !conversationId) return;

    const newMessage: ChatMessage = {
      id: crypto.randomUUID(),
      conversationId,
      senderId: profile.id,
      recipientId: selectedUser.id,
      originalText: draft.trim(),
      originalLanguage: profile.preferredLanguage,
      translations: {},
      createdAt: new Date().toISOString(),
    };

    // Show the message immediately, then persist in the background —
    // sending never waits on the database. sendChatMessage's server-side
    // service persists the original first, then best-effort translates it
    // for the recipient and includes that in the reconciled result below —
    // nothing more needs to happen here on success.
    setMessages((prev) => [...prev, newMessage]);
    setDraft("");
    persistMessage(newMessage);
  };

  if (hasLoadError) {
    return (
      <div className="flex h-[calc(100dvh-8rem)] min-h-[480px] items-center justify-center rounded-xl border border-border bg-card p-6">
        <EmptyState
          icon={AlertTriangle}
          title={t("chat.loadErrorTitle")}
          description={t("chat.loadErrorDescription")}
        />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-8rem)] min-h-[480px] overflow-hidden rounded-xl border border-border bg-card">
      <div
        className={`w-full shrink-0 border-r border-border md:block md:w-80 ${
          mobileView === "list" ? "block" : "hidden"
        }`}
      >
        <ConversationList
          colleagues={colleagues}
          messages={messages}
          selectedUserId={selectedUserId}
          onSelectUser={handleSelectUser}
          currentUserId={profile.id}
          viewerPreferredLanguage={profile.preferredLanguage}
        />
      </div>

      <div
        className={`flex min-w-0 flex-1 flex-col ${
          mobileView === "chat" ? "flex" : "hidden md:flex"
        }`}
      >
        {selectedUser ? (
          <>
            <ChatHeader user={selectedUser} onBack={() => setMobileView("list")} />

            <ScrollArea className="flex-1">
              <div className="space-y-3 p-4">
                {conversationMessages.length === 0 ? (
                  <EmptyState
                    icon={MessageCircle}
                    title={t("chat.emptyConversationTitle")}
                    description={t("chat.emptyConversationDescription")}
                  />
                ) : (
                  conversationMessages.map((message) => (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      isOwn={message.senderId === profile.id}
                      viewerLanguage={profile.preferredLanguage}
                      counterpartLanguage={selectedUser.preferredLanguage}
                      isTranslating={translatingIds.has(message.id)}
                      hasTranslationError={translationErrorIds.has(message.id)}
                      onRetryTranslation={() => requestTranslation(message, selectedUser.preferredLanguage)}
                      hasSendError={failedSendIds.has(message.id) && !sendingIds.has(message.id)}
                      onRetrySend={() => persistMessage(message)}
                    />
                  ))
                )}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>

            {/* Milestone 16 — `chat:send`. A `consulta` user keeps full read
                access to the conversation (and still marks it read, via the
                self-scoped `chat:mark_read`); only the composer goes away. */}
            {canSendChat && <MessageComposer value={draft} onChange={setDraft} onSend={handleSend} />}
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-6">
            <EmptyState
              icon={MessageCircle}
              title={t("chat.noConversationSelectedTitle")}
              description={t("chat.noConversationSelectedDescription")}
            />
          </div>
        )}
      </div>
    </div>
  );
}
