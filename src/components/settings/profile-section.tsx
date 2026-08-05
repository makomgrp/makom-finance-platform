"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDemoSession } from "@/lib/demo-session";

export function ProfileSection() {
  const { user } = useDemoSession();
  const t = useTranslations();

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.profile.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center gap-4">
          <Avatar className="size-16">
            <AvatarFallback className="bg-primary/10 text-lg font-semibold text-primary">
              {user.initials}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium text-foreground">{user.fullName}</p>
            <p className="text-sm text-muted-foreground">{t(`roles.${user.role}`)}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="profile-name">{t("settings.profile.fullName")}</Label>
            <Input id="profile-name" defaultValue={user.fullName} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-email">{t("settings.profile.email")}</Label>
            <Input id="profile-email" defaultValue={user.email} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-role">{t("settings.profile.role")}</Label>
            <Input id="profile-role" defaultValue={t(`roles.${user.role}`)} disabled />
          </div>
        </div>

        <Button
          onClick={() => toast.success(t("settings.profile.toastSaved"))}
          className="w-fit"
        >
          {t("settings.profile.save")}
        </Button>
      </CardContent>
    </Card>
  );
}
