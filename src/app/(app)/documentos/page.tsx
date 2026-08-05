import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/shared/page-header";
import { DocumentsTable } from "@/components/documents/documents-table";

export default async function DocumentosPage() {
  const t = await getTranslations("documentsModule");

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <DocumentsTable />
    </div>
  );
}
