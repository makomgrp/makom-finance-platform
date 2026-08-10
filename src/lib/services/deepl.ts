import "server-only";
import {
  DEEPL_SOURCE_LANGUAGE_CODE,
  DEEPL_TARGET_LANGUAGE_CODE,
} from "@/lib/config/language";
import type { SupportedLanguage } from "@/types";

/**
 * The single place that actually calls DeepL. Both /api/translate (the
 * existing client-facing Route Handler) and the chat server-side
 * translation-persistence flow call this — the DeepL endpoint, auth
 * header, language mapping, and response parsing must never be
 * duplicated anywhere else.
 */

// DeepL API Free endpoint — this account is a Developer/Free tier key
// (suffixed ":fx"), which is only valid against api-free.deepl.com. The Pro
// endpoint (api.deepl.com) would reject it.
const DEEPL_API_URL = "https://api-free.deepl.com/v2/translate";

// Inverted from DEEPL_SOURCE_LANGUAGE_CODE so a detected code like "ES" maps
// back to our "es". DeepL's detected_source_language is always a bare code
// (no regional variant), matching the source-code map exactly.
const DEEPL_CODE_TO_SUPPORTED_LANGUAGE: Record<string, SupportedLanguage> = Object.fromEntries(
  Object.entries(DEEPL_SOURCE_LANGUAGE_CODE).map(([lang, code]) => [code, lang as SupportedLanguage])
);

interface DeepLTranslateResponse {
  translations?: { text?: string; detected_source_language?: string }[];
}

export type TranslateWithDeepLResult =
  | { status: "translated"; text: string; detectedSourceLanguage?: SupportedLanguage }
  | { status: "not_configured" }
  | { status: "error" };

/**
 * Calls DeepL for one piece of text. `source_lang` is intentionally
 * omitted so DeepL auto-detects the actual written language, rather than
 * trusting a caller-supplied source — a sender can type in a different
 * language than their configured preference, and the result should still
 * be correct.
 *
 * Distinguishes "not configured" (missing DEEPL_API_KEY) from "error"
 * (the DeepL request itself failed) so callers that map this to an HTTP
 * response — see /api/translate — can preserve their existing status
 * codes exactly.
 */
export async function translateWithDeepL(
  text: string,
  targetLanguage: SupportedLanguage
): Promise<TranslateWithDeepLResult> {
  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) {
    console.error("[deepl] DEEPL_API_KEY is not configured.");
    return { status: "not_configured" };
  }

  try {
    const deeplResponse = await fetch(DEEPL_API_URL, {
      method: "POST",
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: [text],
        target_lang: DEEPL_TARGET_LANGUAGE_CODE[targetLanguage],
      }),
    });

    if (!deeplResponse.ok) {
      console.error(`[deepl] DeepL request failed with status ${deeplResponse.status}`);
      return { status: "error" };
    }

    const data: DeepLTranslateResponse = await deeplResponse.json();
    const translation = data.translations?.[0];
    if (!translation || typeof translation.text !== "string") {
      console.error("[deepl] Unexpected DeepL response shape.");
      return { status: "error" };
    }

    const detectedCode = translation.detected_source_language?.toUpperCase();
    const detectedSourceLanguage = detectedCode
      ? DEEPL_CODE_TO_SUPPORTED_LANGUAGE[detectedCode]
      : undefined;

    return { status: "translated", text: translation.text, detectedSourceLanguage };
  } catch (error) {
    console.error(
      "[deepl] Request to DeepL threw:",
      error instanceof Error ? error.message : "unknown error"
    );
    return { status: "error" };
  }
}
