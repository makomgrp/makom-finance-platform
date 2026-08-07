import type { ChatConversation, ChatMessage } from "@/types";

/**
 * Deterministic conversation id for a 1:1 pair, independent of argument order.
 * Mirrors how a future `conversations` lookup keyed by member pair would work.
 */
export function getConversationId(userIdA: string, userIdB: string): string {
  return [userIdA, userIdB].sort().join("__");
}

export const CONVERSATIONS: ChatConversation[] = [
  { id: getConversationId("u-001", "u-002"), participantIds: ["u-001", "u-002"] },
  { id: getConversationId("u-001", "u-003"), participantIds: ["u-001", "u-003"] },
  { id: getConversationId("u-001", "u-004"), participantIds: ["u-001", "u-004"] },
  { id: getConversationId("u-001", "u-005"), participantIds: ["u-001", "u-005"] },
  { id: getConversationId("u-001", "u-006"), participantIds: ["u-001", "u-006"] },
];

// All fictitious, internal ODL Financial staff chatter about the demo pipeline —
// never real client data. Client names referenced (Juan Pérez, Ana Gómez,
// Katherine Solís, Franklin Ortega) are the same fictional records already
// used across the CRM demo dataset.
export const CHAT_MESSAGES: ChatMessage[] = [
  // Gabriel Herrera (en) <-> Marisol Duarte (es)
  {
    id: "msg-001",
    conversationId: getConversationId("u-001", "u-002"),
    senderId: "u-001",
    recipientId: "u-002",
    originalText: "Please review Juan Perez's application before noon.",
    originalLanguage: "en",
    translations: {
      es: "Por favor revisa la solicitud de Juan Pérez antes del mediodía.",
      fr: "Veuillez examiner la demande de Juan Pérez avant midi.",
    },
    createdAt: "2026-08-04T09:15:00-05:00",
    readAt: "2026-08-04T09:20:00-05:00",
  },
  {
    id: "msg-002",
    conversationId: getConversationId("u-001", "u-002"),
    senderId: "u-002",
    recipientId: "u-001",
    originalText: "Entendido, la reviso ahora mismo.",
    originalLanguage: "es",
    translations: {
      en: "Understood, I'll review it right now.",
      fr: "Compris, je la révise tout de suite.",
    },
    createdAt: "2026-08-04T09:22:00-05:00",
    readAt: "2026-08-04T09:30:00-05:00",
  },
  {
    id: "msg-003",
    conversationId: getConversationId("u-001", "u-002"),
    senderId: "u-002",
    recipientId: "u-001",
    originalText:
      "Ya aprobé la solicitud de Juan Pérez. Puedes revisar el expediente cuando quieras.",
    originalLanguage: "es",
    translations: {
      en: "I already approved Juan Pérez's application. You can check the file whenever you'd like.",
      fr: "J'ai déjà approuvé la demande de Juan Pérez. Vous pouvez consulter le dossier quand vous voulez.",
    },
    createdAt: "2026-08-05T08:05:00-05:00",
  },

  // Gabriel Herrera (en) <-> Ricardo Sanjur (es)
  {
    id: "msg-004",
    conversationId: getConversationId("u-001", "u-003"),
    senderId: "u-003",
    recipientId: "u-001",
    originalText: "El reporte mensual de productividad está listo.",
    originalLanguage: "es",
    translations: {
      en: "The monthly productivity report is ready.",
      fr: "Le rapport mensuel de productivité est prêt.",
    },
    createdAt: "2026-07-30T11:00:00-05:00",
    readAt: "2026-07-30T11:30:00-05:00",
  },
  {
    id: "msg-005",
    conversationId: getConversationId("u-001", "u-003"),
    senderId: "u-001",
    recipientId: "u-003",
    originalText: "Thanks, I'll review it this week.",
    originalLanguage: "en",
    translations: {
      es: "Gracias, lo reviso esta semana.",
      fr: "Merci, je le consulterai cette semaine.",
    },
    createdAt: "2026-07-30T11:35:00-05:00",
    readAt: "2026-07-30T12:00:00-05:00",
  },

  // Gabriel Herrera (en) <-> Fernando Quintero (es)
  {
    id: "msg-006",
    conversationId: getConversationId("u-001", "u-004"),
    senderId: "u-004",
    recipientId: "u-001",
    originalText: "Katherine Solís completó el envío de todos sus documentos.",
    originalLanguage: "es",
    translations: {
      en: "Katherine Solís has submitted all of her documents.",
      fr: "Katherine Solís a soumis tous ses documents.",
    },
    createdAt: "2026-08-02T10:00:00-05:00",
    readAt: "2026-08-02T10:15:00-05:00",
  },
  {
    id: "msg-007",
    conversationId: getConversationId("u-001", "u-004"),
    senderId: "u-001",
    recipientId: "u-004",
    originalText: "Perfect, please schedule her credit evaluation.",
    originalLanguage: "en",
    translations: {
      es: "Perfecto, por favor agenda su evaluación de crédito.",
      fr: "Parfait, veuillez programmer son évaluation de crédit.",
    },
    createdAt: "2026-08-02T10:20:00-05:00",
    readAt: "2026-08-02T10:25:00-05:00",
  },

  // Gabriel Herrera (en) <-> Lucía Batista (fr)
  {
    id: "msg-008",
    conversationId: getConversationId("u-001", "u-005"),
    senderId: "u-005",
    recipientId: "u-001",
    originalText: "Veuillez vérifier les documents d'Ana Gómez avant demain.",
    originalLanguage: "fr",
    translations: {
      en: "Please check Ana Gómez's documents before tomorrow.",
      es: "Por favor revisa los documentos de Ana Gómez antes de mañana.",
    },
    createdAt: "2026-08-03T14:00:00-05:00",
    readAt: "2026-08-03T15:00:00-05:00",
  },
  {
    id: "msg-009",
    conversationId: getConversationId("u-001", "u-005"),
    senderId: "u-001",
    recipientId: "u-005",
    originalText: "Got it, I'll check them this afternoon.",
    originalLanguage: "en",
    translations: {
      es: "Entendido, los reviso esta tarde.",
      fr: "Compris, je les vérifie cet après-midi.",
    },
    createdAt: "2026-08-03T15:05:00-05:00",
    readAt: "2026-08-03T15:10:00-05:00",
  },
  {
    id: "msg-010",
    conversationId: getConversationId("u-001", "u-005"),
    senderId: "u-001",
    recipientId: "u-005",
    originalText: "All six documents are verified. Great work.",
    originalLanguage: "en",
    translations: {
      es: "Los seis documentos están verificados. Buen trabajo.",
      fr: "Les six documents sont vérifiés. Excellent travail.",
    },
    createdAt: "2026-08-03T18:20:00-05:00",
    readAt: "2026-08-03T18:40:00-05:00",
  },
  {
    id: "msg-011",
    conversationId: getConversationId("u-001", "u-005"),
    senderId: "u-005",
    recipientId: "u-001",
    originalText: "Merci beaucoup ! Je commence l'évaluation aujourd'hui.",
    originalLanguage: "fr",
    translations: {
      en: "Thank you so much! I'll start the evaluation today.",
      es: "¡Muchas gracias! Comienzo la evaluación hoy.",
    },
    createdAt: "2026-08-05T07:30:00-05:00",
  },

  // Gabriel Herrera (en) <-> Diego Espino (en) — same preferred language, no
  // translation needed; demonstrates the pass-through case.
  {
    id: "msg-012",
    conversationId: getConversationId("u-001", "u-006"),
    senderId: "u-006",
    recipientId: "u-001",
    originalText: "Franklin Ortega's application was cancelled at his request.",
    originalLanguage: "en",
    translations: {},
    createdAt: "2026-08-01T16:00:00-05:00",
    readAt: "2026-08-01T16:10:00-05:00",
  },
  {
    id: "msg-013",
    conversationId: getConversationId("u-001", "u-006"),
    senderId: "u-001",
    recipientId: "u-006",
    originalText: "Understood, please close the file.",
    originalLanguage: "en",
    translations: {},
    createdAt: "2026-08-01T16:12:00-05:00",
    readAt: "2026-08-01T16:20:00-05:00",
  },
];

export function getMessagesForConversation(conversationId: string, messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter((message) => message.conversationId === conversationId)
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
}
