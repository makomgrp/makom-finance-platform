import type { ContactMethod, ContactOutcome } from "@/types";

/**
 * The vocabularies, in the one order the UI ever offers them.
 *
 * Kept beside the other config lists rather than in the service, because both
 * the server action (validating input) and the client form (rendering options)
 * need them, and a client component cannot import from a `server-only` module.
 * One list, so an option that appears in the form is by construction one the
 * action accepts.
 */
export const CONTACT_METHODS: readonly ContactMethod[] = [
  "call",
  "whatsapp",
  "email",
  "other",
] as const;

/**
 * CONTACT OUTCOMES — what happened on the call. Deliberately NOT pipeline
 * stages: none of these can move a customer's portal progress, which only their
 * own actions do.
 */
export const CONTACT_OUTCOMES: readonly ContactOutcome[] = [
  "contacted",
  "no_answer",
  "customer_responded",
  "waiting_customer",
  "follow_up_scheduled",
  "other",
] as const;
