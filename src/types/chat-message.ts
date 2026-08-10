import type { SupportedLanguage } from "./user";

/**
 * A 1:1 private conversation between two internal users.
 * Maps to a future `conversations` + `conversation_members` table pair in
 * Supabase — see CHAT_ARCHITECTURE.md.
 *
 * IDENTITY MODEL (Milestone 5B): `id`/`participantIds` live in a
 * deliberately mixed id space — the real signed-in user is always their
 * actual `profiles.id` UUID, the colleague is always their legacy "u-00N"
 * id. See src/lib/services/chat.ts's module doc comment for the full
 * reasoning; this is a temporary, narrow compatibility bridge, not
 * permanent architecture.
 */
export interface ChatConversation {
  id: string;
  participantIds: [string, string];
  /** Real Supabase `conversations.id` UUID — needed only to subscribe to
   * this conversation's Realtime broadcast channel. Not used for anything
   * else client-side. */
  realId: string;
}

/**
 * Per-language cache of a translated message body.
 * Keys are added lazily as translations become available — never all at once,
 * and never a substitute for `originalText`.
 */
export type MessageTranslations = Partial<Record<SupportedLanguage, string>>;

export interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  recipientId: string;
  /** The exact text as typed by the sender. Never overwritten or discarded. */
  originalText: string;
  /** Language `originalText` was written in — usually the sender's preferredLanguage. */
  originalLanguage: SupportedLanguage;
  /**
   * Language DeepL actually detected in `originalText`, when it differs from
   * `originalLanguage` (e.g. a user typing in a language other than their
   * configured preference). Informational only — never overwrites
   * `originalLanguage`, which keeps its original meaning everywhere else.
   */
  detectedLanguage?: SupportedLanguage;
  /** Translated copies, keyed by target language. Empty/partial until translated. */
  translations: MessageTranslations;
  createdAt: string;
  /** ISO timestamp when the recipient read it; undefined/null while unread. */
  readAt?: string;
}
