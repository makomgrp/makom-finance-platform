"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { DOCUMENT_STATUS_ORDER } from "@/lib/config/document";
import { DOCUMENTS } from "@/lib/demo-data";
import type { DocumentStatus } from "@/types";

interface DocumentStatusSummaryProps {
  activeStatus: DocumentStatus | "todos";
  onSelect: (status: DocumentStatus | "todos") => void;
}

export function DocumentStatusSummary({ activeStatus, onSelect }: DocumentStatusSummaryProps) {
  const t = useTranslations();

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {DOCUMENT_STATUS_ORDER.map((status) => {
        const count = DOCUMENTS.filter((doc) => doc.status === status).length;
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
                  {t(`statuses.document.${status}`)}
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
