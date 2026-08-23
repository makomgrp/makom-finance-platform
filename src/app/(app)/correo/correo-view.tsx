"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import {
  Mail, Paperclip, RefreshCw, Search, Link2, Link2Off,
  PenSquare, Reply, ReplyAll, Forward, ArrowDownLeft, ArrowUpRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDateTime } from "@/lib/format";
import { useSearchParamState } from "@/lib/hooks/use-search-param-state";
import { syncEmailAction, setEmailLinkAction } from "./actions";
import { ComposeDialog, buildReplyPrefill, type ComposePrefill } from "@/components/email/compose-dialog";
import type {
  EmailDirectionFilter,
  EmailFilter,
  EmailMatchStatus,
  EmailMessageListItem,
  EmailSyncState,
} from "@/lib/services/email-messages";
import type { Locale } from "@/i18n/config";

interface ClientOption {
  id: string;
  fullName: string;
  email: string;
}

interface CorreoViewProps {
  mailbox: string | null;
  initialMessages: EmailMessageListItem[];
  loadError: boolean;
  filter: EmailFilter;
  direction: EmailDirectionFilter;
  search: string;
  syncState: EmailSyncState | null;
  clients: ClientOption[];
}

const FILTERS = ["all", "unlinked", "linked"] as const satisfies readonly EmailFilter[];
/** Recibidos / Enviados. Same URL-state treatment as the link filter. */
const DIRECTIONS = ["all", "inbound", "outbound"] as const satisfies readonly EmailDirectionFilter[];

/**
 * ============================================================================
 * MILESTONE 26B-9A — INBOX
 * ============================================================================
 *
 * A list of what sync has already stored, a filter, a search box and one
 * button that talks to the mail server.
 *
 * NO COMPOSE, NO REPLY, NO FORWARD. 26B-9A is inbound only; there is no
 * transport installed and nothing here can send.
 *
 * THE FILTER LIVES IN THE URL, reusing 26B-8's hook, so the unlinked queue is
 * a link somebody can be sent rather than a state only reachable by clicking.
 */
export function CorreoView({
  mailbox,
  initialMessages,
  loadError,
  filter,
  direction,
  search,
  syncState,
  clients,
}: CorreoViewProps) {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const { write } = useSearchParamState();
  const [isSyncing, startSync] = useTransition();
  const [searchDraft, setSearchDraft] = useState(search);
  const [openMessageId, setOpenMessageId] = useState<string | null>(null);
  const [linkTarget, setLinkTarget] = useState<EmailMessageListItem | null>(null);
  const [compose, setCompose] = useState<ComposePrefill | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string>("");
  const [isLinking, startLink] = useTransition();

  const runSync = () => {
    startSync(async () => {
      const result = await syncEmailAction();
      if (result.status === "error") {
        // Failure codes only — never a raw server string, a host or a
        // credential. Each maps to its own translated sentence.
        toast.error(t(`email.syncErrors.${result.code}` as "email.syncErrors.unknown"));
        return;
      }
      if (result.imported === 0) {
        toast.success(t("email.sync.noNew"));
      } else {
        toast.success(t("email.sync.imported", { count: result.imported }));
      }
      if (result.failed > 0) toast.warning(t("email.sync.failed", { count: result.failed }));
    });
  };

  const submitLink = (clientId: string | null) => {
    if (!linkTarget) return;
    startLink(async () => {
      const result = await setEmailLinkAction({ messageId: linkTarget.id, clientId });
      if (result.status !== "success") {
        toast.error(t("email.link.error"));
        return;
      }
      toast.success(clientId ? t("email.link.linked") : t("email.link.removed"));
      setLinkTarget(null);
      setSelectedClientId("");
    });
  };

  /**
   * Opens the composer for a reply/forward.
   *
   * The list item carries no body or recipient list, so the full record is
   * fetched first — the quoted text and Reply All's CC come from what was
   * actually stored, never from what happened to be rendered.
   */
  const openReply = async (mode: "reply" | "reply_all" | "forward", message: EmailMessageListItem) => {
    const response = await fetch(`/api/correo/${message.id}`);
    if (!response.ok) {
      toast.error(t("email.loadErrorDescription"));
      return;
    }
    const detail = await response.json();
    setCompose(
      buildReplyPrefill(
        mode,
        {
          id: message.id,
          fromAddress: detail.fromAddress,
          toAddresses: detail.toAddresses ?? [],
          ccAddresses: detail.ccAddresses ?? [],
          subject: detail.subject,
          bodyText: detail.bodyText,
          receivedAt: detail.receivedAt,
          linkedClientId: detail.linkedClientId,
        },
        mailbox,
        t("email.compose.quotedHeader", {
          sender: detail.fromAddress,
          date: formatDateTime(detail.receivedAt, locale),
        })
      )
    );
  };

  const statusTone: Record<EmailMatchStatus, string> = {
    auto_linked: "bg-success/10 text-success border-success/20",
    manual_linked: "bg-success/10 text-success border-success/20",
    ambiguous: "bg-warning/10 text-warning border-warning/20",
    unlinked: "bg-muted text-muted-foreground border-border",
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ---- Toolbar ---------------------------------------------------- */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((value) => (
            <Button
              key={value}
              variant={filter === value ? "secondary" : "ghost"}
              size="sm"
              onClick={() => write({ filtro: { value, defaultValue: "all" } })}
            >
              {t(`email.filters.${value}` as "email.filters.all")}
            </Button>
          ))}
          <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden="true" />
          {DIRECTIONS.map((value) => (
            <Button
              key={value}
              variant={direction === value ? "secondary" : "ghost"}
              size="sm"
              onClick={() => write({ dir: { value, defaultValue: "all" } })}
            >
              {t(`email.directions.${value}` as "email.directions.all")}
            </Button>
          ))}
        </div>

        {/* WRAPS RATHER THAN OVERFLOWS. 26B-9B added a third control here and
            the row stopped fitting at 768px — `flex-wrap` lets Sync drop to a
            second line instead of pushing the page sideways, and the search
            box only takes a fixed width once there is room for one. */}
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative min-w-0 flex-1 sm:flex-initial">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") write({ q: { value: searchDraft.trim(), defaultValue: "" } });
              }}
              placeholder={t("email.searchPlaceholder")}
              className="w-full pl-9 lg:w-64"
              aria-label={t("email.searchPlaceholder")}
            />
          </div>
          <Button variant="outline" onClick={() => setCompose({ mode: "compose" })}>
            <PenSquare className="size-4" />
            {t("email.compose.new")}
          </Button>
          <Button onClick={runSync} disabled={isSyncing}>
            <RefreshCw className={isSyncing ? "size-4 animate-spin" : "size-4"} />
            {isSyncing ? t("email.sync.running") : t("email.sync.action")}
          </Button>
        </div>
      </div>

      {/* ---- Mailbox + last sync ---------------------------------------- */}
      <p className="text-xs text-muted-foreground">
        {mailbox ? `${t("email.mailbox")}: ${mailbox}` : t("email.notConfigured")}
        {syncState?.lastSuccessAt && (
          <> · {t("email.lastSync")}: {formatDateTime(syncState.lastSuccessAt, locale)}</>
        )}
      </p>

      {/* ---- List -------------------------------------------------------- */}
      {loadError ? (
        <EmptyState icon={Mail} title={t("email.loadErrorTitle")} description={t("email.loadErrorDescription")} />
      ) : initialMessages.length === 0 ? (
        <EmptyState icon={Mail} title={t("email.emptyTitle")} description={t("email.emptyDescription")} />
      ) : (
        <div className="flex flex-col gap-2">
          {initialMessages.map((message) => (
            <Card key={message.id}>
              <CardContent className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <button
                  type="button"
                  onClick={() => setOpenMessageId(message.id)}
                  className="min-w-0 flex-1 rounded-sm text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {/* Which way it travelled, as an icon WITH a label — a
                        direction conveyed by colour or arrow alone would be
                        invisible to a screen reader. */}
                    {message.direction === "outbound" ? (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <ArrowUpRight className="size-3.5" aria-hidden="true" />
                        {t("email.directions.outbound")}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <ArrowDownLeft className="size-3.5" aria-hidden="true" />
                        {t("email.directions.inbound")}
                      </span>
                    )}
                    {/* SENT MAIL LEADS WITH THE RECIPIENT. Every outbound row
                        has the same sender — ODL's own mailbox — so showing it
                        first would make the Sent list a column of identical
                        addresses. An address can be long, so it truncates
                        rather than pushing the card sideways at 390px. */}
                    <span className="min-w-0 truncate text-sm font-medium text-foreground">
                      {message.direction === "outbound"
                        ? message.toAddresses.join(", ") || message.fromAddress
                        : (message.fromName ?? message.fromAddress)}
                    </span>
                    {message.hasAttachments && (
                      <span
                        className="flex items-center gap-1 text-xs text-muted-foreground"
                        title={t("email.attachments")}
                      >
                        <Paperclip className="size-3.5" aria-hidden="true" />
                        {message.attachmentCount}
                      </span>
                    )}
                  </div>
                  <p className="truncate text-sm text-foreground">
                    {message.subject ?? t("email.noSubject")}
                  </p>
                  <p className="truncate text-xs break-all text-muted-foreground">
                    {message.direction === "outbound"
                      ? `${t("email.from")}: ${message.fromAddress}`
                      : message.fromAddress}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDateTime(message.receivedAt, locale)}
                  </p>
                </button>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <StatusBadge
                    label={
                      message.linkedClientName ??
                      t(`email.status.${message.matchStatus}` as "email.status.unlinked")
                    }
                    className={statusTone[message.matchStatus]}
                  />
                  {/* MILESTONE 26B-9B — the three reply modes. They only
                      pre-fill; the Server Action re-derives recipients,
                      linkage and threading from the stored original. */}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void openReply("reply", message)}
                    title={t("email.compose.reply")}
                    aria-label={t("email.compose.reply")}
                  >
                    <Reply className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void openReply("reply_all", message)}
                    title={t("email.compose.replyAll")}
                    aria-label={t("email.compose.replyAll")}
                  >
                    <ReplyAll className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void openReply("forward", message)}
                    title={t("email.compose.forward")}
                    aria-label={t("email.compose.forward")}
                  >
                    <Forward className="size-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setLinkTarget(message);
                      setSelectedClientId(message.linkedClientId ?? "");
                    }}
                  >
                    {message.linkedClientId ? (
                      <>
                        <Link2 className="size-3.5" />
                        {t("email.link.change")}
                      </>
                    ) : (
                      <>
                        <Link2 className="size-3.5" />
                        {t("email.link.action")}
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ---- Compose / Reply / Forward ----------------------------------- */}
      <ComposeDialog
        open={compose !== null}
        prefill={compose}
        mailbox={mailbox}
        onClose={() => setCompose(null)}
      />

      {/* ---- Detail ------------------------------------------------------ */}
      <MessageDialog
        messageId={openMessageId}
        onClose={() => setOpenMessageId(null)}
        locale={locale}
      />

      {/* ---- Link picker -------------------------------------------------- */}
      <Dialog
        open={linkTarget !== null}
        onOpenChange={(next) => {
          if (!next) {
            setLinkTarget(null);
            setSelectedClientId("");
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("email.link.dialogTitle")}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            {linkTarget && (
              <p className="text-sm break-words text-muted-foreground">
                {linkTarget.fromAddress} · {linkTarget.subject ?? t("email.noSubject")}
              </p>
            )}
            {/* Only clients this user can already reach. The Server Action
                re-validates the chosen id against the same branch scope, so
                the list is convenience and not the control. */}
            <Select value={selectedClientId} onValueChange={(value) => value && setSelectedClientId(value)}>
              <SelectTrigger aria-label={t("email.link.selectClient")}>
                <SelectValue placeholder={t("email.link.selectClient")}>
                  {(value: string) => clients.find((c) => c.id === value)?.fullName ?? value}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {clients.map((client) => (
                  <SelectItem key={client.id} value={client.id}>
                    {client.fullName} · {client.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            {linkTarget?.linkedClientId && (
              <Button variant="outline" disabled={isLinking} onClick={() => submitLink(null)}>
                <Link2Off className="size-4" />
                {t("email.link.remove")}
              </Button>
            )}
            <Button
              disabled={!selectedClientId || isLinking}
              onClick={() => submitLink(selectedClientId)}
            >
              {t("email.link.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * The message body.
 *
 * FETCHED THROUGH A ROUTE HANDLER, not held in the list props: bodies are
 * large, and shipping every body to the browser to render one would put the
 * entire mailbox in the page payload.
 *
 * THE HTML ARRIVES ALREADY SANITISED by the server (see
 * email-messages.ts#sanitizeEmailHtml). Plain text is preferred and is what
 * renders whenever the message has it.
 */
function MessageDialog({
  messageId,
  onClose,
  locale,
}: {
  messageId: string | null;
  onClose: () => void;
  locale: Locale;
}) {
  const t = useTranslations();
  const [detail, setDetail] = useState<null | {
    fromAddress: string;
    subject?: string;
    receivedAt: string;
    toAddresses: string[];
    bodyText?: string;
    bodySafeHtml?: string;
    attachments: { id: string; filename?: string; mimeType?: string; sizeBytes?: number }[];
  }>(null);
  const [loading, setLoading] = useState(false);

  const open = messageId !== null;

  if (open && !loading && !detail) {
    setLoading(true);
    void fetch(`/api/correo/${messageId}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setDetail(data))
      .finally(() => setLoading(false));
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setDetail(null);
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="break-words">
            {detail?.subject ?? t("email.noSubject")}
          </DialogTitle>
        </DialogHeader>
        {loading && !detail ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : detail ? (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-0.5 text-xs text-muted-foreground">
              <span className="break-all">
                {t("email.sender")}: {detail.fromAddress}
              </span>
              {detail.toAddresses.length > 0 && (
                <span className="break-all">
                  {t("email.recipient")}: {detail.toAddresses.join(", ")}
                </span>
              )}
              <span>
                {t("email.received")}: {formatDateTime(detail.receivedAt, locale)}
              </span>
            </div>

            {detail.attachments.length > 0 && (
              <div className="rounded-md border border-border bg-muted/40 px-3 py-2">
                <p className="text-xs font-medium text-foreground">{t("email.attachments")}</p>
                <ul className="mt-1 flex flex-col gap-0.5">
                  {detail.attachments.map((attachment) => (
                    <li key={attachment.id} className="text-xs break-all text-muted-foreground">
                      {attachment.filename ?? "—"}
                      {attachment.mimeType ? ` · ${attachment.mimeType}` : ""}
                      {typeof attachment.sizeBytes === "number"
                        ? ` · ${Math.max(1, Math.round(attachment.sizeBytes / 1024))} KB`
                        : ""}
                    </li>
                  ))}
                </ul>
                {/* Says plainly that the bytes are not here. */}
                <p className="mt-1 text-xs text-muted-foreground">{t("email.attachmentsMetadataOnly")}</p>
              </div>
            )}

            {detail.bodyText ? (
              // Plain text first, rendered as TEXT — `whitespace-pre-wrap`
              // keeps the sender's line breaks without interpreting anything.
              <p className="text-sm whitespace-pre-wrap break-words text-foreground">
                {detail.bodyText}
              </p>
            ) : detail.bodySafeHtml ? (
              <div
                className="prose-sm max-w-none text-sm break-words text-foreground [&_a]:underline"
                // Sanitised server-side against an allow-list: no script, no
                // iframe, no event handlers, and images stripped entirely so
                // tracking pixels cannot fire. See sanitizeEmailHtml.
                dangerouslySetInnerHTML={{ __html: detail.bodySafeHtml }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">{t("email.noBody")}</p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t("email.loadErrorDescription")}</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
