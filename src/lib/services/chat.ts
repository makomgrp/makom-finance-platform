import "server-only";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { translateWithDeepL } from "@/lib/services/deepl";
import type { ChatConversation, ChatMessage, MessageTranslations, SupportedLanguage } from "@/types";

/**
 * Server-only chat data service — the persistence layer behind the chat
 * module, backed by the `conversations` / `conversation_members` /
 * `messages` / `message_translations` tables.
 *
 * IDENTITY MODEL — ONE SPACE, `profiles.id` UUIDs (Milestone 21).
 *
 * Every id this service accepts, returns or stores is a real `profiles.id`
 * UUID. The acting user comes from getCurrentProfile() in a Server Action,
 * never from client input; the colleague comes from getChatColleagues(),
 * which queries `profiles` directly.
 *
 * WHAT MILESTONE 21 REMOVED, AND WHY IT WAS SAFE. Until then the colleague
 * side lived in a second identity space: the demo "u-00N" legacy ids from
 * src/lib/demo-data/users.ts, translated to and from real UUIDs by
 * resolveProfileIdByLegacyId / resolveProfileIdsByLegacyIds and a reverse
 * map. That bridge is gone, along with the static list and the deleted
 * demo-data/users.ts.
 *
 * It required NO data migration. The database was already correct —
 * conversation_members.profile_id and messages.sender_profile_id have always
 * been uuid foreign keys to profiles(id), and live verification found zero
 * orphans across 8 conversations, 16 memberships and 30 messages. The legacy
 * id existed only in memory, at this service's boundary. Not one persisted
 * chat row was read, rewritten or migrated to retire it.
 *
 * A CONSEQUENCE WORTH KNOWING: a message's sender is now rendered straight
 * from the stored `sender_profile_id`, so historical messages from people who
 * are no longer selectable contacts — deactivated staff, pending invitees —
 * keep displaying their correct author. Eligibility governs who you can START
 * a conversation with (see getChatColleagues), never what was already said.
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
 * real UUID. The browser never publishes, only
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
// Profile language lookup (private)
// ============================================================================
//
// MILESTONE 21 removed resolveProfileIdByLegacyId / resolveProfileIdsByLegacyIds
// and the colleagueProfileIdToLegacyId reverse map. There is no longer any
// translation between identity spaces: every id entering, leaving or stored
// by this service is a `profiles.id` UUID.
//
// That was a pure code change. The database was ALREADY profile-UUID-native —
// conversation_members.profile_id and messages.sender_profile_id are uuid FKs
// to profiles(id), verified live with zero orphans across 8 conversations, 16
// memberships and 30 messages. The legacy id only ever existed in memory, at
// this service's boundary, so removing it required no data migration and
// rewrote no historical record.
//
// What remains is a narrow lookup of one display fact — the recipient's
// preferred language, needed to decide whether to translate.

/** Batched preferred-language lookup by profile UUID. Throws listing every
 * id that failed to resolve: an unresolvable profile id means the caller was
 * handed an identity that does not exist, which is a data/config problem,
 * not a normal runtime state. */
async function resolveProfileLanguages(profileIds: string[]): Promise<Map<string, ProfileIdentity>> {
  const uniqueIds = Array.from(new Set(profileIds));
  if (uniqueIds.length === 0) return new Map();

  const supabase = getSupabaseServerClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, preferred_language")
    .in("id", uniqueIds)
    .returns<ProfileIdentityRow[]>();

  if (error) {
    console.error("[chat service] resolveProfileLanguages query failed:", error.message);
    throw new Error("Failed to resolve profiles for the given ids.");
  }

  const map = new Map<string, ProfileIdentity>();
  for (const row of data ?? []) {
    map.set(row.id, { id: row.id, preferredLanguage: row.preferred_language as SupportedLanguage });
  }

  const missing = uniqueIds.filter((id) => !map.has(id));
  if (missing.length > 0) {
    throw new Error(`No profile found for id(s): ${missing.join(", ")}.`);
  }

  return map;
}

/** Deterministic client-facing conversation id, matching
 * demo-data/chat.ts's getConversationId() exactly. Deliberately
 * reimplemented here rather than imported, so this service has no
 * dependency on demo data — see the module doc comment. As of Milestone 21
 * both sides are always `profiles.id` UUIDs; there is no longer a mixed
 * identity space for it to bridge. */
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
 * between the current user and each colleague in `colleagueProfileIds` that
 * already exists.
 *
 * MILESTONE 21: both arguments are now `profiles.id` UUIDs. `currentUserId`
 * comes from getCurrentProfile(); `colleagueProfileIds` comes from
 * getChatColleagues(), which queries `profiles` directly. There is no longer
 * a second identity space anywhere in this service.
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
  colleagueProfileIds: string[]
): Promise<LoadChatDataResult> {
  // Validates that every requested colleague exists; the languages it
  // returns are not needed for a read, but the existence check is the same
  // guarantee the old legacy resolution provided.
  await resolveProfileLanguages(colleagueProfileIds);

  const supabase = getSupabaseServerClient();
  const conversations: ChatConversation[] = [];
  const messages: ChatMessage[] = [];

  for (const colleagueProfileId of colleagueProfileIds) {
    const conversationId = await findDirectConversation(currentUserId, colleagueProfileId);
    if (!conversationId) continue;

    const clientConversationId = buildConversationClientId(currentUserId, colleagueProfileId);
    conversations.push({
      id: clientConversationId,
      participantIds: [currentUserId, colleagueProfileId],
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
      // MILESTONE 21: the stored sender id IS the identity the UI uses — no
      // translation, no lookup, no possibility of a sender falling outside a
      // "requested participant set". This is what makes historical messages
      // from people no longer in the colleague directory (deactivated staff,
      // pending invitees) keep rendering with their correct author.
      const senderId = row.sender_profile_id;
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
        recipientId: isOwnMessage ? colleagueProfileId : currentUserId,
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
  /** The colleague being messaged — a `profiles.id` UUID (Milestone 21). */
  recipientProfileId: string;
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

  // Only the recipient's preferred language is looked up; their identity is
  // already the UUID the caller supplied.
  const recipients = await resolveProfileLanguages([input.recipientProfileId]);
  const recipient = recipients.get(input.recipientProfileId);
  if (!recipient) {
    throw new Error(`No profile found for id "${input.recipientProfileId}".`);
  }

  const conversationId = await findOrCreateDirectConversation(
    input.senderProfileId,
    input.recipientProfileId
  );

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
      conversationId: buildConversationClientId(input.senderProfileId, input.recipientProfileId),
      senderId: input.senderProfileId,
      recipientId: input.recipientProfileId,
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
 * client input. `colleagueProfileId` is likewise a `profiles.id` UUID
 * (Milestone 21).
 */
export async function markConversationRead(
  viewerProfileId: string,
  colleagueProfileId: string
): Promise<void> {
  const conversationId = await findDirectConversation(viewerProfileId, colleagueProfileId);
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
