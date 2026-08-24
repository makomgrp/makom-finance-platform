import "server-only";

import { getTranslations } from "next-intl/server";
import { SYSTEM_NATIONAL_SCOPE } from "@/lib/services/branch-scope-query";
import { getApplicationById } from "@/lib/services/applications";
import { getApplicationIntakeById } from "@/lib/services/application-intakes";
import {
  outboundMessageExistsForSendKey,
  persistOutboundMessage,
  recordEmailSentEvent,
} from "@/lib/services/email-messages";
import { sendMail } from "@/lib/services/email-smtp";
import { getMailboxAddress } from "@/lib/config/mail";
import { formatDateTime } from "@/lib/format";
import { isFormalApplication } from "@/types";

/**
 * ============================================================================
 * MILESTONE 26B-17 — TELLING THE APPLICANT WE HAVE THEIR APPLICATION
 * ============================================================================
 *
 * A person finishes a loan application, sees a confirmation screen, closes the
 * tab — and until now had nothing at all afterwards. No number they could
 * quote, no evidence the thing arrived. This sends exactly one email saying
 * ODL received it, and is the ONLY place that decides what that email says.
 *
 * ----------------------------------------------------------------------------
 * THE APPLICATION IS THE OPERATION. THIS IS NOT.
 * ----------------------------------------------------------------------------
 * Every function here returns rather than throws, and every caller invokes it
 * from `after()` — after the response has already gone to the applicant. A
 * mail server that is slow, unreachable or misconfigured must not be able to
 * make a successfully received application look like a failed one. The
 * confirmation screen is drawn from `submitted_at` in the database and owes
 * nothing to this file.
 *
 * ----------------------------------------------------------------------------
 * NOTHING IS TAKEN FROM THE CALLER EXCEPT AN ID
 * ----------------------------------------------------------------------------
 * The recipient, the name, the number, the date and the language are all
 * re-read here from the persisted rows. A caller cannot pass an address, a
 * subject or a body, which is what keeps this from becoming a send-anything
 * endpoint reachable from the public portal. The envelope sender is not even
 * visible to this module — `sendMail` reads it from the server environment.
 *
 * ----------------------------------------------------------------------------
 * WHAT IT DELIBERATELY DOES NOT SAY
 * ----------------------------------------------------------------------------
 * No identification number, no salary, no bank details, no attachments, no
 * link into the CRM. Confirmation mail travels to whatever inbox the applicant
 * typed, possibly a shared or work one, and none of that belongs there. The
 * number and the date are enough to identify the file in a phone call.
 *
 * It also says, in both languages and in the first paragraph, that receiving an
 * application is not approving it. That sentence is the point of the email as
 * much as the number is.
 */

/**
 * Why the confirmation did not go out. Reported, never thrown, and never shown
 * to the applicant — the caller logs it and carries on.
 */
export type ConfirmationOutcome =
  | { status: "sent"; applicationNumber: string }
  /** Already sent earlier, or already recorded. Not an error. */
  | { status: "skipped"; reason: "already_sent" }
  /** Nothing to send to, or nothing formal to send about. */
  | { status: "skipped"; reason: "no_recipient" | "not_formal" | "not_found" }
  | { status: "failed"; reason: "smtp" | "not_configured"; code: string }
  /**
   * SMTP may or may not have delivered it. Never retried automatically — see
   * `sendMail`'s own note. A duplicate to a customer cannot be withdrawn.
   */
  | { status: "uncertain"; code: string };

/** Deterministic per application, so a retry collides instead of duplicating. */
export function confirmationSendKey(applicationId: string): string {
  return `application-confirmation:${applicationId}`;
}

/**
 * Send the confirmation for one already-persisted application.
 *
 * Safe to call more than once: the send key is checked before SMTP and again,
 * as a unique index, on the way into `email_messages`.
 */
export async function sendApplicationConfirmationEmail(
  intakeId: string
): Promise<ConfirmationOutcome> {
  const intakeResult = await getApplicationIntakeById(intakeId);
  if (intakeResult.status !== "ok") return { status: "skipped", reason: "not_found" };
  const intake = intakeResult.intake;

  const applicationId = intake.createdApplicationId;
  if (!applicationId) return { status: "skipped", reason: "not_formal" };

  // SYSTEM scope, not a branch scope: this is the platform acting on its own
  // behalf, and the applicant's branch must not decide whether they hear back.
  const applicationResult = await getApplicationById(SYSTEM_NATIONAL_SCOPE, applicationId);
  if (applicationResult.status !== "ok") return { status: "skipped", reason: "not_found" };
  const application = applicationResult.application;

  // A draft has no number and has not been handed to ODL. Confirming one would
  // be telling somebody their application arrived when it has not.
  if (!isFormalApplication(application.status) || !application.applicationNumber) {
    return { status: "skipped", reason: "not_formal" };
  }

  const recipient = intake.applicantEmail?.trim();
  if (!recipient) return { status: "skipped", reason: "no_recipient" };

  const sendKey = confirmationSendKey(applicationId);
  if (await outboundMessageExistsForSendKey(sendKey)) {
    return { status: "skipped", reason: "already_sent" };
  }

  const mailbox = getMailboxAddress();
  if (!mailbox) {
    // The same condition `sendMail` would report, caught early so the reason is
    // named rather than arriving as a generic send failure.
    return { status: "failed", reason: "not_configured", code: "no_mailbox" };
  }

  const { subject, text } = await composeConfirmation({
    locale: intake.locale,
    name: intake.applicantFullName?.trim() || undefined,
    applicationNumber: application.applicationNumber,
    // `submitted_at` is when ODL received it. `createdAt` only ever stands in
    // for the one-shot channel, where the two are the same instant anyway.
    submittedAt: intake.submittedAt ?? application.createdAt,
  });

  const sent = await sendMail({ to: [recipient], subject, text });

  if (sent.status === "uncertain") {
    // No retry, and no `email_sent` event: we do not know that it was sent, and
    // recording it as sent would make a duplicate look impossible later.
    console.error(
      "[portal-confirmation] SMTP outcome UNCERTAIN — not retried, not recorded.",
      JSON.stringify({ applicationId, applicationNumber: application.applicationNumber, code: sent.code })
    );
    return { status: "uncertain", code: sent.code };
  }

  if (sent.status === "error") {
    console.error(
      "[portal-confirmation] Confirmation email failed.",
      JSON.stringify({
        applicationId,
        applicationNumber: application.applicationNumber,
        code: sent.code,
        // Names of missing variables only — never values. See config/mail.ts.
        missing: sent.missing,
      })
    );
    return {
      status: "failed",
      reason: sent.code === "not_configured" ? "not_configured" : "smtp",
      code: sent.code,
    };
  }

  const persisted = await persistOutboundMessage({
    mailbox,
    messageId: sent.messageId,
    to: [recipient],
    cc: [],
    bcc: [],
    subject,
    bodyText: text,
    sentAt: new Date().toISOString(),
    // Nobody wrote this. See the note on the field.
    sentByProfileId: null,
    linkedClientId: application.clientId,
    linkedApplicationId: applicationId,
    replyToEmailId: null,
    forwardedFromEmailId: null,
    inReplyTo: null,
    sendKey,
    attribution: "system",
  });

  if (persisted.status === "duplicate") {
    // A concurrent caller won the race between the lookup above and this
    // insert. Their mail is the one on record; ours is the duplicate.
    return { status: "skipped", reason: "already_sent" };
  }

  if (persisted.status === "error") {
    // The applicant HAS the email. Only the CRM's copy is missing, which a
    // person can reconcile; saying "failed" here would be untrue.
    console.error(
      "[portal-confirmation] Email sent but not recorded in the CRM.",
      JSON.stringify({ applicationId, messageId: sent.messageId })
    );
    return { status: "sent", applicationNumber: application.applicationNumber };
  }

  await recordEmailSentEvent({
    emailId: persisted.id,
    clientId: application.clientId,
    applicationId,
    subject,
    // System actor. The RPC derives actor_kind from this being null.
    actorProfileId: null,
    source: "website_form",
  });

  return { status: "sent", applicationNumber: application.applicationNumber };
}

/**
 * Build the two strings that get sent.
 *
 * PLAIN TEXT, deliberately, and not as a limitation to be lifted casually:
 * `sendMail` accepts only `text` and explains why. ODL's institutional styling
 * is a later milestone that needs their logo and brand book; a hand-rolled HTML
 * template now would be thrown away and would add an escaping surface to a
 * message assembled from a name somebody typed into a public form.
 *
 * The greeting falls back to a neutral form rather than printing "Hola ," when
 * the applicant left their name blank.
 */
async function composeConfirmation(input: {
  locale: "es" | "en";
  name?: string;
  applicationNumber: string;
  submittedAt: string;
}): Promise<{ subject: string; text: string }> {
  const t = await getTranslations({
    locale: input.locale,
    namespace: "portalConfirmationEmail",
  });

  // The one institutional formatter (26B-15A): America/Panama on both sides of
  // the wire, so the hour in the email is the hour ODL's staff will read.
  const date = formatDateTime(input.submittedAt, input.locale);

  const subject = t("subject", { applicationNumber: input.applicationNumber });

  const greeting = input.name
    ? t("greeting", { name: input.name })
    : `${t("greeting", { name: "" }).replace(/[\s,]+$/, "")},`;

  const text = [
    t("heading"),
    "",
    greeting,
    "",
    t("intro"),
    "",
    `${t("numberLabel")}: ${input.applicationNumber}`,
    `${t("dateLabel")}: ${date}`,
    "",
    t("keepNumber"),
    "",
    t("nextTitle"),
    "",
    `1. ${t("next1")}`,
    `2. ${t("next2")}`,
    `3. ${t("next3")}`,
    "",
    t("signature"),
    "",
    t("automatic"),
  ].join("\n");

  return { subject, text };
}
