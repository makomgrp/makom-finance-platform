import "server-only";

import nodemailer from "nodemailer";
import { getSmtpConfig } from "@/lib/config/mail";

/**
 * ============================================================================
 * MILESTONE 26B-9B — THE ONLY PLACE THE CRM SENDS MAIL
 * ============================================================================
 *
 * Compose, Reply, Reply All and Forward are four buttons over ONE send
 * boundary. They differ in what they put in the fields; none of them gets its
 * own transport, its own credential handling, or its own idea of who the
 * sender is.
 *
 * ----------------------------------------------------------------------------
 * FROM IS NOT AN INPUT
 * ----------------------------------------------------------------------------
 * The envelope sender is read from the server environment on every send and
 * cannot be influenced by the caller. It is not a parameter, not an optional
 * override, and not something the browser submits — a CRM that let a request
 * body choose its own From is a CRM that can be used to send mail as anyone.
 *
 * ----------------------------------------------------------------------------
 * TLS IS NOT NEGOTIABLE
 * ----------------------------------------------------------------------------
 * Port 465 with implicit TLS, certificate verification left ON. There is no
 * `rejectUnauthorized: false` here and there must never be one: ODL's
 * certificate validates cleanly (verified in 26B-9A), so a failure means
 * something is genuinely wrong and is reported rather than worked around.
 *
 * ----------------------------------------------------------------------------
 * NOTHING SENSITIVE ESCAPES
 * ----------------------------------------------------------------------------
 * nodemailer errors quote server dialogue, which for an auth failure includes
 * the exchange itself. Every throw is reduced to a short code before it leaves
 * this module, so no credential and no recipient list reaches a log or a toast.
 */

export type SmtpErrorCode =
  | "not_configured"
  | "auth_failed"
  | "tls_failed"
  | "connection_failed"
  | "recipient_rejected"
  | "send_failed";

export interface OutboundMessage {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  /** Plain text only in 9B. See the composer's note on why. */
  text: string;
  /** RFC threading, when this is a reply. */
  inReplyTo?: string;
  references?: string[];
}

export type SendResult =
  | { status: "ok"; messageId: string; accepted: string[]; rejected: string[] }
  | { status: "error"; code: SmtpErrorCode; missing?: string[] }
  /**
   * THE DANGEROUS CASE, NAMED EXPLICITLY.
   *
   * The connection died after the message was handed over but before the
   * server's acceptance was read. The mail may or may not have been delivered
   * and there is no way to find out from here. Callers must NOT retry: a
   * duplicate email to a customer cannot be withdrawn, whereas a missing CRM
   * history row can be reconciled by a person. See the Server Action.
   */
  | { status: "uncertain"; code: SmtpErrorCode };

/**
 * Classifies a nodemailer failure, and — critically — decides whether the
 * outcome is KNOWN.
 *
 * A failure during connect or authentication happened before the server ever
 * saw the message, so nothing was sent and the caller may safely say so. A
 * failure after DATA is a different animal: the bytes are on the wire.
 */
function classify(error: unknown): { code: SmtpErrorCode; certain: boolean } {
  const err = error as { code?: string; responseCode?: number; command?: string; message?: string };
  const text = `${err?.message ?? ""}`.toLowerCase();
  const command = `${err?.command ?? ""}`.toUpperCase();

  if (err?.code === "EAUTH" || text.includes("invalid login") || text.includes("authentication")) {
    return { code: "auth_failed", certain: true };
  }
  if (text.includes("certificate") || text.includes("self-signed") || text.includes("self signed")) {
    return { code: "tls_failed", certain: true };
  }
  if (err?.code === "EENVELOPE" || (err?.responseCode && err.responseCode >= 500 && err.responseCode < 560)) {
    // The server refused a recipient. Nothing was delivered to it.
    return { code: "recipient_rejected", certain: true };
  }
  if (err?.code === "ETIMEDOUT" || err?.code === "ECONNECTION" || err?.code === "ESOCKET") {
    // A timeout on DATA means the payload may already have been accepted; a
    // timeout on connect or greeting means it certainly was not.
    const afterHandover = command === "DATA" || command === ".";
    return { code: "connection_failed", certain: !afterHandover };
  }
  return { code: "send_failed", certain: true };
}

/**
 * Sends one message as prestamo@odlfinanciera.com.
 *
 * NO AUTOMATIC RETRY, IN ANY FORM. Not on timeout, not on a 4xx, not once.
 * nodemailer cannot tell us reliably whether a connection that died mid-DATA
 * resulted in delivery, and the failure mode of guessing wrong is a customer
 * receiving the same message twice from a lender. When the outcome is unknown
 * this returns `uncertain` and lets a human decide.
 */
export async function sendMail(message: OutboundMessage): Promise<SendResult> {
  const configResult = getSmtpConfig();
  if (configResult.status !== "ok") {
    return { status: "error", code: "not_configured", missing: configResult.missing };
  }
  const { host, port, secure, user, password } = configResult.config;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass: password },
    // Bounded so a Server Action cannot hang indefinitely. Generous rather
    // than tight: 26B-9A found ODL's host slow to greet on a cold path, and
    // timing out a healthy server is its own kind of failure.
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
    // No `tls: { rejectUnauthorized: false }`. Deliberate; see the header.
  });

  try {
    const info = await transporter.sendMail({
      // SERVER-CONTROLLED. Never from the request.
      from: user,
      to: message.to,
      cc: message.cc?.length ? message.cc : undefined,
      bcc: message.bcc?.length ? message.bcc : undefined,
      subject: message.subject,
      // PLAIN TEXT ONLY. nodemailer escapes nothing for us and an HTML body
      // assembled from staff input is a way to put active content into a
      // customer's inbox under ODL's name. Text has no such surface.
      text: message.text,
      inReplyTo: message.inReplyTo,
      references: message.references?.length ? message.references : undefined,
    });

    return {
      status: "ok",
      messageId: info.messageId,
      accepted: (info.accepted ?? []).map(String),
      rejected: (info.rejected ?? []).map(String),
    };
  } catch (error) {
    const { code, certain } = classify(error);
    // The raw error is never returned and never logged in full — it can quote
    // the SMTP dialogue, including authentication.
    console.error("[email smtp] send failed:", code, certain ? "(certain)" : "(UNCERTAIN)");
    return certain ? { status: "error", code } : { status: "uncertain", code };
  } finally {
    transporter.close();
  }
}

/**
 * Opens a connection and authenticates without sending anything.
 *
 * Exists so the SMTP path can be proven end-to-end BEFORE a real message is
 * put in front of a real recipient — the milestone requires no customer be
 * used for testing, and this verifies credentials and TLS with nobody in the
 * loop at all.
 */
export type SmtpVerifyResult =
  | { status: "ok"; host: string; port: number; secure: boolean }
  | { status: "error"; code: SmtpErrorCode; missing?: string[] };

export async function verifySmtp(): Promise<SmtpVerifyResult> {
  const configResult = getSmtpConfig();
  if (configResult.status !== "ok") {
    return { status: "error", code: "not_configured", missing: configResult.missing };
  }
  const { host, port, secure, user, password } = configResult.config;

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass: password },
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
  });

  try {
    await transporter.verify();
    return { status: "ok", host, port, secure };
  } catch (error) {
    const { code } = classify(error);
    console.error("[email smtp] verify failed:", code);
    return { status: "error", code };
  } finally {
    transporter.close();
  }
}
