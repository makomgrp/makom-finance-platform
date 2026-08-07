import { NextResponse } from "next/server";
import {
  DEEPL_SOURCE_LANGUAGE_CODE,
  DEEPL_TARGET_LANGUAGE_CODE,
  SUPPORTED_LANGUAGE_VALUES,
} from "@/lib/config/language";
import type { SupportedLanguage } from "@/types";

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

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { text: rawText, targetLanguage: rawTargetLanguage } = (body ?? {}) as {
    text?: unknown;
    targetLanguage?: unknown;
  };

  const text = typeof rawText === "string" ? rawText.trim() : "";
  if (!text) {
    return NextResponse.json({ error: "Missing text" }, { status: 400 });
  }

  if (
    typeof rawTargetLanguage !== "string" ||
    !SUPPORTED_LANGUAGE_VALUES.includes(rawTargetLanguage as SupportedLanguage)
  ) {
    return NextResponse.json({ error: "Unsupported target language" }, { status: 400 });
  }
  const targetLanguage = rawTargetLanguage as SupportedLanguage;

  const apiKey = process.env.DEEPL_API_KEY;
  if (!apiKey) {
    console.error("[api/translate] DEEPL_API_KEY is not configured.");
    return NextResponse.json({ error: "Translation service is not configured" }, { status: 500 });
  }

  try {
    // source_lang is intentionally omitted so DeepL auto-detects the actual
    // written language, rather than trusting the sender's configured
    // preference — a sender can type in a different language than the one
    // set on their profile, and the recipient should still get a correct
    // translation.
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
      console.error(`[api/translate] DeepL request failed with status ${deeplResponse.status}`);
      return NextResponse.json({ error: "Translation failed" }, { status: 502 });
    }

    const data: DeepLTranslateResponse = await deeplResponse.json();
    const translation = data.translations?.[0];
    if (!translation || typeof translation.text !== "string") {
      console.error("[api/translate] Unexpected DeepL response shape.");
      return NextResponse.json({ error: "Translation failed" }, { status: 502 });
    }

    const detectedCode = translation.detected_source_language?.toUpperCase();
    const detectedSourceLanguage = detectedCode
      ? DEEPL_CODE_TO_SUPPORTED_LANGUAGE[detectedCode]
      : undefined;

    return NextResponse.json({
      text: translation.text,
      detectedSourceLanguage,
    });
  } catch (error) {
    console.error(
      "[api/translate] Request to DeepL threw:",
      error instanceof Error ? error.message : "unknown error"
    );
    return NextResponse.json({ error: "Translation failed" }, { status: 502 });
  }
}
