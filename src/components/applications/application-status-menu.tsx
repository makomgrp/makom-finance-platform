"use client";

import { useTranslations } from "next-intl";
import { RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * One selectable target status. The caller decides the vocabulary (real
 * ApplicationStatus, legacy LoanStatus, or anything else with a
 * change-status menu shape), its ordering, its labels, and — critically —
 * which targets are actually legal from the current state; this component
 * never assumes a specific status model or transition graph (Milestone
 * 13C — see the Milestone 13A architecture review's "Shared
 * ApplicationStatusMenu" question). `disabled` is for a per-option reason
 * (e.g. "this is the current status"); `triggerDisabled` on the menu
 * itself covers the caller having zero legal options at all (e.g. a
 * terminal ApplicationStatus).
 */
export interface ApplicationStatusMenuOption {
  value: string;
  label: string;
  disabled?: boolean;
}

interface ApplicationStatusMenuProps {
  options: ApplicationStatusMenuOption[];
  onChange: (value: string) => void;
  triggerLabel?: string;
  /** Disables the whole trigger — for when the caller has computed zero
   * legal targets (a terminal status), rather than rendering an empty
   * dropdown. */
  triggerDisabled?: boolean;
  className?: string;
}

export function ApplicationStatusMenu({
  options,
  onChange,
  triggerLabel,
  triggerDisabled,
  className,
}: ApplicationStatusMenuProps) {
  const t = useTranslations();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" size="sm" className={className} disabled={triggerDisabled}>
            <RefreshCcw className="size-3.5" />
            {triggerLabel ?? t("applications.statusMenu.changeStatus")}
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("applications.statusMenu.moveTo")}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuItem key={option.value} disabled={option.disabled} onClick={() => onChange(option.value)}>
            {option.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
