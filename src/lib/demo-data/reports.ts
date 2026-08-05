import type { LoanStatus } from "@/types";

export const REPORT_SUMMARY = {
  applicationsReceived: 42,
  applicationsReceivedChangePercent: 12,
  documentationCompletionRate: 71,
  approvedApplications: 16,
  approvedRate: 38,
  notApplicableApplications: 5,
  notApplicableRate: 12,
};

export const FREQUENT_REJECTION_REASONS: { key: string; count: number }[] = [
  { key: "incompleteDocumentation", count: 14 },
  { key: "companyNotEligible", count: 9 },
  { key: "previousDefault", count: 7 },
  { key: "insufficientIncome", count: 5 },
  { key: "inconsistentInformation", count: 3 },
];

export const ADVISOR_PRODUCTIVITY = [
  { advisorName: "Fernando Quintero", applications: 16, approved: 6, avgDaysToClose: 18 },
  { advisorName: "Lucía Batista", applications: 14, approved: 5, avgDaysToClose: 21 },
  { advisorName: "Diego Espino", applications: 12, approved: 5, avgDaysToClose: 24 },
];

export const AVERAGE_TIME_BETWEEN_STATES: { from: LoanStatus; to: LoanStatus; avgDays: number }[] = [
  { from: "nueva", to: "pendiente_documentos", avgDays: 1.5 },
  { from: "pendiente_documentos", to: "documentacion_completa", avgDays: 6 },
  { from: "documentacion_completa", to: "en_evaluacion", avgDays: 3 },
  { from: "en_evaluacion", to: "aprobada", avgDays: 5 },
];
