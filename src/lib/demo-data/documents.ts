import type { DocumentRecord, DocumentStatus } from "@/types";
import { DOCUMENT_TYPE_ORDER } from "@/lib/config/document";
import { APPLICATIONS } from "./applications";

// Estado de cada uno de los 6 requisitos, en el orden de DOCUMENT_TYPE_ORDER,
// para cada solicitud (por applicationId).
const DOCUMENT_STATUS_BY_APPLICATION: Record<string, DocumentStatus[]> = {
  "ap-001": ["verificado", "verificado", "en_revision", "verificado", "verificado", "verificado"],
  "ap-002": ["verificado", "verificado", "verificado", "verificado", "verificado", "verificado"],
  "ap-003": ["recibido", "pendiente", "pendiente", "verificado", "pendiente", "pendiente"],
  "ap-004": ["verificado", "verificado", "verificado", "verificado", "verificado", "verificado"],
  "ap-005": ["verificado", "verificado", "verificado", "rechazado", "pendiente", "pendiente"],
  "ap-006": ["verificado", "recibido", "verificado", "recibido", "verificado", "recibido"],
  "ap-007": ["verificado", "verificado", "verificado", "en_revision", "verificado", "verificado"],
  "ap-008": ["verificado", "verificado", "verificado", "verificado", "verificado", "verificado"],
  "ap-009": ["verificado", "verificado", "verificado", "verificado", "verificado", "verificado"],
  "ap-010": ["recibido", "pendiente", "pendiente", "pendiente", "pendiente", "pendiente"],
  "ap-011": ["verificado", "verificado", "recibido", "en_revision", "pendiente", "pendiente"],
  "ap-012": ["recibido", "pendiente", "pendiente", "requiere_actualizacion", "pendiente", "pendiente"],
  "ap-013": ["verificado", "verificado", "verificado", "verificado", "verificado", "verificado"],
  "ap-014": ["verificado", "pendiente", "pendiente", "recibido", "pendiente", "pendiente"],
};

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T09:00:00-05:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

export const DOCUMENTS: DocumentRecord[] = APPLICATIONS.flatMap((application) => {
  const statuses = DOCUMENT_STATUS_BY_APPLICATION[application.id];
  return DOCUMENT_TYPE_ORDER.map((type, index) => {
    const status = statuses[index];
    const wasReceived = status !== "pendiente";
    const record: DocumentRecord = {
      id: `doc-${application.id}-${index + 1}`,
      clientId: application.clientId,
      applicationId: application.id,
      type,
      status,
      receivedAt: wasReceived ? addDays(application.requestDate, index + 1) : undefined,
      reviewedByUserId:
        status === "verificado" || status === "en_revision" || status === "rechazado" || status === "requiere_actualizacion"
          ? application.advisorId
          : undefined,
      fileNameDemo: wasReceived ? `${type}-${application.applicationNumber}.pdf` : undefined,
    };
    return record;
  });
});

export function getDocumentsByApplicationId(applicationId: string): DocumentRecord[] {
  return DOCUMENTS.filter((doc) => doc.applicationId === applicationId);
}

export function getDocumentsByClientId(clientId: string): DocumentRecord[] {
  return DOCUMENTS.filter((doc) => doc.clientId === clientId);
}
