"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";

const DEFAULT_PREFERENCES = [
  { id: "new-application", key: "newApplication", enabled: true },
  { id: "documents", key: "documents", enabled: true },
  { id: "alerts", key: "alerts", enabled: true },
  { id: "status", key: "statusChanges", enabled: false },
  { id: "reports", key: "weeklySummary", enabled: false },
] as const;

export function NotificationsSection() {
  const t = useTranslations("settings.notifications");
  const [preferences, setPreferences] = useState<{ id: string; key: string; enabled: boolean }[]>(
    [...DEFAULT_PREFERENCES]
  );

  const toggle = (id: string) => {
    setPreferences((prev) =>
      prev.map((pref) => (pref.id === id ? { ...pref, enabled: !pref.enabled } : pref))
    );
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {preferences.map((pref) => (
            <li key={pref.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
              <div>
                <p className="text-sm font-medium text-foreground">{t(pref.key)}</p>
                <p className="text-xs text-muted-foreground">{t(`${pref.key}Description`)}</p>
              </div>
              <Switch checked={pref.enabled} onCheckedChange={() => toggle(pref.id)} />
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
