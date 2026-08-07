import type { SupportedLanguage } from "@/types";

export interface LanguageConfig {
  code: SupportedLanguage;
  /** English display name, used only for internal/debug contexts. */
  name: string;
  /** Name as written by native speakers — this is what the UI should show. */
  nativeName: string;
  abbreviation: string;
}

/**
 * Single source of truth for chat message-translation languages.
 * To add a new language (e.g. "pt"), add it to SupportedLanguage in
 * src/types/user.ts and add its entry here — nowhere else.
 */
export const LANGUAGE_CONFIG: Record<SupportedLanguage, LanguageConfig> = {
  en: { code: "en", name: "English", nativeName: "English", abbreviation: "EN" },
  es: { code: "es", name: "Spanish", nativeName: "Español", abbreviation: "ES" },
  fr: { code: "fr", name: "French", nativeName: "Français", abbreviation: "FR" },
};

export const SUPPORTED_LANGUAGE_VALUES: SupportedLanguage[] = ["en", "es", "fr"];

/**
 * Maps each SupportedLanguage to the code DeepL expects as `source_lang`.
 * Source codes never carry a regional variant (DeepL rejects e.g. "EN-US"
 * here even though it accepts it as a target).
 * To add a language, add its entry here and to DEEPL_TARGET_LANGUAGE_CODE —
 * nowhere else needs to change.
 */
export const DEEPL_SOURCE_LANGUAGE_CODE: Record<SupportedLanguage, string> = {
  en: "EN",
  es: "ES",
  fr: "FR",
};

/**
 * Maps each SupportedLanguage to the code DeepL expects as `target_lang`.
 * Some languages require a regional variant as a target even though the
 * bare code is accepted as a source (e.g. English, Portuguese) — DeepL's
 * source-language detection never returns a variant, only the target
 * parameter requires one.
 */
export const DEEPL_TARGET_LANGUAGE_CODE: Record<SupportedLanguage, string> = {
  en: "EN-US",
  es: "ES",
  fr: "FR",
};
