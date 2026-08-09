import type { ProductStatus } from "@/types";

export const PRODUCT_STATUS_ORDER: ProductStatus[] = ["draft", "active", "inactive"];

export const PRODUCT_STATUS_BADGE_CLASS: Record<ProductStatus, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  active: "bg-success/10 text-success border-success/20",
  inactive: "bg-destructive/10 text-destructive border-destructive/20",
};

// Legal transitions only — each status has exactly one legal next status.
// active -> draft is deliberately not legal: once a product has gone live,
// pulling it back to "being configured" is operationally ambiguous (what
// happens to anything already referencing it mid-edit?) — the only way
// back is active -> inactive -> active (a reactivation). See the Milestone
// 9 architecture review's lifecycle section and the products table
// migration's comment on the `status` column.
export const PRODUCT_STATUS_TRANSITIONS: Record<ProductStatus, ProductStatus[]> = {
  draft: ["active"],
  active: ["inactive"],
  inactive: ["active"],
};
