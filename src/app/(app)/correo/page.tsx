import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { EMPTY_BRANCH_SCOPE } from "@/lib/services/branch-scope-query";
import { getMailboxAddress } from "@/lib/config/mail";
import {
  getEmailMessages,
  getEmailSyncState,
  type EmailDirectionFilter,
  type EmailFilter,
} from "@/lib/services/email-messages";
import { getClients } from "@/lib/services/clients";
import { PageHeader } from "@/components/shared/page-header";
import { CorreoView } from "./correo-view";

/**
 * ============================================================================
 * MILESTONE 26B-9A — THE EMAIL PAGE
 * ============================================================================
 *
 * Renders entirely from the CRM database. Opening this page opens NO IMAP
 * connection: mail is fetched only when somebody presses Sync, and a message
 * body is read from the row that sync wrote, never re-fetched to display it.
 *
 * AUTHORIZATION IS THE FIRST THING THAT HAPPENS. A viewer without
 * `email:manage` is redirected rather than shown an empty mailbox — an empty
 * inbox and a forbidden one should not look alike. The sidebar hides the link
 * for the same roles, but that is the courtesy; this is the enforcement.
 */
export default async function CorreoPage({
  searchParams,
}: {
  searchParams: Promise<{ filtro?: string; q?: string; dir?: string }>;
}) {
  const profile = await getCurrentProfile();
  if (!profile?.capabilities.includes("email:manage")) redirect("/dashboard");

  const t = await getTranslations("email");
  const { filtro, q, dir } = await searchParams;
  const filter: EmailFilter =
    filtro === "linked" || filtro === "unlinked" ? filtro : "all";
  // MILESTONE 26B-9B — Recibidos / Enviados. Anything else falls back to both.
  const direction: EmailDirectionFilter =
    dir === "inbound" || dir === "outbound" ? dir : "all";

  const mailbox = getMailboxAddress();

  const [messagesResult, syncState, clientsResult] = await Promise.all([
    getEmailMessages(profile.branchScope, {
      filter,
      direction,
      search: q,
      // Holding email:manage IS the authorization for the unlinked queue —
      // those messages have no client and therefore no branch to scope by.
      includeUnlinked: true,
    }),
    mailbox ? getEmailSyncState(mailbox) : Promise.resolve(null),
    // The link picker offers only clients this user can already reach; the
    // Server Action re-validates the chosen id against the same scope.
    getClients(profile.branchScope ?? EMPTY_BRANCH_SCOPE),
  ]);

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <CorreoView
        mailbox={mailbox}
        initialMessages={messagesResult.status === "ok" ? messagesResult.messages : []}
        loadError={messagesResult.status === "error"}
        filter={filter}
        direction={direction}
        search={q ?? ""}
        syncState={syncState}
        clients={
          clientsResult.status === "ok"
            ? clientsResult.clients.map((client) => ({
                id: client.id,
                fullName: client.fullName,
                email: client.email,
              }))
            : []
        }
      />
    </div>
  );
}
