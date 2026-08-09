import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/shared/page-header";
import { DocumentsTable } from "@/components/documents/documents-table";
import { getAllDocuments } from "@/lib/services/documents";

export default async function DocumentosPage() {
  const t = await getTranslations("documentsModule");
  const result = await getAllDocuments();

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <DocumentsTable
        initialDocuments={result.status === "ok" ? result.documents : []}
        loadError={result.status === "error"}
      />
    </div>
  );
}
