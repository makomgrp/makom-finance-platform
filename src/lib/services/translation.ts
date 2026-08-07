import type { SupportedLanguage } from "@/types";

export interface TranslateMessageInput {
  text: string;
  /** Sender's configured language, when available — used only to skip the
   * call when it already matches targetLanguage. Never forced onto DeepL as
   * the actual source: the server always lets DeepL auto-detect, so a
   * message typed in a different language than configured still translates
   * correctly. */
  sourceLanguage?: SupportedLanguage;
  targetLanguage: SupportedLanguage;
}

export type TranslateMessageResult =
  | { status: "translated"; text: string; detectedSourceLanguage?: SupportedLanguage }
  | { status: "error" };

/**
 * Translation service contract for chat messages.
 *
 * Same-language pairs pass through untouched with no network call. Every
 * other pair calls the server-side `/api/translate` Route Handler, which is
 * the only place that talks to DeepL — this function is safe to import from
 * "use client" components because it never touches DEEPL_API_KEY itself.
 *
 * Preloaded demo conversations (src/lib/demo-data/chat.ts) ship with
 * hand-written translations and never call this function — it only runs for
 * messages composed live during the demo session.
 */
export async function translateMessage(
  input: TranslateMessageInput
): Promise<TranslateMessageResult> {
  const text = input.text.trim();
  if (!text) {
    return { status: "translated", text: input.text };
  }

  if (input.sourceLanguage && input.sourceLanguage === input.targetLanguage) {
    return { status: "translated", text: input.text };
  }

  try {
    const response = await fetch("/api/translate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, targetLanguage: input.targetLanguage }),
    });

    if (!response.ok) {
      return { status: "error" };
    }

    const data: { text?: unknown; detectedSourceLanguage?: unknown } = await response.json();
    if (typeof data.text !== "string") {
      return { status: "error" };
    }

    return {
      status: "translated",
      text: data.text,
      detectedSourceLanguage:
        typeof data.detectedSourceLanguage === "string"
          ? (data.detectedSourceLanguage as SupportedLanguage)
          : undefined,
    };
  } catch {
    return { status: "error" };
  }
}
