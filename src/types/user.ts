export type UserRole =
  | "administrador"
  | "gerente"
  | "compliance"
  | "asesor"
  | "consulta";

/**
 * Language used to auto-translate chat messages for this user.
 * Independent from the CRM interface language (see src/i18n/config.ts).
 * Add new codes here and to LANGUAGE_CONFIG in lib/config/language.ts together —
 * TypeScript will flag any place that needs updating.
 */
export type SupportedLanguage = "en" | "es" | "fr";

export interface User {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
  initials: string;
  active: boolean;
  preferredLanguage: SupportedLanguage;
}
