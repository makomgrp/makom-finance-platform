"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

/**
 * MILESTONE 18: the directory itself is real and unchanged — getProfiles()
 * reads `profiles` from Supabase and this component surfaces an explicit
 * error state rather than falling back to any other source. Only the
 * "Invitar usuario" button was removed: it did nothing but raise a toast
 * saying the feature would arrive later. Issuing invitations needs an
 * insert path on `profiles` plus Supabase Auth user creation, neither of
 * which exists yet; that is the user-administration milestone's job.
 */
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
      <CardHeader>
        <CardTitle>{t("settings.users.title")}</CardTitle>
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
