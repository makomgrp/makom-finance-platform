import type { Locale } from "@/i18n/config";

export type ProductStatus = "draft" | "active" | "inactive";

/** Locale-keyed text — must always carry every locale in src/i18n/config.ts's
 * LOCALES. Deliberately narrower than SupportedLanguage (src/types/user.ts),
 * which also includes "fr" for chat message translation only — an unrelated
 * concept. See the products table migration's comment on `name`. */
export type LocalizedText = Record<Locale, string>;

/**
 * The Product Engine's identity + lifecycle shape (Milestone 9A). A Product
 * is a configurable financial product template (Personal Loan, Mortgage,
 * ...), not a loan application. Deliberately minimal — see the Milestone 9
 * architecture review for what belongs here vs. in future Requirement
 * Template / Workflow Template / Communication Template / AI Rule tables
 * that will reference a product by id, none of which this type knows about.
 */
export interface Product {
  id: string;
  /** Stable, human-assigned, machine-referenceable key — practically
   * immutable by convention, not enforced. See the migration comment. */
  code: string;
  /**
   * MILESTONE 26A-1 — the official one-letter code that ends every ODL
   * application number (N / D / V / E).
   *
   * DISTINCT FROM `code`, which is an internal slug ("payroll_deduction").
   * This is the identifier customers and the ODL website see, so it is what
   * public URLs and the portal's product choice are keyed on. Optional because
   * a product ODL adds later may not carry one.
   */
  applicationCode?: string;
  name: LocalizedText;
  shortDescription?: LocalizedText;
  status: ProductStatus;
  /** Presentation-only ordering among products, no business meaning. */
  displayOrder: number;
  statusChangedAt?: string;
  statusChangedByProfileId?: string;
  /** Resolved server-side (joined from profiles) — never guessed
   * client-side. */
  statusChangedByFullName?: string;
  createdAt: string;
}
