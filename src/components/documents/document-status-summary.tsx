"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { REQUIREMENT_SLOT_STATUS_ORDER } from "@/lib/config/requirement-slot";
import type { DocumentWorkspaceRow, RequirementSlotStatus } from "@/types";

interface DocumentStatusSummaryProps {
  rows: DocumentWorkspaceRow[];
  activeStatus: RequirementSlotStatus | "todos";
  onSelect: (status: RequirementSlotStatus | "todos") => void;
}

/**
 * Milestone 12D: counts Requirement Slots (rows), never Evidence rows —
 * see the Milestone 12D architecture review's "KPI double-counting" risk.
 * A Slot with three Evidence uploads is still one unit of work and
 * contributes exactly once to exactly one status bucket.
 */
export function DocumentStatusSummary({ rows, activeStatus, onSelect }: DocumentStatusSummaryProps) {
  const t = useTranslations();

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
      {REQUIREMENT_SLOT_STATUS_ORDER.map((status) => {
        const count = rows.filter((row) => row.requirementSlot.status === status).length;
        const isActive = activeStatus === status;

        return (
          <button key={status} onClick={() => onSelect(isActive ? "todos" : status)}>
            <Card
              className={cn(
                "transition-colors hover:border-primary/40",
                isActive && "border-primary ring-1 ring-primary/30"
              )}
            >
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  {t(`statuses.requirementSlotStatus.${status}`)}
                </p>
                <p className="mt-1 text-xl font-semibold text-foreground">{count}</p>
              </CardContent>
            </Card>
          </button>
        );
      })}
    </div>
  );
}
