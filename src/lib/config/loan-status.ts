import type { LoanStatus, LoanType } from "@/types";

export const LOAN_STATUS_BADGE_CLASS: Record<LoanStatus, string> = {
  nueva: "bg-secondary text-secondary-foreground border-border",
  pendiente_documentos: "bg-warning/10 text-warning border-warning/20",
  documentacion_completa: "bg-primary/10 text-primary border-primary/20",
  en_evaluacion: "bg-navy/10 text-navy border-navy/20",
  aprobada: "bg-success/10 text-success border-success/20",
  no_aplica: "bg-muted text-muted-foreground border-border",
  cancelada: "bg-destructive/10 text-destructive border-destructive/20",
};

export const LOAN_STATUS_ORDER: LoanStatus[] = [
  "nueva",
  "pendiente_documentos",
  "documentacion_completa",
  "en_evaluacion",
  "aprobada",
  "no_aplica",
  "cancelada",
];

export const LOAN_TYPE_ORDER: LoanType[] = [
  "descuento_directo",
  "debito_bancario",
  "garantia_vehicular",
  "empresarial",
];
