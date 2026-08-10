import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/shared/page-header";
import { DocumentsTable } from "@/components/documents/documents-table";
import { getDocumentEvidenceWorkspace } from "@/lib/services/document-workspace";
import { getClients } from "@/lib/services/clients";

export default async function DocumentosPage() {
  const t = await getTranslations("documentsModule");
  // Milestone 14D: fetched once here and passed down so DocumentsTable
  // can resolve each row's client display (and Dossier link) from the
  // real Client Engine instead of the demo lookup it used before — a
  // single additional query, not a per-row one.
  const [result, clientsResult] = await Promise.all([getDocumentEvidenceWorkspace(), getClients()]);

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <DocumentsTable
        initialRows={result.status === "ok" ? result.rows : []}
        loadError={result.status === "error"}
        clients={clientsResult.status === "ok" ? clientsResult.clients : []}
      />
    </div>
  );
}
