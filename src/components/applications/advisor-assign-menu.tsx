"use client";

import { useTranslations } from "next-intl";
import { UserRoundCheck, UserRoundPlus } from "lucide-react";
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
import type { AssignableAdvisor } from "@/types";

/**
 * Assign / reassign / unassign the advisor who owns an Application
 * (Milestone 23).
 *
 * Modelled directly on ApplicationStatusMenu, deliberately: same dropdown
 * shape, same "caller owns the semantics" split. This component renders
 * options and reports a choice; it holds no state, performs no mutation, and
 * knows nothing about capabilities — the parent has already decided whether to
 * render it at all, and the Server Action is the enforcement.
 *
 * WHY THE TRIGGER SHOWS THE CURRENT ADVISOR. This sits in the table's existing
 * "Advisor" column and replaces the plain text that was there, so it has to
 * keep reading as a value first and a control second. An unassigned
 * application shows an em dash exactly as before.
 *
 * UNASSIGN IS A FIRST-CLASS OPTION, not an omission — `null` is a state the
 * column has always permitted and the RPC explicitly accepts. It is separated
 * from the people by a rule so it cannot be mistaken for one.
 */
interface AdvisorAssignMenuProps {
  advisors: AssignableAdvisor[];
  currentAdvisorProfileId?: string;
  currentAdvisorFullName?: string;
  /** `null` means unassign. */
  onChange: (advisorProfileId: string | null) => void;
  disabled?: boolean;
}

export function AdvisorAssignMenu({
  advisors,
  currentAdvisorProfileId,
  currentAdvisorFullName,
  onChange,
  disabled,
}: AdvisorAssignMenuProps) {
  const t = useTranslations();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            className="-ml-2 h-auto max-w-44 justify-start px-2 py-1 font-normal"
          >
            {currentAdvisorFullName ? (
              <UserRoundCheck className="size-3.5 shrink-0" />
            ) : (
              <UserRoundPlus className="size-3.5 shrink-0" />
            )}
            <span className="truncate">
              {currentAdvisorFullName ?? t("applications.advisorMenu.unassigned")}
            </span>
          </Button>
        }
      />
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("applications.advisorMenu.assignTo")}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />

        {advisors.length === 0 ? (
          <DropdownMenuItem disabled>
            {t("applications.advisorMenu.noneAvailable")}
          </DropdownMenuItem>
        ) : (
          advisors.map((advisor) => (
            <DropdownMenuItem
              key={advisor.id}
              // The current owner is shown but not selectable: choosing it
              // would be a no-op the database already ignores, and offering it
              // implies something would happen.
              disabled={advisor.id === currentAdvisorProfileId}
              onClick={() => onChange(advisor.id)}
            >
              <span className="truncate">{advisor.fullName}</span>
              <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                {t(`roles.${advisor.role}`)}
              </span>
            </DropdownMenuItem>
          ))
        )}

        {currentAdvisorProfileId && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onChange(null)}>
              {t("applications.advisorMenu.unassign")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
