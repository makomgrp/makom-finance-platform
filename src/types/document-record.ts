export type DocumentType =
  | "cedula_pasaporte"
  | "carta_trabajo"
  | "ficha_css"
  | "comprobante_pago"
  | "recibo_servicios"
  | "confirmacion_descuento";

export type DocumentStatus =
  | "pendiente"
  | "recibido"
  | "en_revision"
  | "verificado"
  | "rechazado"
  | "requiere_actualizacion";
