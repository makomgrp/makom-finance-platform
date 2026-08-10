import type { ApplicationStatus } from "@/types";

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

export const AVERAGE_TIME_BETWEEN_STATES: { from: ApplicationStatus; to: ApplicationStatus; avgDays: number }[] = [
  { from: "new", to: "in_review", avgDays: 1.5 },
  { from: "in_review", to: "approved", avgDays: 6 },
  { from: "in_review", to: "not_eligible", avgDays: 3 },
  { from: "in_review", to: "cancelled", avgDays: 5 },
];
