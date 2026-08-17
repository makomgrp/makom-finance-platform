"use client";

import { useLocale, useTranslations } from "next-intl";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { LANGUAGE_CONFIG } from "@/lib/config/language";
import { getMessageDisplay } from "@/lib/chat-message-display";
import { formatRelativeTime, getInitials } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/config";
import type { ChatMessage, SupportedLanguage, ChatColleague } from "@/types";

interface ConversationListItemProps {
  user: ChatColleague;
  lastMessage?: ChatMessage;
  unreadCount: number;
  isActive: boolean;
  onSelect: () => void;
  /** The real signed-in viewer's preferred language — see
   * chat-view.tsx's IDENTITY MODEL note. */
  viewerPreferredLanguage: SupportedLanguage;
}

export function ConversationListItem({
  user,
  lastMessage,
  unreadCount,
  isActive,
  onSelect,
  viewerPreferredLanguage,
}: ConversationListItemProps) {
  const locale = useLocale() as Locale;
  const t = useTranslations();

  const preview = lastMessage ? getMessageDisplay(lastMessage, viewerPreferredLanguage).text : null;

  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
        isActive ? "bg-primary/10" : "hover:bg-muted"
      )}
    >
      <Avatar className="size-10 shrink-0">
        <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
          {getInitials(user.fullName)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="truncate text-sm font-medium text-foreground">{user.fullName}</p>
          {lastMessage && (
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {formatRelativeTime(lastMessage.createdAt, locale, t)}
            </span>
          )}
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className="truncate text-xs text-muted-foreground">
            {t(`roles.${user.role}`)} · {LANGUAGE_CONFIG[user.preferredLanguage].nativeName}
          </p>
        </div>
        <div className="mt-1 flex items-center justify-between gap-2">
          <p
            className={cn(
              "truncate text-xs",
              unreadCount > 0 ? "font-medium text-foreground" : "text-muted-foreground"
            )}
          >
            {preview ?? t("chat.noMessagesYet")}
          </p>
          {unreadCount > 0 && (
            <span className="flex size-4.5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
              {unreadCount}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
