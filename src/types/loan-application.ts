export type LoanStatus =
  | "nueva"
  | "pendiente_documentos"
  | "documentacion_completa"
  | "en_evaluacion"
  | "aprobada"
  | "no_aplica"
  | "cancelada";

export type LoanType =
  | "descuento_directo"
  | "debito_bancario"
  | "garantia_vehicular"
  | "empresarial";

export interface LoanApplication {
  id: string;
  applicationNumber: string;
  clientId: string;
  loanType: LoanType;
  companyId: string;
  amountRequested: number;
  requestDate: string;
  advisorId: string;
  status: LoanStatus;
  documentationProgress: number;
  lastActivityAt: string;
  nextAction: string;
}
