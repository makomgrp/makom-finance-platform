"use client";

import { useTranslations } from "next-intl";
import { Building2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { BranchOrigin } from "@/types";

/**
 * ============================================================================
 * WHICH BRANCH OWNS THIS ROW (Milestone 25C-2)
 * ============================================================================
 *
 * One label, used by Clientes, Solicitudes, Documentos and Alertas, so a branch
 * reads identically everywhere it appears. The caller decides WHETHER to render
 * it (see viewSpansMultipleBranches); this decides only how it looks.
 *
 * UNASSIGNED IS RENDERED, NOT HIDDEN. A record with no branch shows
 * "Sin asignar" in muted italics — never a blank cell, never a dash, and never
 * a substituted branch. Right now every fixture and every public-intake record
 * is in exactly this state, and a national administrator needs to see it to
 * route it. A blank would read as missing data; the truth is that nobody owns
 * this yet.
 *
 * THE NAME IS SHOWN, THE UUID NEVER IS. `code` is available for compact
 * surfaces but is deliberately not rendered by default: "Panamá Centro" is what
 * staff call the office, and a code would be jargon in a column they read all
 * day.
 *
 * CARRIES NO AUTHORITY. By the time this renders, the row was already returned
 * by a scope-filtered query — so the branch named here is, by construction, one
 * the viewer is entitled to know about.
 */
interface BranchOriginLabelProps {
  origin: BranchOrigin;
  /** `inline` for table cells; `badge` for card/mobile layouts. */
  variant?: "inline" | "badge";
  className?: string;
}

export function BranchOriginLabel({
  origin,
  variant = "inline",
  className,
}: BranchOriginLabelProps) {
  const t = useTranslations("branchContext");
  const isUnassigned = !origin.name;
  const label = origin.name ?? t("unassigned");

  if (variant === "badge") {
    return (
      <span
        className={cn(
          "inline-flex max-w-full items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs",
          isUnassigned ? "italic text-muted-foreground" : "text-muted-foreground",
          className
        )}
      >
        <Building2 className="size-3 shrink-0" />
        <span className="truncate">{label}</span>
      </span>
    );
  }

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 text-sm",
        isUnassigned ? "italic text-muted-foreground" : "text-muted-foreground",
        className
      )}
    >
      <span className="truncate">{label}</span>
    </span>
  );
}
