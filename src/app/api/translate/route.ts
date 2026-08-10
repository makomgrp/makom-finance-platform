import { NextResponse } from "next/server";
import { SUPPORTED_LANGUAGE_VALUES } from "@/lib/config/language";
import { translateWithDeepL } from "@/lib/services/deepl";
import type { SupportedLanguage } from "@/types";

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

  const result = await translateWithDeepL(text, targetLanguage);

  if (result.status === "not_configured") {
    return NextResponse.json({ error: "Translation service is not configured" }, { status: 500 });
  }
  if (result.status === "error") {
    return NextResponse.json({ error: "Translation failed" }, { status: 502 });
  }

  return NextResponse.json({
    text: result.text,
    detectedSourceLanguage: result.detectedSourceLanguage,
  });
}
