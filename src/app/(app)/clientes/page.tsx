import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/shared/page-header";
import { ClientsTable } from "@/components/clients/clients-table";

export default async function ClientsPage() {
  const t = await getTranslations("clients");

  return (
    <div>
      <PageHeader title={t("title")} description={t("description")} />
      <ClientsTable />
    </div>
  );
}
