"use client";

import { useTranslations } from "next-intl";
import { RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LOAN_STATUS_ORDER } from "@/lib/config/loan-status";
import type { LoanStatus } from "@/types";

interface ApplicationStatusMenuProps {
  currentStatus: LoanStatus;
  onChange: (status: LoanStatus) => void;
  triggerLabel?: string;
  className?: string;
}

export function ApplicationStatusMenu({
  currentStatus,
  onChange,
  triggerLabel,
  className,
}: ApplicationStatusMenuProps) {
  const t = useTranslations();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" className={className}>
            <RefreshCcw className="size-3.5" />
            {triggerLabel ?? t("applications.statusMenu.changeStatus")}
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{t("applications.statusMenu.moveTo")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {LOAN_STATUS_ORDER.map((status) => (
          <DropdownMenuItem
            key={status}
            disabled={status === currentStatus}
            onClick={() => onChange(status)}
          >
            {t(`statuses.loanApplication.${status}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
