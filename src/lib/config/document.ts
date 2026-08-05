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
