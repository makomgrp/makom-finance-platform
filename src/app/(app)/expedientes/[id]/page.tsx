import { notFound } from "next/navigation";
import { getClientById } from "@/lib/demo-data";
import { getNotesByClientId } from "@/lib/services/notes";
import { DossierView } from "@/components/dossier/dossier-view";

export default async function ExpedientePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; solicitud?: string }>;
}) {
  const { id } = await params;
  const { tab, solicitud } = await searchParams;

  const client = getClientById(id);
  if (!client) notFound();

  const notesResult = await getNotesByClientId(client.id);

  return (
    <DossierView
      clientId={client.id}
      initialTab={tab}
      initialApplicationId={solicitud}
      initialNotes={notesResult.status === "ok" ? notesResult.notes : []}
      notesLoadError={notesResult.status === "error"}
    />
  );
}
