"use client";

import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { LANGUAGE_CONFIG } from "@/lib/config/language";
import { getInitials } from "@/lib/format";
import type { User } from "@/types";

interface ChatHeaderProps {
  user: User;
  onBack?: () => void;
}

export function ChatHeader({ user, onBack }: ChatHeaderProps) {
  const t = useTranslations();

  return (
    <div className="flex items-center gap-3 border-b border-border p-3">
      {onBack && (
        <Button variant="ghost" size="icon" className="shrink-0 md:hidden" onClick={onBack}>
          <ArrowLeft className="size-4" />
          <span className="sr-only">{t("chat.backToList")}</span>
        </Button>
      )}
      <Avatar className="size-9 shrink-0">
        <AvatarFallback className="bg-primary/10 text-xs font-semibold text-primary">
          {getInitials(user.fullName)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-foreground">{user.fullName}</p>
        <p className="truncate text-xs text-muted-foreground">
          {t(`roles.${user.role}`)} · {LANGUAGE_CONFIG[user.preferredLanguage].nativeName}
        </p>
      </div>
    </div>
  );
}
