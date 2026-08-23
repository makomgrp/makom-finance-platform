"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Mail, Paperclip, PenSquare, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/shared/empty-state";
import { formatDateTime } from "@/lib/format";
import { useCapability } from "@/lib/auth/use-capability";
import { ComposeDialog, type ComposePrefill } from "@/components/email/compose-dialog";
import type { EmailMessageListItem } from "@/lib/services/email-messages";
import type { Locale } from "@/i18n/config";

interface EmailTabProps {
  clientId: string;
  clientEmail: string;
  messages: EmailMessageListItem[];
  mailbox: string | null;
}

/**
 * ============================================================================
 * MILESTONE 26B-9B — THIS CUSTOMER'S CORRESPONDENCE
 * ============================================================================
 *
 * The communication history 26B-9A deferred, now that there are two directions
 * to show.
 *
 * ----------------------------------------------------------------------------
 * NO NEW AUTHORIZATION RULE WAS INVENTED FOR EMAIL
 * ----------------------------------------------------------------------------
 * 9A deferred this partly because advisor visibility had no clear answer. The
 * answer turned out to be that it already had one: the messages shown here are
 * fetched server-side by `getClientEmails`, which first re-checks that the
 * caller can reach this CLIENT through the ordinary branch predicate. So the
 * boundary is exactly the dossier's own — if you can open the customer, you can
 * read their correspondence; if you cannot, you get nothing.
 *
 * That deliberately grants an advisor LESS than the Email module: this list
 * only ever contains messages linked to this one customer. The global unlinked
 * queue — prospects, suppliers, spam — has no client and cannot appear here,
 * and remains behind `email:manage`.
 *
 * SENDING IS STILL GATED. Reading a customer's mail and writing to them under
 * ODL's name are different acts, so the compose button requires
 * `email:manage`; an advisor sees the history without gaining the mailbox.
 */
export function EmailTab({ clientId, clientEmail, messages, mailbox }: EmailTabProps) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const canSend = useCapability("email:manage");
  const [compose, setCompose] = useState<ComposePrefill | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t("email.clientTab.title")}</h3>
          <p className="text-xs text-muted-foreground">{t("email.clientTab.subtitle")}</p>
        </div>
        {canSend && (
          <Button
            size="sm"
            onClick={() =>
              // Pre-addressed to the customer's CURRENT email, and pre-linked
              // to them — so a message sent from here never needs linking
              // afterwards. The Server Action re-validates both.
              setCompose({ mode: "compose", to: clientEmail, clientId })
            }
          >
            <PenSquare className="size-4" />
            {t("email.clientTab.compose")}
          </Button>
        )}
      </div>

      {messages.length === 0 ? (
        <EmptyState
          icon={Mail}
          title={t("email.clientTab.emptyTitle")}
          description={t("email.clientTab.emptyDescription")}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {messages.map((message) => (
            <Card key={message.id}>
              <CardContent className="flex flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Direction as icon AND word — never colour alone. */}
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    {message.direction === "outbound" ? (
                      <ArrowUpRight className="size-3.5" aria-hidden="true" />
                    ) : (
                      <ArrowDownLeft className="size-3.5" aria-hidden="true" />
                    )}
                    {t(`email.directions.${message.direction}` as "email.directions.inbound")}
                  </span>
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">
                    {message.subject ?? t("email.noSubject")}
                  </span>
                  {message.hasAttachments && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Paperclip className="size-3.5" aria-hidden="true" />
                      {message.attachmentCount}
                    </span>
                  )}
                </div>
                {/* Same rule as the mailbox list: a sent message is about who
                    received it, not about ODL's own address. */}
                <p className="truncate text-xs break-all text-muted-foreground">
                  {message.direction === "outbound"
                    ? message.toAddresses.join(", ") || message.fromAddress
                    : message.fromAddress}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(message.receivedAt, locale)}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <ComposeDialog
        open={compose !== null}
        prefill={compose}
        mailbox={mailbox}
        onClose={() => setCompose(null)}
      />
    </div>
  );
}
