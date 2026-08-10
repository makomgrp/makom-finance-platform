import type { DocumentType } from "@/types";

/**
 * Milestone 12E4: every other export this file had (the legacy
 * DocumentStatus badge/order/transition constants) was retired along with
 * dossier_documents.status and src/lib/services/documents.ts. This one
 * survives because src/app/(app)/configuracion/page.tsx's Settings >
 * Document Types catalog tab still renders it, read-only.
 */
export const DOCUMENT_TYPE_ORDER: DocumentType[] = [
  "cedula_pasaporte",
  "carta_trabajo",
  "ficha_css",
  "comprobante_pago",
  "recibo_servicios",
  "confirmacion_descuento",
];
