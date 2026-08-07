"use client";

import { useTranslations } from "next-intl";
import type { FormEvent, KeyboardEvent } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface MessageComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
}

export function MessageComposer({ value, onChange, onSend }: MessageComposerProps) {
  const t = useTranslations();

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim()) return;
    onSend();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (value.trim()) onSend();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2 border-t border-border p-3">
      <Textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={t("chat.messagePlaceholder")}
        rows={1}
        className="max-h-32 min-h-9 flex-1 resize-none py-2"
      />
      <Button type="submit" size="icon" disabled={!value.trim()} className="shrink-0">
        <Send className="size-4" />
        <span className="sr-only">{t("chat.send")}</span>
      </Button>
    </form>
  );
}
