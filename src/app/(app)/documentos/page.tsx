import { getTranslations } from "next-intl/server";
import { EMPTY_BRANCH_SCOPE } from "@/lib/services/branch-scope-query";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { PageHeader } from "@/components/shared/page-header";
import { DocumentsTable } from "@/components/documents/documents-table";
import { getDocumentEvidenceWorkspace } from "@/lib/services/document-workspace";

export default async function DocumentosPage() {
  const t = await getTranslations("documentsModule");
  // Milestone 14E: each row's client display (and Dossier link) is now
  // resolved server-side via document-workspace.ts's own embedded join —
  // no separate getClients() fetch needed here anymore.
  // MILESTONE 25B-1 — scope resolved server-side, passed explicitly.
  const profile = await getCurrentProfile();
  const scope = profile?.branchScope ?? EMPTY_BRANCH_SCOPE;
  const result = await getDocumentEvidenceWorkspace(scope);

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <DocumentsTable
        initialRows={result.status === "ok" ? result.rows : []}
        loadError={result.status === "error"}
      />
    </div>
  );
}
