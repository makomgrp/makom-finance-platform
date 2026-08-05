"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
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
import { USERS } from "@/lib/demo-data";

export function UsersSection() {
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
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("settings.users.columns.name")}</TableHead>
                <TableHead>{t("settings.users.columns.email")}</TableHead>
                <TableHead>{t("settings.users.columns.role")}</TableHead>
                <TableHead>{t("settings.users.columns.status")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {USERS.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium text-foreground">{user.fullName}</TableCell>
                  <TableCell className="text-muted-foreground">{user.email}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {t(`roles.${user.role}`)}
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
      </CardContent>
    </Card>
  );
}
