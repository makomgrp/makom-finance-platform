"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function SecuritySection() {
  const t = useTranslations();
  const [twoFactor, setTwoFactor] = useState(false);
  const [sessionTimeout, setSessionTimeout] = useState("30");

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>{t("settings.security.title")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-foreground">
                {t("settings.security.twoFactor")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("settings.security.twoFactorDescription")}
              </p>
            </div>
            <Switch checked={twoFactor} onCheckedChange={setTwoFactor} />
          </div>

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="session-timeout" className="text-sm font-medium text-foreground">
                {t("settings.security.sessionTimeout")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("settings.security.sessionTimeoutDescription")}
              </p>
            </div>
            <Select
              value={sessionTimeout}
              onValueChange={(value) => value && setSessionTimeout(value)}
            >
              <SelectTrigger id="session-timeout" className="w-40">
                <SelectValue>
                  {(value: string) => {
                    if (value === "15") return t("settings.security.minutes15");
                    if (value === "60") return t("settings.security.minutes60");
                    return t("settings.security.minutes30");
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="15">{t("settings.security.minutes15")}</SelectItem>
                <SelectItem value="30">{t("settings.security.minutes30")}</SelectItem>
                <SelectItem value="60">{t("settings.security.minutes60")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-4 border-t border-border pt-4">
            <div>
              <p className="text-sm font-medium text-foreground">
                {t("settings.security.password")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("settings.security.passwordLastUpdate")}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => toast.info(t("settings.security.toastPasswordDisabled"))}
            >
              {t("settings.security.changePassword")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
