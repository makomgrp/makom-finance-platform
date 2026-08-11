import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/shared/page-header";
import { DocumentsTable } from "@/components/documents/documents-table";
import { getDocumentEvidenceWorkspace } from "@/lib/services/document-workspace";

export default async function DocumentosPage() {
  const t = await getTranslations("documentsModule");
  // Milestone 14E: each row's client display (and Dossier link) is now
  // resolved server-side via document-workspace.ts's own embedded join —
  // no separate getClients() fetch needed here anymore.
  const result = await getDocumentEvidenceWorkspace();

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
