"use client";

import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Label } from "@/components/ui/label";
import { useCurrentProfile } from "@/lib/auth/current-profile-context";
import { getInitials } from "@/lib/format";

/**
 * Milestone 5A: real authenticated identity, resolved once server-side
 * by src/app/(app)/layout.tsx and provided via CurrentProfileProvider —
 * no query happens here.
 *
 * MILESTONE 18: READ-ONLY. This section previously rendered editable name
 * and e-mail inputs plus a "Guardar cambios" button whose entire effect
 * was a toast reading "(demostración)" — nothing was ever written. The
 * values shown are and always were real; only the controls implying they
 * could be changed were false. Profile editing needs an update path on
 * `profiles` that does not exist yet and belongs to the user-
 * administration milestone, so the fields are now presented as plain
 * read-only values rather than inputs that quietly discard what you type.
 */
export function ProfileSection() {
  const profile = useCurrentProfile();
  const t = useTranslations();

  const fields = [
    { key: "fullName", label: t("settings.profile.fullName"), value: profile.fullName },
    { key: "email", label: t("settings.profile.email"), value: profile.email },
    { key: "role", label: t("settings.profile.role"), value: t(`roles.${profile.role}`) },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("settings.profile.title")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center gap-4">
          <Avatar className="size-16">
            <AvatarFallback className="bg-primary/10 text-lg font-semibold text-primary">
              {getInitials(profile.fullName)}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium text-foreground">{profile.fullName}</p>
            <p className="text-sm text-muted-foreground">{t(`roles.${profile.role}`)}</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {fields.map((field) => (
            <div key={field.key} className="space-y-1.5">
              <Label>{field.label}</Label>
              <p className="text-sm text-foreground">{field.value}</p>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">{t("settings.profile.readOnlyNotice")}</p>
      </CardContent>
    </Card>
  );
}
