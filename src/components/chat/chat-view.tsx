"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { MessageCircle } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { EmptyState } from "@/components/shared/empty-state";
import { ConversationList } from "@/components/chat/conversation-list";
import { ChatHeader } from "@/components/chat/chat-header";
import { MessageBubble } from "@/components/chat/message-bubble";
import { MessageComposer } from "@/components/chat/message-composer";
import {
  CHAT_MESSAGES,
  CURRENT_USER,
  USERS,
  getConversationId,
  getMessagesForConversation,
} from "@/lib/demo-data";
import { translateMessage } from "@/lib/services/translation";
import type { ChatMessage, SupportedLanguage } from "@/types";

// Only active internal users can be reached — mirrors the future rule that
// inactive accounts cannot participate in chat (see CHAT_ARCHITECTURE.md).
const COLLEAGUES = USERS.filter((user) => user.active && user.id !== CURRENT_USER.id);

function mostRecentColleagueId(messages: ChatMessage[]): string | null {
  let latest: { userId: string; at: number } | null = null;
  for (const colleague of COLLEAGUES) {
    const conversationId = getConversationId(CURRENT_USER.id, colleague.id);
    const conversationMessages = getMessagesForConversation(conversationId, messages);
    const last = conversationMessages[conversationMessages.length - 1];
    if (last) {
      const at = new Date(last.createdAt).getTime();
      if (!latest || at > latest.at) latest = { userId: colleague.id, at };
    }
  }
  return latest?.userId ?? COLLEAGUES[0]?.id ?? null;
}

/** Marks a conversation's inbound messages as read. Pure — no side effects. */
function markConversationRead(messages: ChatMessage[], conversationId: string | null): ChatMessage[] {
  if (!conversationId) return messages;
  const hasUnread = messages.some(
    (message) =>
      message.conversationId === conversationId &&
      message.recipientId === CURRENT_USER.id &&
      !message.readAt
  );
  if (!hasUnread) return messages;
  const readAt = new Date().toISOString();
  return messages.map((message) =>
    message.conversationId === conversationId &&
    message.recipientId === CURRENT_USER.id &&
    !message.readAt
      ? { ...message, readAt }
      : message
  );
}

export function ChatView() {
  const t = useTranslations();
  const [selectedUserId, setSelectedUserId] = useState<string | null>(() =>
    mostRecentColleagueId(CHAT_MESSAGES)
  );
  // The initially auto-selected conversation starts already marked read;
  // manual selections are marked read directly in handleSelectUser below —
  // neither needs a reactive effect (see memory: avoid setState-in-effect).
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    markConversationRead(
      CHAT_MESSAGES,
      selectedUserId ? getConversationId(CURRENT_USER.id, selectedUserId) : null
    )
  );
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");
  const [draft, setDraft] = useState("");
  // Session-only bookkeeping for messages composed live: which ones are
  // currently awaiting a DeepL response, and which ones failed. Never
  // persisted, and never touched for preloaded demo messages.
  const [translatingIds, setTranslatingIds] = useState<Set<string>>(new Set());
  const [translationErrorIds, setTranslationErrorIds] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);

  const selectedUser = COLLEAGUES.find((user) => user.id === selectedUserId) ?? null;

  const conversationId = selectedUser ? getConversationId(CURRENT_USER.id, selectedUser.id) : null;

  const conversationMessages = useMemo(
    () => (conversationId ? getMessagesForConversation(conversationId, messages) : []),
    [conversationId, messages]
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [conversationMessages.length, selectedUserId]);

  const handleSelectUser = (userId: string) => {
    setSelectedUserId(userId);
    setMobileView("chat");
    setMessages((prev) => markConversationRead(prev, getConversationId(CURRENT_USER.id, userId)));
  };

  // Fires (or re-fires, for retry) a DeepL translation for one message into
  // one target language, and patches the result back into `messages` when it
  // resolves. Never blocks the caller — always fire-and-forget.
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

    translateMessage({
      text: message.originalText,
      sourceLanguage: message.originalLanguage,
      targetLanguage,
    }).then((result) => {
      setTranslatingIds((prev) => {
        const next = new Set(prev);
        next.delete(message.id);
        return next;
      });

      if (result.status === "translated") {
        setMessages((prev) =>
          prev.map((existing) =>
            existing.id === message.id
              ? {
                  ...existing,
                  translations: { ...existing.translations, [targetLanguage]: result.text },
                  detectedLanguage:
                    result.detectedSourceLanguage && result.detectedSourceLanguage !== existing.originalLanguage
                      ? result.detectedSourceLanguage
                      : existing.detectedLanguage,
                }
              : existing
          )
        );
      } else {
        setTranslationErrorIds((prev) => new Set(prev).add(message.id));
      }
    });
  };

  const handleSend = () => {
    if (!selectedUser || !draft.trim() || !conversationId) return;

    // DEMO: kept in component state for this session only. In production
    // this becomes an insert into `messages` (see CHAT_ARCHITECTURE.md).
    const newMessage: ChatMessage = {
      id: `msg-demo-${Date.now()}`,
      conversationId,
      senderId: CURRENT_USER.id,
      recipientId: selectedUser.id,
      originalText: draft.trim(),
      originalLanguage: CURRENT_USER.preferredLanguage,
      translations: {},
      createdAt: new Date().toISOString(),
      readAt: new Date().toISOString(),
    };

    // Show the message immediately, then translate in the background —
    // sending never waits on DeepL.
    setMessages((prev) => [...prev, newMessage]);
    setDraft("");
    requestTranslation(newMessage, selectedUser.preferredLanguage);
  };

  return (
    <div className="flex h-[calc(100dvh-8rem)] min-h-[480px] overflow-hidden rounded-xl border border-border bg-card">
      <div
        className={`w-full shrink-0 border-r border-border md:block md:w-80 ${
          mobileView === "list" ? "block" : "hidden"
        }`}
      >
        <ConversationList
          colleagues={COLLEAGUES}
          messages={messages}
          selectedUserId={selectedUserId}
          onSelectUser={handleSelectUser}
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
                      isOwn={message.senderId === CURRENT_USER.id}
                      viewerLanguage={CURRENT_USER.preferredLanguage}
                      counterpartLanguage={selectedUser.preferredLanguage}
                      isTranslating={translatingIds.has(message.id)}
                      hasTranslationError={translationErrorIds.has(message.id)}
                      onRetryTranslation={() => requestTranslation(message, selectedUser.preferredLanguage)}
                    />
                  ))
                )}
                <div ref={bottomRef} />
              </div>
            </ScrollArea>

            <MessageComposer value={draft} onChange={setDraft} onSend={handleSend} />
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
