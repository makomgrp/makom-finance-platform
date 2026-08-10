"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { UserPlus, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { LANGUAGE_CONFIG } from "@/lib/config/language";
import type { User } from "@/types";

interface UsersSectionProps {
  users: User[];
  /** True when the Supabase read failed — shows an explicit error state
   * instead of silently falling back to any other data source. */
  hasError: boolean;
}

export function UsersSection({ users, hasError }: UsersSectionProps) {
  const t = useTranslations();

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>{t("settings.users.title")}</CardTitle>
        <Button
          size="sm"
          variant="outline"
          onClick={() => toast.info(t("settings.users.toastInvite"))}
        >
          <UserPlus className="size-4" />
          {t("settings.users.invite")}
        </Button>
      </CardHeader>
      <CardContent>
        {hasError ? (
          <EmptyState
            icon={AlertTriangle}
            title={t("settings.users.loadErrorTitle")}
            description={t("settings.users.loadErrorDescription")}
          />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("settings.users.columns.name")}</TableHead>
                  <TableHead>{t("settings.users.columns.email")}</TableHead>
                  <TableHead>{t("settings.users.columns.role")}</TableHead>
                  <TableHead>{t("settings.users.columns.language")}</TableHead>
                  <TableHead>{t("settings.users.columns.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium text-foreground">{user.fullName}</TableCell>
                    <TableCell className="text-muted-foreground">{user.email}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {t(`roles.${user.role}`)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        <span className="rounded border border-border px-1.5 py-0.5 text-[11px] font-medium text-foreground">
                          {LANGUAGE_CONFIG[user.preferredLanguage].abbreviation}
                        </span>
                        {LANGUAGE_CONFIG[user.preferredLanguage].nativeName}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        label={user.active ? t("settings.users.active") : t("settings.users.inactive")}
                        className={
                          user.active
                            ? "bg-success/10 text-success border-success/20"
                            : "bg-muted text-muted-foreground border-border"
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
