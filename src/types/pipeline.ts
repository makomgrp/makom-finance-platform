import type { ApplicationStatus } from "@/types/application";
import type { BranchOrigin } from "@/types/branch";
import type { LocalizedText } from "@/types/product";

/**
 * ============================================================================
 * THE OPERATIONAL PIPELINE (26B-5A)
 * ============================================================================
 *
 * One board spanning two lifecycles. The first three stages describe a customer
 * still working through the portal; the rest describe an application ODL has
 * formally received. The distinction is preserved everywhere it matters — only
 * the PRESENTATION is unified.
 */
export type PipelineStage =
  /** Step 1 done. ODL has a prospect worth calling, and nothing more. */
  | "nuevo"
  /** Step 2 genuinely complete for this product. */
  | "paso_2"
  /** Every required document received. */
  | "paso_3"
  /** Formally submitted; with ODL. */
  | "en_evaluacion"
  | "aprobado"
  | "cancelado"
  | "descartado";

/**
 * One journey on the board.
 *
 * `id` is the APPLICATION id for leads and submitted applications alike —
 * 26B-5 promotes the same row on submission rather than creating a new one, so
 * a card keeps its identity all the way across the board.
 *
 * Deliberately flat and explicit: every field the board may render is named
 * here, so nothing internal arrives by being added to a domain model elsewhere.
 * No identification numbers, no bank details, no storage paths.
 */
export interface PipelineCard {
  id: string;
  /** Has ODL formally received this yet? */
  kind: "lead" | "application";
  clientId: string;
  /** Present only once formally submitted. */
  applicationNumber?: string;
  fullName: string;
  /** Follow-up contact — the reason leads are captured this early. */
  email?: string;
  phone?: string;
  productCode: string;
  productName: LocalizedText;
  stage: PipelineStage;
  /** Undefined for leads: a draft has no operational status to report. */
  formalStatus?: ApplicationStatus;
  /** The raw lifecycle status, including `draft`. */
  status: ApplicationStatus;
  advisorFullName?: string;
  branchOrigin: BranchOrigin;
  createdAt: string;
  lastActivityAt: string;
  documentsReceived: number;
  documentsReviewed: number;
  documentsRequired: number;
}
