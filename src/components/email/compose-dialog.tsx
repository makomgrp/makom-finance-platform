"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { sendEmailAction, type SendEmailMode } from "@/app/(app)/correo/actions";

export interface ComposePrefill {
  mode: SendEmailMode;
  to?: string;
  cc?: string;
  subject?: string;
  body?: string;
  contextEmailId?: string;
  clientId?: string;
  applicationId?: string;
}

interface ComposeDialogProps {
  open: boolean;
  prefill: ComposePrefill | null;
  mailbox: string | null;
  onClose: () => void;
  onSent?: () => void;
}

/**
 * ============================================================================
 * MILESTONE 26B-9B — ONE COMPOSER, FOUR ENTRY POINTS
 * ============================================================================
 *
 * New email, Reply, Reply All and Forward are the SAME form with different
 * pre-filled fields. They post to the same Server Action, which re-derives
 * every decision that matters — so the differences here are convenience, never
 * authority.
 *
 * ----------------------------------------------------------------------------
 * FROM IS DISPLAYED, NOT EDITED
 * ----------------------------------------------------------------------------
 * Rendered as read-only text rather than a disabled input, because a disabled
 * input still looks like a control somebody might expect to change. The server
 * reads the sender from its own environment and ignores anything sent for it.
 *
 * ----------------------------------------------------------------------------
 * THE DOUBLE-SEND GUARD IS NOT THE BUTTON
 * ----------------------------------------------------------------------------
 * Disabling the button while a request is in flight handles the impatient
 * double-click and nothing else — it does not survive a dropped response, a
 * retried submission, or a second tab. A `sendKey` is minted once per opened
 * composer and travels with the request; the database's unique index is what
 * actually stops a second delivery. The key is regenerated only when a NEW
 * compose opens, so a retry after a failure reuses it deliberately.
 *
 * ----------------------------------------------------------------------------
 * PLAIN TEXT
 * ----------------------------------------------------------------------------
 * No rich-text editor. Plain text cannot carry active content into a
 * customer's inbox under ODL's name, needs no sanitising on the way out, and
 * renders identically in every mail client.
 */
export function ComposeDialog({ open, prefill, mailbox, onClose, onSent }: ComposeDialogProps) {
  // REMOUNT RATHER THAN RE-SEED. The form's fields are ordinary useState
  // initialised from props; syncing them in an effect would mean a render pass
  // with the previous message's text still on screen, and React rightly warns
  // about it. A key derived from the compose context makes each open a fresh
  // component instead — which is also what mints a new idempotency token.
  if (!open || !prefill) return null;
  return (
    <ComposeForm
      key={`${prefill.mode}:${prefill.contextEmailId ?? ""}:${prefill.clientId ?? ""}:${prefill.to ?? ""}`}
      prefill={prefill}
      mailbox={mailbox}
      onClose={onClose}
      onSent={onSent}
    />
  );
}

function ComposeForm({
  prefill,
  mailbox,
  onClose,
  onSent,
}: {
  prefill: ComposePrefill;
  mailbox: string | null;
  onClose: () => void;
  onSent?: () => void;
}) {
  const t = useTranslations();
  const [to, setTo] = useState(prefill.to ?? "");
  const [cc, setCc] = useState(prefill.cc ?? "");
  const [subject, setSubject] = useState(prefill.subject ?? "");
  const [body, setBody] = useState(prefill.body ?? "");
  // Minted ONCE per mounted composer. Every submission of this form — the
  // first click and any retry after a failure — carries the same token, so the
  // database's unique index is what decides whether a second delivery happens.
  const [sendKey] = useState(() => crypto.randomUUID());
  const [isSending, startSending] = useTransition();

  const submit = () => {
    startSending(async () => {
      const result = await sendEmailAction({
        mode: prefill.mode,
        to,
        cc,
        subject,
        body,
        contextEmailId: prefill.contextEmailId,
        clientId: prefill.clientId,
        applicationId: prefill.applicationId,
        sendKey,
      });

      if (result.status === "success" || result.status === "duplicate") {
        toast.success(t("email.compose.sent"));
        onSent?.();
        onClose();
        return;
      }
      if (result.status === "sent_not_recorded") {
        // Delivered, but the CRM copy is missing. Said plainly so nobody sends
        // it again to "fix" it.
        toast.warning(t("email.compose.sentNotRecorded"), { duration: 10_000 });
        onSent?.();
        onClose();
        return;
      }
      if (result.status === "invalid") {
        toast.error(
          t("email.compose.invalidRecipients", { list: result.invalidRecipients.join(", ") })
        );
        return;
      }
      // Draft text is deliberately left in place so a failed send is a retry,
      // not a retype.
      toast.error(t(`email.sendErrors.${result.code}` as "email.sendErrors.send_failed"));
    });
  };

  const title =
    prefill.mode === "reply"
      ? t("email.compose.titleReply")
      : prefill.mode === "reply_all"
        ? t("email.compose.titleReplyAll")
        : prefill.mode === "forward"
          ? t("email.compose.titleForward")
          : t("email.compose.titleNew");

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Informational only — the server decides the sender. */}
          <p className="text-xs break-all text-muted-foreground">
            {t("email.from")}: {mailbox ?? "—"}
          </p>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="compose-to">{t("email.to")}</Label>
            <Input
              id="compose-to"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              placeholder="cliente@ejemplo.com"
              inputMode="email"
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="compose-cc">{t("email.cc")}</Label>
            <Input
              id="compose-cc"
              value={cc}
              onChange={(event) => setCc(event.target.value)}
              inputMode="email"
              autoComplete="off"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="compose-subject">{t("email.subject")}</Label>
            <Input
              id="compose-subject"
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="compose-body">{t("email.message")}</Label>
            <Textarea
              id="compose-body"
              rows={10}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              className="font-mono text-sm"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={isSending}>
            {t("common.cancel")}
          </Button>
          <Button onClick={submit} disabled={isSending || !to.trim() || !subject.trim() || !body.trim()}>
            <Send className="size-4" />
            {isSending ? t("email.compose.sending") : t("email.compose.send")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Builds the pre-filled fields for a reply, reply-all or forward.
 *
 * PURE, AND PURELY COSMETIC. Every value it produces is a suggestion the user
 * can edit and the server re-validates — the customer linkage of a reply, in
 * particular, is taken from the stored original and never from this.
 *
 * REPLY ALL EXCLUDES ODL'S OWN MAILBOX. Otherwise every reply-all would send
 * the mailbox a copy of its own message, which clutters the inbox and, once
 * synced, would appear as inbound mail from ODL to ODL.
 */
export function buildReplyPrefill(
  mode: "reply" | "reply_all" | "forward",
  message: {
    id: string;
    fromAddress: string;
    toAddresses: string[];
    ccAddresses: string[];
    subject?: string;
    bodyText?: string;
    receivedAt: string;
    linkedClientId?: string;
  },
  mailbox: string | null,
  quotedLabel: string
): ComposePrefill {
  const mine = mailbox?.toLowerCase();
  const dedupe = (addresses: string[]) => {
    const seen = new Set<string>();
    return addresses
      .map((address) => address.trim().toLowerCase())
      .filter((address) => address && address !== mine && !seen.has(address) && seen.add(address));
  };

  // A quoted original, not a nested chain. One level is enough context to
  // answer; more turns every thread into a wall of repeated text.
  const quoted = message.bodyText
    ? `\n\n---\n${quotedLabel}\n${message.bodyText.slice(0, 2000)}`
    : "";

  if (mode === "forward") {
    return {
      mode,
      to: "",
      subject: `Fwd: ${message.subject ?? ""}`.trim(),
      body: quoted,
      contextEmailId: message.id,
    };
  }

  const subject = message.subject?.toLowerCase().startsWith("re:")
    ? message.subject
    : `Re: ${message.subject ?? ""}`.trim();

  return {
    mode,
    to: message.fromAddress,
    cc:
      mode === "reply_all"
        ? dedupe([...message.toAddresses, ...message.ccAddresses])
            .filter((address) => address !== message.fromAddress.toLowerCase())
            .join(", ")
        : "",
    subject,
    body: quoted,
    contextEmailId: message.id,
    clientId: message.linkedClientId,
  };
}
