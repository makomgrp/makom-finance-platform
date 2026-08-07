import type { ChatMessage, SupportedLanguage } from "@/types";

export interface MessageDisplay {
  text: string;
  /** True when `text` is a translated copy, not the original. */
  isTranslated: boolean;
  /** True when the message crosses languages but no translation exists yet. */
  isPending: boolean;
}

/**
 * Resolves what a given viewer should see for a message: their own language's
 * translation if one exists, the original text untouched when languages
 * match, or the original text with a "pending" flag while a translation is
 * still outstanding. `message.originalText` itself is never mutated.
 */
export function getMessageDisplay(
  message: ChatMessage,
  viewerLanguage: SupportedLanguage
): MessageDisplay {
  if (message.originalLanguage === viewerLanguage) {
    return { text: message.originalText, isTranslated: false, isPending: false };
  }

  const translated = message.translations[viewerLanguage];
  if (translated) {
    return { text: translated, isTranslated: true, isPending: false };
  }

  return { text: message.originalText, isTranslated: false, isPending: true };
}
