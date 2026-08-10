/**
 * The six legacy document type codes (Milestone 12A/dossier_documents).
 * Milestone 12E4 retired every other legacy dossier_documents type/service —
 * this survives only because src/app/(app)/configuracion/page.tsx's
 * Settings > Document Types catalog tab (DOCUMENT_TYPE_ORDER, see
 * src/lib/config/document.ts) still renders this fixed list read-only.
 */
export type DocumentType =
  | "cedula_pasaporte"
  | "carta_trabajo"
  | "ficha_css"
  | "comprobante_pago"
  | "recibo_servicios"
  | "confirmacion_descuento";
