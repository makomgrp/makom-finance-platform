import type { DocumentStatus, DocumentType } from "@/types";

export const DOCUMENT_TYPE_ORDER: DocumentType[] = [
  "cedula_pasaporte",
  "carta_trabajo",
  "ficha_css",
  "comprobante_pago",
  "recibo_servicios",
  "confirmacion_descuento",
];

export const DOCUMENT_STATUS_BADGE_CLASS: Record<DocumentStatus, string> = {
  pendiente: "bg-muted text-muted-foreground border-border",
  recibido: "bg-primary/10 text-primary border-primary/20",
  en_revision: "bg-warning/10 text-warning border-warning/20",
  verificado: "bg-success/10 text-success border-success/20",
  rechazado: "bg-destructive/10 text-destructive border-destructive/20",
  requiere_actualizacion: "bg-warning/10 text-warning border-warning/20",
};

export const DOCUMENT_STATUS_ORDER: DocumentStatus[] = [
  "pendiente",
  "recibido",
  "en_revision",
  "verificado",
  "rechazado",
  "requiere_actualizacion",
];

// Excludes pendiente — it's the automatic starting state for a
// requirement slot with no file, never a target a status-change action
// can move a document back to (that would require removing the file,
// which is not a supported operation in V1 — see
// dossier_documents_status_file_check). Used by both the dossier
// Documents tab's "Cambiar estado" dropdown and
// src/lib/services/documents.ts's setDossierDocumentStatus validation.
export const DOCUMENT_STATUS_TRANSITIONABLE: DocumentStatus[] = [
  "recibido",
  "en_revision",
  "verificado",
  "rechazado",
  "requiere_actualizacion",
];
