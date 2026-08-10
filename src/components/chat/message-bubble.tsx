"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { getMessageDisplay } from "@/lib/chat-message-display";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/config";
import type { ChatMessage, SupportedLanguage } from "@/types";

interface MessageBubbleProps {
  message: ChatMessage;
  isOwn: boolean;
  /** Preferred language of the person reading the conversation right now. */
  viewerLanguage: SupportedLanguage;
  /** Preferred language of the other participant in this conversation. */
  counterpartLanguage: SupportedLanguage;
  /** True while a DeepL request for this message is in flight. */
  isTranslating?: boolean;
  /** True when the last DeepL request for this message failed. */
  hasTranslationError?: boolean;
  /** Retries a failed translation. Omit if retry isn't wired up. */
  onRetryTranslation?: () => void;
  /** True when persisting this message to the database failed. Distinct
   * from translation failure — a message can fail to send before
   * translation is ever relevant. */
  hasSendError?: boolean;
  /** Retries persisting a failed send. Omit if retry isn't wired up. */
  onRetrySend?: () => void;
}

export function MessageBubble({
  message,
  isOwn,
  viewerLanguage,
  counterpartLanguage,
  isTranslating = false,
  hasTranslationError = false,
  onRetryTranslation,
  hasSendError = false,
  onRetrySend,
}: MessageBubbleProps) {
  const locale = useLocale() as Locale;
  const t = useTranslations();
  const [showOriginal, setShowOriginal] = useState(false);

  // Own messages always render as typed — the sender never needs their own
  // words translated. Instead we surface whether the *counterpart's* copy is
  // still outstanding, since that's the thing the sender can't see for
  // themself: awaiting DeepL, already translated, or failed.
  const needsCounterpartTranslation = isOwn && message.originalLanguage !== counterpartLanguage;
  const ownTranslated = needsCounterpartTranslation && Boolean(message.translations[counterpartLanguage]);
  const ownPending = needsCounterpartTranslation && !ownTranslated;

  const display = isOwn
    ? { text: message.originalText, isTranslated: false, isPending: ownPending }
    : getMessageDisplay(message, viewerLanguage);

  const text = !isOwn && display.isTranslated && showOriginal ? message.originalText : display.text;

  return (
    <div className={cn("flex flex-col", isOwn ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-3.5 py-2 text-sm sm:max-w-[70%]",
          isOwn
            ? "rounded-br-sm bg-primary text-primary-foreground"
            : "rounded-bl-sm bg-muted text-foreground"
        )}
      >
        <p className="whitespace-pre-wrap break-words">{text}</p>
      </div>

      <div className="mt-1 flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
        <span>{formatDateTime(message.createdAt, locale)}</span>

        {isOwn && hasSendError ? (
          <>
            <span aria-hidden>·</span>
            <span className="italic text-destructive">{t("chat.sendFailed")}</span>
            {onRetrySend && (
              <button
                type="button"
                onClick={onRetrySend}
                className="font-medium text-primary hover:underline"
              >
                {t("chat.retry")}
              </button>
            )}
          </>
        ) : (
          <>
            {display.isPending && (
              <>
                <span aria-hidden>·</span>
                <span className="italic">
                  {isOwn && isTranslating
                    ? t("chat.translating")
                    : isOwn && hasTranslationError
                      ? t("chat.translationUnavailable")
                      : t("chat.translationPending")}
                </span>
                {isOwn && hasTranslationError && onRetryTranslation && (
                  <button
                    type="button"
                    onClick={onRetryTranslation}
                    className="font-medium text-primary hover:underline"
                  >
                    {t("chat.retry")}
                  </button>
                )}
              </>
            )}

            {ownTranslated && (
              <>
                <span aria-hidden>·</span>
                <span>{t("chat.translatedAutomatically")}</span>
              </>
            )}
          </>
        )}

        {!isOwn && display.isTranslated && (
          <>
            <span aria-hidden>·</span>
            {showOriginal ? (
              <span>{t(`chat.languageNames.${message.originalLanguage}`)}</span>
            ) : (
              <span>
                {t("chat.translatedFrom", {
                  language: t(`chat.languageNames.${message.originalLanguage}`),
                })}
              </span>
            )}
            <button
              type="button"
              onClick={() => setShowOriginal((value) => !value)}
              className="font-medium text-primary hover:underline"
            >
              {showOriginal ? t("chat.viewTranslation") : t("chat.viewOriginal")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
