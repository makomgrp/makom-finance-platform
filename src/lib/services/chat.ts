import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { translateWithDeepL } from "@/lib/services/deepl";
import type { ChatConversation, ChatMessage, MessageTranslations, SupportedLanguage } from "@/types";

/**
 * Server-only chat data service — the persistence layer behind the chat
 * module, backed by the `conversations` / `conversation_members` /
 * `messages` / `message_translations` tables.
 *
 * IDENTITY MODEL (Milestone 5B): every database table uses real
 * `profiles.id` UUIDs exclusively — no chat table stores or reasons about
 * `legacy_id`, and never has. What changed in Milestone 5B is who's
 * allowed to *tell* this service which UUID the acting user is:
 *
 *   - The ACTING user (sender of a message, viewer marking something
 *     read) is now always a real `profiles.id` UUID, supplied by the
 *     caller (a Server Action) after deriving it server-side via
 *     getCurrentProfile() — never resolved from a legacy id here, and
 *     never trusted from client input. See sendMessage/markConversationRead
 *     below.
 *   - The COLLEAGUE side of a conversation (who you're chatting with) is
 *     still identified by the demo "u-00N" legacy ids from
 *     src/lib/demo-data/users.ts, because the chat UI's colleague list
 *     (who's even reachable) is still sourced from that static, legacy-id-
 *     keyed data — nobody but the two real dev Auth accounts has a linked
 *     Supabase Auth session yet. resolveProfileIdByLegacyId/
 *     resolveProfileIdsByLegacyIds below remain, narrowly, for this one
 *     purpose only. This is a deliberate, temporary, isolated compatibility
 *     bridge — not a security-relevant identity resolution — and should be
 *     retired once colleague selection itself is driven by real profiles
 *     instead of the static demo user list (out of scope for this
 *     milestone; see the Auth migration plan).
 *
 * Client-facing ids therefore live in a deliberately mixed space: "myself"
 * is always a real UUID, "the colleague" is always a legacy id. Every
 * public function's doc comment below says which is which. This is not a
 * new permanent architecture — see the chat migration plan for the fuller
 * colleague-identity migration this sets up for later.
 *
 * Four functions are meant to be called from outside this module:
 * loadChatDataForUser, sendMessage, markConversationRead,
 * ensureMessageTranslation. Everything else is a private implementation
 * detail of the boundary above.
 *
 * REALTIME: sendMessage and ensureMessageTranslation each broadcast a small
 * event on a public `chat:conversation:<uuid>` channel immediately after
 * their insert succeeds — never before. Still no private channels, no
 * Realtime Authorization/RLS on realtime.messages (see the Auth migration
 * plan for when that's scheduled). The `chat.message.created` payload
 * carries exactly one identity field, `senderProfileId` (the real UUID,
 * already on hand for free — see sendMessage's call site) — needed because
 * the same real user can have a conversation open in more than one tab: a
 * subscriber can't otherwise distinguish "this is genuinely from the
 * colleague" from "this is my own send, echoed back to my other tab."
 * A receiving client only ever compares that UUID against its own known
 * real UUID — never against a legacy id, so this doesn't reintroduce a
 * dependency on the legacy_id bridge. The browser never publishes, only
 * subscribes — broadcastChatEvent below is the only thing that ever sends.
 * A broadcast failing never affects the mutation it followed; the database
 * write already succeeded by the time it's attempted, and the browser
 * always treats a page load as more authoritative than any Realtime event.
 */

// ============================================================================
// Row shapes (mirrors the columns actually selected, not full table rows)
// ============================================================================

interface ProfileIdentityRow {
  id: string;
  preferred_language: string;
}

interface ProfileLegacyRow {
  id: string;
  legacy_id: string | null;
  preferred_language: string;
}

interface ProfileIdentity {
  id: string;
  preferredLanguage: SupportedLanguage;
}

interface ConversationIdRow {
  id: string;
}

interface ConversationMemberReadRow {
  last_read_at: string | null;
}

interface MessageRow {
  id: string;
  sender_profile_id: string;
  original_text: string;
  original_language: string;
  detected_source_language: string | null;
  created_at: string;
}

interface InsertedMessageRow {
  id: string;
  original_text: string;
  original_language: string;
  created_at: string;
}

interface MessageTranslationRow {
  message_id: string;
  target_language: string;
  translated_text: string;
}

// ============================================================================
// Legacy id <-> profile UUID resolution (private — the compatibility boundary)
// ============================================================================

/** Throws: an unresolvable legacy id means a required profile mapping is
 * missing — a data/config problem, not a normal runtime state. Returns
 * preferred_language alongside the id since most callers that need the
 * profile id also need to know what language to translate into/out of. */
async function resolveProfileIdByLegacyId(legacyId: string): Promise<ProfileIdentity> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, preferred_language")
    .eq("legacy_id", legacyId)
    .maybeSingle<ProfileIdentityRow>();

  if (error) {
    console.error("[chat service] resolveProfileIdByLegacyId query failed:", error.message);
    throw new Error(`Failed to resolve profile for legacy id "${legacyId}".`);
  }
  if (!data) {
    throw new Error(`No profile found for legacy id "${legacyId}".`);
  }
  return { id: data.id, preferredLanguage: data.preferred_language as SupportedLanguage };
}

/** Batched form of resolveProfileIdByLegacyId. Throws listing every id
 * that failed to resolve, so a single query serves the whole participant
 * set instead of one round-trip per person. */
async function resolveProfileIdsByLegacyIds(legacyIds: string[]): Promise<Map<string, ProfileIdentity>> {
  const uniqueIds = Array.from(new Set(legacyIds));
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, legacy_id, preferred_language")
    .in("legacy_id", uniqueIds)
    .returns<ProfileLegacyRow[]>();

  if (error) {
    console.error("[chat service] resolveProfileIdsByLegacyIds query failed:", error.message);
    throw new Error("Failed to resolve profiles for the given legacy ids.");
  }

  const map = new Map<string, ProfileIdentity>();
  for (const row of data ?? []) {
    if (row.legacy_id) {
      map.set(row.legacy_id, { id: row.id, preferredLanguage: row.preferred_language as SupportedLanguage });
    }
  }

  const missing = uniqueIds.filter((id) => !map.has(id));
  if (missing.length > 0) {
    throw new Error(`No profile found for legacy id(s): ${missing.join(", ")}.`);
  }

  return map;
}

/** Deterministic client-facing conversation id, matching
 * demo-data/chat.ts's getConversationId() exactly. Deliberately
 * reimplemented here rather than imported, so this service has no
 * dependency on demo data — see the module doc comment. Agnostic to id
 * shape (just sorts + joins two strings), which is what lets it pair one
 * real profile UUID (the acting user) with one legacy id (the colleague)
 * — see the module doc comment's IDENTITY MODEL section. */
function buildConversationClientId(idA: string, idB: string): string {
  return [idA, idB].sort().join("__");
}

// ============================================================================
// Conversation lookup (private)
// ============================================================================

/** Read-only — never creates a conversation. Returns null if the pair has
 * no conversation yet, which is a normal, common state, not an error. */
async function findDirectConversation(profileIdA: string, profileIdB: string): Promise<string | null> {
  const low = profileIdA < profileIdB ? profileIdA : profileIdB;
  const high = profileIdA < profileIdB ? profileIdB : profileIdA;

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("id")
    .eq("type", "direct")
    .eq("direct_member_low", low)
    .eq("direct_member_high", high)
    .maybeSingle<ConversationIdRow>();

  if (error) {
    console.error("[chat service] findDirectConversation query failed:", error.message);
    throw new Error("Failed to look up the conversation.");
  }
  return data?.id ?? null;
}

/** Finds or atomically creates the conversation (+ both membership rows)
 * via the find_or_create_direct_conversation RPC — never does the
 * find/create as separate statements from here. */
async function findOrCreateDirectConversation(profileIdA: string, profileIdB: string): Promise<string> {
  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase.rpc("find_or_create_direct_conversation", {
    profile_a: profileIdA,
    profile_b: profileIdB,
  });

  if (error) {
    console.error("[chat service] find_or_create_direct_conversation RPC failed:", error.message);
    throw new Error("Failed to find or create the conversation.");
  }
  if (!data) {
    throw new Error("find_or_create_direct_conversation returned no conversation id.");
  }
  return data as string;
}

// ============================================================================
// Realtime broadcast (private)
// ============================================================================

/**
 * Sends one broadcast event on a conversation's public channel — the ONLY
 * place that ever publishes to Realtime. Best-effort: any failure is
 * logged and swallowed, never thrown, so a Realtime hiccup can never
 * affect a mutation that already succeeded. Uses httpSend (REST) rather
 * than opening a websocket, since this is a single one-shot send from a
 * server request, not a persistent subscription — the channel is removed
 * again immediately after, per the client's own guidance for this pattern.
 */
async function broadcastChatEvent(
  conversationRealId: string,
  event: "chat.message.created" | "chat.translation.created",
  payload: Record<string, unknown>
): Promise<void> {
  const supabase = getSupabaseServerClient();
  const channel = supabase.channel(`chat:conversation:${conversationRealId}`);
  try {
    await channel.httpSend(event, payload);
  } catch (error) {
    console.error(
      `[chat service] broadcastChatEvent(${event}) failed:`,
      error instanceof Error ? error.message : "unknown error"
    );
  } finally {
    await supabase.removeChannel(channel);
  }
}

// ============================================================================
// Translations (private)
// ============================================================================

/** Missing translations are a normal state (not yet translated) — an
 * empty object for that message, never an error. */
async function loadTranslationsForMessages(messageIds: string[]): Promise<Map<string, MessageTranslations>> {
  const map = new Map<string, MessageTranslations>();
  if (messageIds.length === 0) return map;

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("message_translations")
    .select("message_id, target_language, translated_text")
    .in("message_id", messageIds)
    .returns<MessageTranslationRow[]>();

  if (error) {
    console.error("[chat service] loadTranslationsForMessages query failed:", error.message);
    throw new Error("Failed to load message translations.");
  }

  for (const row of data ?? []) {
    const existing = map.get(row.message_id) ?? {};
    existing[row.target_language as SupportedLanguage] = row.translated_text;
    map.set(row.message_id, existing);
  }
  return map;
}

interface MessageOriginalRow {
  conversation_id: string;
  original_text: string;
  original_language: string;
}

interface MessageTranslationTextRow {
  translated_text: string;
}

export type EnsureMessageTranslationResult = { status: "ok"; text: string } | { status: "error" };

/**
 * Ensures a translation exists for (messageId, targetLanguage), creating
 * it via DeepL and persisting it if it doesn't already exist. This is the
 * ONE place that decides whether DeepL needs to be called at all — every
 * translation entry point (loading a conversation, sending a message, a
 * manual retry) goes through this, so a translation is never requested
 * twice for the same pair.
 *
 * Never throws for a translation failure — DeepL being down or
 * unconfigured is always represented as { status: "error" }, so a caller
 * that just persisted an original message (see sendMessage) can never
 * have that unrelated success turned into a thrown exception by a
 * translation problem.
 */
export async function ensureMessageTranslation(
  messageId: string,
  targetLanguage: SupportedLanguage
): Promise<EnsureMessageTranslationResult> {
  const supabase = getSupabaseServerClient();

  // 1. Already cached? Never call DeepL again if so.
  const { data: existing, error: existingError } = await supabase
    .from("message_translations")
    .select("translated_text")
    .eq("message_id", messageId)
    .eq("target_language", targetLanguage)
    .maybeSingle<MessageTranslationTextRow>();

  if (existingError) {
    console.error("[chat service] ensureMessageTranslation lookup failed:", existingError.message);
    return { status: "error" };
  }
  if (existing) {
    return { status: "ok", text: existing.translated_text };
  }

  // 2. Load just enough of the original to check the same-language
  // passthrough and to translate — never touches messages.original_text
  // as a write target, only reads it.
  const { data: message, error: messageError } = await supabase
    .from("messages")
    .select("conversation_id, original_text, original_language")
    .eq("id", messageId)
    .maybeSingle<MessageOriginalRow>();

  if (messageError) {
    console.error("[chat service] ensureMessageTranslation message lookup failed:", messageError.message);
    return { status: "error" };
  }
  if (!message) {
    throw new Error(`ensureMessageTranslation: no message found for id "${messageId}".`);
  }

  if (message.original_language === targetLanguage) {
    return { status: "ok", text: message.original_text };
  }

  // 3. Not cached and genuinely cross-language — call DeepL.
  const translated = await translateWithDeepL(message.original_text, targetLanguage);
  if (translated.status !== "translated") {
    return { status: "error" };
  }

  // 4. Persist. A concurrent request could have inserted the same
  // (message_id, target_language) pair between step 1 and here — the
  // unique constraint catches that (Postgres error 23505); re-read and
  // return the winner's row instead of treating it as a failure.
  const { data: inserted, error: insertError } = await supabase
    .from("message_translations")
    .insert({
      message_id: messageId,
      target_language: targetLanguage,
      translated_text: translated.text,
      provider: "deepl",
    })
    .select("translated_text")
    .single<MessageTranslationTextRow>();

  if (insertError) {
    if (insertError.code === "23505") {
      const { data: winner, error: winnerError } = await supabase
        .from("message_translations")
        .select("translated_text")
        .eq("message_id", messageId)
        .eq("target_language", targetLanguage)
        .maybeSingle<MessageTranslationTextRow>();

      if (winnerError || !winner) {
        console.error(
          "[chat service] ensureMessageTranslation could not re-read after conflict:",
          winnerError?.message ?? "no row found"
        );
        return { status: "error" };
      }
      return { status: "ok", text: winner.translated_text };
    }

    console.error("[chat service] ensureMessageTranslation insert failed:", insertError.message);
    return { status: "error" };
  }

  // Broadcast only for a genuinely fresh insert — not the cache hit in
  // step 1, and not the conflict-reread above (whoever won that race
  // already broadcast this exact data).
  await broadcastChatEvent(message.conversation_id, "chat.translation.created", {
    messageId,
    targetLanguage,
    translatedText: inserted.translated_text,
  });

  return { status: "ok", text: inserted.translated_text };
}

// ============================================================================
// Pure helpers (private)
// ============================================================================

/** Reproduces the demo model's `readAt` semantics from
 * conversation_members.last_read_at: only meaningful for messages the
 * viewer received (never for their own sent messages, which is also how
 * the current UI already treats it), and only set once the viewer has
 * read past that message's timestamp. */
function deriveReadAt(params: {
  messageCreatedAt: string;
  isOwnMessage: boolean;
  viewerLastReadAt: string | null;
}): string | undefined {
  if (params.isOwnMessage) return undefined;
  if (!params.viewerLastReadAt) return undefined;
  return params.messageCreatedAt <= params.viewerLastReadAt ? params.viewerLastReadAt : undefined;
}

// ============================================================================
// Public: business operations
// ============================================================================

export interface LoadChatDataResult {
  conversations: ChatConversation[];
  messages: ChatMessage[];
}

/**
 * Loads every direct conversation (and its messages/existing translations)
 * between the current user and each colleague in `colleagueLegacyIds` that
 * already exists.
 *
 * `currentUserId` is the current user's real `profiles.id` UUID — the
 * caller (chat/page.tsx) derives it via getCurrentProfile(), never via
 * legacy id resolution (see the module doc comment's IDENTITY MODEL).
 * `colleagueLegacyIds` stays legacy-id-space, since colleague selection is
 * still driven by the static demo user list.
 *
 * STRICTLY READ-ONLY: this function must never call DeepL, insert a row,
 * or otherwise mutate anything — it reads conversations, messages, and
 * whatever message_translations rows already exist, and nothing else. That
 * makes it safe to execute during rendering, including Next.js's
 * build-time page-data-collection for /chat, without triggering a real
 * DeepL call or writing to the database as a side effect of a GET-shaped
 * operation. A message whose needed translation isn't cached yet is
 * returned with that translation simply absent — the caller (chat-view.tsx)
 * is responsible for requesting it explicitly, after the page is actually
 * running, through the same persistent translation Server Action used for
 * manual retries. Colleague pairs with no conversation yet simply
 * contribute nothing, matching the existing "no messages yet" empty state.
 */
export async function loadChatDataForUser(
  currentUserId: string,
  colleagueLegacyIds: string[]
): Promise<LoadChatDataResult> {
  const colleagueLegacyToProfile = await resolveProfileIdsByLegacyIds(colleagueLegacyIds);
  const colleagueProfileIdToLegacyId = new Map(
    Array.from(colleagueLegacyToProfile.entries()).map(([legacyId, profile]) => [profile.id, legacyId])
  );

  const supabase = getSupabaseServerClient();
  const conversations: ChatConversation[] = [];
  const messages: ChatMessage[] = [];

  for (const colleagueLegacyId of colleagueLegacyIds) {
    const colleague = colleagueLegacyToProfile.get(colleagueLegacyId);
    if (!colleague) {
      throw new Error(`No profile found for legacy id "${colleagueLegacyId}".`);
    }

    const conversationId = await findDirectConversation(currentUserId, colleague.id);
    if (!conversationId) continue;

    const clientConversationId = buildConversationClientId(currentUserId, colleagueLegacyId);
    conversations.push({
      id: clientConversationId,
      participantIds: [currentUserId, colleagueLegacyId],
      realId: conversationId,
    });

    const { data: memberRow, error: memberError } = await supabase
      .from("conversation_members")
      .select("last_read_at")
      .eq("conversation_id", conversationId)
      .eq("profile_id", currentUserId)
      .maybeSingle<ConversationMemberReadRow>();

    if (memberError) {
      console.error("[chat service] conversation_members query failed:", memberError.message);
      throw new Error("Failed to load conversation read state.");
    }
    const viewerLastReadAt = memberRow?.last_read_at ?? null;

    const { data: messageRows, error: messagesError } = await supabase
      .from("messages")
      .select("id, sender_profile_id, original_text, original_language, detected_source_language, created_at")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .returns<MessageRow[]>();

    if (messagesError) {
      console.error("[chat service] messages query failed:", messagesError.message);
      throw new Error("Failed to load messages.");
    }

    const rows = messageRows ?? [];
    const translationsByMessage = await loadTranslationsForMessages(rows.map((row) => row.id));

    for (const row of rows) {
      const isOwnMessage = row.sender_profile_id === currentUserId;
      // Own messages use the real UUID directly (it's already the current
      // user's own id); anyone else's message must resolve to the
      // colleague's legacy id — see the module doc comment's IDENTITY MODEL.
      const senderId = isOwnMessage ? currentUserId : colleagueProfileIdToLegacyId.get(row.sender_profile_id);
      if (!senderId) {
        throw new Error(`Message ${row.id} has a sender outside the requested participant set.`);
      }
      const originalLanguage = row.original_language as SupportedLanguage;
      // Whatever is already cached — never requested here. A message whose
      // needed translation isn't in this map yet is returned as-is; see
      // this function's doc comment for why, and chat-view.tsx for where
      // that gets requested instead.
      const translations = translationsByMessage.get(row.id) ?? {};

      messages.push({
        id: row.id,
        conversationId: clientConversationId,
        senderId,
        recipientId: isOwnMessage ? colleagueLegacyId : currentUserId,
        originalText: row.original_text,
        originalLanguage,
        detectedLanguage: (row.detected_source_language as SupportedLanguage | null) ?? undefined,
        translations,
        createdAt: row.created_at,
        readAt: deriveReadAt({
          messageCreatedAt: row.created_at,
          isOwnMessage,
          viewerLastReadAt,
        }),
      });
    }
  }

  return { conversations, messages };
}

export interface SendMessageInput {
  /** Client-generated UUID (crypto.randomUUID()), preserved as-is — this
   * is what lets the client de-duplicate its own optimistic insert once
   * Realtime is added later. */
  id: string;
  /** The acting user's real `profiles.id` UUID. Callers must derive this
   * server-side via getCurrentProfile() — never accept it as client input.
   * See the module doc comment's IDENTITY MODEL. */
  senderProfileId: string;
  /** The colleague being messaged — still legacy-id-space; see the module
   * doc comment. */
  recipientLegacyId: string;
  text: string;
  originalLanguage: SupportedLanguage;
}

export interface SendMessageResult {
  message: ChatMessage;
  /** Real conversation UUID — needed by the client only to subscribe to
   * this conversation's Realtime channel, particularly when this send is
   * what just created the conversation (see chat-view.tsx). */
  conversationRealId: string;
}

/**
 * Persists one message, then — if the recipient's language differs from
 * the original — attempts to translate and persist it too. The insert is
 * the only part that can make this function report failure; translation
 * is strictly best-effort afterward and can never undo or taint an
 * already-successful send (see ensureMessageTranslation's own contract,
 * and the try/catch below as a second layer of the same guarantee).
 */
export async function sendMessage(input: SendMessageInput): Promise<SendMessageResult> {
  const text = input.text.trim();
  if (!text) {
    throw new Error("sendMessage: text must not be empty.");
  }

  const recipient = await resolveProfileIdByLegacyId(input.recipientLegacyId);

  const conversationId = await findOrCreateDirectConversation(input.senderProfileId, recipient.id);

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("messages")
    .insert({
      id: input.id,
      conversation_id: conversationId,
      sender_profile_id: input.senderProfileId,
      original_text: text,
      original_language: input.originalLanguage,
    })
    .select("id, original_text, original_language, created_at")
    .single<InsertedMessageRow>();

  if (error) {
    console.error("[chat service] Failed to insert message:", error.message);
    throw new Error("Failed to send the message.");
  }

  // The original is safely persisted at this point, unconditionally.
  // Broadcast it immediately — before the translation attempt below, so a
  // subscriber always sees the message arrive first and any translation
  // patch in afterward, exactly as the UI already presents it locally.
  //
  // senderProfileId is the one identity field carried here — already on
  // hand for free (it's exactly input.senderProfileId, no extra lookup),
  // and necessary: a subscriber can't otherwise tell "this message is from
  // the colleague" apart from "this is my own send, echoed to another tab
  // of my own session" (the same real user can have this conversation open
  // in more than one tab). The receiving client only ever needs to compare
  // it against its own known real UUID — never a legacy id, so this adds
  // no new dependency on that bridge.
  await broadcastChatEvent(conversationId, "chat.message.created", {
    id: data.id,
    senderProfileId: input.senderProfileId,
    originalText: data.original_text,
    originalLanguage: data.original_language,
    createdAt: data.created_at,
  });

  // Everything below is best-effort on top of the already-persisted,
  // already-broadcast original.
  let translations: MessageTranslations = {};
  if (input.originalLanguage !== recipient.preferredLanguage) {
    try {
      const ensured = await ensureMessageTranslation(data.id, recipient.preferredLanguage);
      if (ensured.status === "ok") {
        translations = { [recipient.preferredLanguage]: ensured.text };
      }
    } catch (translationError) {
      console.error(
        "[chat service] Translation after send failed (message still sent):",
        translationError instanceof Error ? translationError.message : "unknown error"
      );
    }
  }

  return {
    message: {
      id: data.id,
      conversationId: buildConversationClientId(input.senderProfileId, input.recipientLegacyId),
      senderId: input.senderProfileId,
      recipientId: input.recipientLegacyId,
      originalText: data.original_text,
      originalLanguage: data.original_language as SupportedLanguage,
      translations,
      createdAt: data.created_at,
    },
    conversationRealId: conversationId,
  };
}

/**
 * Updates only conversation_members.last_read_at for the viewer. A no-op
 * (not an error) if no conversation exists yet between the two people —
 * there's nothing to mark read.
 *
 * `viewerProfileId` is the acting user's real `profiles.id` UUID — callers
 * must derive it server-side via getCurrentProfile(), never accept it as
 * client input (see the module doc comment's IDENTITY MODEL).
 * `colleagueLegacyId` stays legacy-id-space.
 */
export async function markConversationRead(viewerProfileId: string, colleagueLegacyId: string): Promise<void> {
  const colleague = await resolveProfileIdByLegacyId(colleagueLegacyId);

  const conversationId = await findDirectConversation(viewerProfileId, colleague.id);
  if (!conversationId) return;

  const supabase = getSupabaseServerClient();
  const { error } = await supabase
    .from("conversation_members")
    .update({ last_read_at: new Date().toISOString() })
    .eq("conversation_id", conversationId)
    .eq("profile_id", viewerProfileId);

  if (error) {
    console.error("[chat service] Failed to update last_read_at:", error.message);
    throw new Error("Failed to mark the conversation as read.");
  }
}
