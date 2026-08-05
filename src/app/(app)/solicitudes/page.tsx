"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { List, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { ApplicationsTable } from "@/components/applications/applications-table";
import { ApplicationsKanban } from "@/components/applications/applications-kanban";
import { APPLICATIONS as INITIAL_APPLICATIONS } from "@/lib/demo-data";
import { cn } from "@/lib/utils";
import type { LoanApplication, LoanStatus } from "@/types";

export default function SolicitudesPage() {
  const t = useTranslations();
  const [applications, setApplications] = useState<LoanApplication[]>(INITIAL_APPLICATIONS);
  const [view, setView] = useState<"tabla" | "kanban">("tabla");

  const handleStatusChange = (applicationId: string, status: LoanStatus) => {
    setApplications((prev) =>
      prev.map((app) =>
        app.id === applicationId
          ? { ...app, status, lastActivityAt: new Date().toISOString() }
          : app
      )
    );
    toast.success(
      t("applications.toasts.statusChanged", { status: t(`statuses.loanApplication.${status}`) })
    );
  };

  return (
    <div>
      <PageHeader
        title={t("applications.title")}
        description={t("applications.description")}
        actions={
          <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
            <Button
              variant={view === "tabla" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setView("tabla")}
              className={cn(view === "tabla" && "shadow-sm")}
            >
              <List className="size-4" />
              {t("applications.viewTable")}
            </Button>
            <Button
              variant={view === "kanban" ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setView("kanban")}
              className={cn(view === "kanban" && "shadow-sm")}
            >
              <LayoutGrid className="size-4" />
              {t("applications.viewKanban")}
            </Button>
          </div>
        }
      />

      {view === "tabla" ? (
        <ApplicationsTable applications={applications} onStatusChange={handleStatusChange} />
      ) : (
        <ApplicationsKanban applications={applications} onStatusChange={handleStatusChange} />
      )}
    </div>
  );
}
