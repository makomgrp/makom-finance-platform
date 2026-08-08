"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConversationListItem } from "@/components/chat/conversation-list-item";
import { getConversationId, getMessagesForConversation } from "@/lib/demo-data";
import type { ChatMessage, SupportedLanguage, User } from "@/types";

interface ConversationListProps {
  colleagues: User[];
  messages: ChatMessage[];
  selectedUserId: string | null;
  onSelectUser: (userId: string) => void;
  /** The real signed-in user's `profiles.id` UUID — see chat-view.tsx's
   * IDENTITY MODEL note. Never a legacy id. */
  currentUserId: string;
  /** The real signed-in user's preferred language, for rendering each
   * conversation's message preview in their own language. */
  viewerPreferredLanguage: SupportedLanguage;
}

export function ConversationList({
  colleagues,
  messages,
  selectedUserId,
  onSelectUser,
  currentUserId,
  viewerPreferredLanguage,
}: ConversationListProps) {
  const t = useTranslations();
  const [search, setSearch] = useState("");

  const rows = useMemo(() => {
    return colleagues
      .map((user) => {
        const conversationId = getConversationId(currentUserId, user.id);
        const conversationMessages = getMessagesForConversation(conversationId, messages);
        const lastMessage = conversationMessages[conversationMessages.length - 1];
        const unreadCount = conversationMessages.filter(
          (message) => message.recipientId === currentUserId && !message.readAt
        ).length;
        return { user, lastMessage, unreadCount };
      })
      .filter(({ user }) => user.fullName.toLowerCase().includes(search.trim().toLowerCase()))
      .sort((a, b) => {
        if (!a.lastMessage && !b.lastMessage) return a.user.fullName.localeCompare(b.user.fullName);
        if (!a.lastMessage) return 1;
        if (!b.lastMessage) return -1;
        return new Date(b.lastMessage.createdAt).getTime() - new Date(a.lastMessage.createdAt).getTime();
      });
  }, [colleagues, messages, search, currentUserId]);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t("chat.searchPlaceholder")}
            className="pl-8"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="space-y-0.5 p-2">
          {rows.map(({ user, lastMessage, unreadCount }) => (
            <ConversationListItem
              key={user.id}
              user={user}
              lastMessage={lastMessage}
              unreadCount={unreadCount}
              isActive={user.id === selectedUserId}
              onSelect={() => onSelectUser(user.id)}
              viewerPreferredLanguage={viewerPreferredLanguage}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
