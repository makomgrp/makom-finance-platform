"use client";

import { useState, type FormEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { ShieldAlert, Plus, CheckCircle2, RotateCcw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { StatusBadge } from "@/components/shared/status-badge";
import { EmptyState } from "@/components/shared/empty-state";
import { ALERT_LEVEL_BADGE_CLASS, ALERT_LEVEL_VALUES, ALERT_TYPE_VALUES } from "@/lib/config/alert";
import { createDossierAlert, setDossierAlertStatus } from "@/app/(app)/expedientes/actions";
import { formatDate } from "@/lib/format";
import type { Locale } from "@/i18n/config";
import type { ActivityEvent, AlertLevel, AlertType, DossierAlert } from "@/types";

interface AlertsTabProps {
  /** The real Client this alert belongs to (RealClient.id) — Milestone
   * 14E migrated dossier_alerts onto a real, FK-constrained client_id, so
   * every real Client, seeded or newly-created, can register alerts. */
  clientId: string;
  alerts: DossierAlert[];
  onAlertsChange: (alerts: DossierAlert[]) => void;
  onActivity: (
    descriptionKey: string,
    params: Record<string, string> | undefined,
    type: ActivityEvent["type"]
  ) => void;
  /** True when the initial server-side load of this client's alerts
   * failed. Never silently falls back to an empty/demo state — see the
   * Milestone 7 architecture review's failure-state design. */
  loadError: boolean;
}

export function AlertsTab({ clientId, alerts, onAlertsChange, onActivity, loadError }: AlertsTabProps) {
  const locale = useLocale() as Locale;
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<AlertType>("revision_especial");
  const [level, setLevel] = useState<AlertLevel>("bajo");
  const [reason, setReason] = useState("");
  const [observation, setObservation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    const result = await createDossierAlert({ clientId, type, level, reason, observation });
    setSubmitting(false);

    if (result.status !== "success") {
      toast.error(t("dossier.alerts.toastError"));
      return;
    }

    onAlertsChange([result.alert, ...alerts]);
    onActivity("alertRegistered", { type: t(`statuses.alertType.${type}`) }, "alerta_registrada");
    toast.success(t("dossier.alerts.toastAdded"));
    setType("revision_especial");
    setLevel("bajo");
    setReason("");
    setObservation("");
    setOpen(false);
  };

  const toggleResolved = async (alert: DossierAlert) => {
    setResolvingId(alert.id);
    const result = await setDossierAlertStatus({ alertId: alert.id, targetActive: !alert.active });
    setResolvingId(null);

    if (result.status !== "success") {
      toast.error(t("dossier.alerts.toastResolveError"));
      return;
    }

    onAlertsChange(alerts.map((item) => (item.id === alert.id ? result.alert : item)));
    toast.success(alert.active ? t("dossier.alerts.toastResolved") : t("dossier.alerts.toastReactivated"));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{t("dossier.alerts.title")}</h3>
          <p className="text-xs text-muted-foreground">{t("dossier.alerts.subtitle")}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger
            render={
              <Button size="sm">
                <Plus className="size-4" />
                {t("dossier.alerts.registerAlert")}
              </Button>
            }
          />
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t("dossier.alerts.dialogTitle")}</DialogTitle>
              <DialogDescription>{t("dossier.alerts.dialogDescription")}</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label htmlFor="alert-type">{t("dossier.alerts.type")}</Label>
                  <Select value={type} onValueChange={(value) => value && setType(value as AlertType)}>
                    <SelectTrigger id="alert-type" className="w-full">
                      <SelectValue>
                        {(value: string) => t(`statuses.alertType.${value as AlertType}`)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {ALERT_TYPE_VALUES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {t(`statuses.alertType.${value}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="alert-level">{t("dossier.alerts.level")}</Label>
                  <Select value={level} onValueChange={(value) => value && setLevel(value as AlertLevel)}>
                    <SelectTrigger id="alert-level" className="w-full">
                      <SelectValue>
                        {(value: string) => t(`statuses.alertLevel.${value as AlertLevel}`)}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {ALERT_LEVEL_VALUES.map((value) => (
                        <SelectItem key={value} value={value}>
                          {t(`statuses.alertLevel.${value}`)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="alert-reason">{t("dossier.alerts.reason")}</Label>
                <Input
                  id="alert-reason"
                  required
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="alert-observation">{t("dossier.alerts.observation")}</Label>
                <Textarea
                  id="alert-observation"
                  rows={3}
                  value={observation}
                  onChange={(event) => setObservation(event.target.value)}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  {t("dossier.alerts.cancel")}
                </Button>
                <Button type="submit" disabled={submitting}>
                  {t("dossier.alerts.registerAlert")}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {loadError ? (
        <EmptyState
          icon={ShieldAlert}
          title={t("dossier.alerts.loadErrorTitle")}
          description={t("dossier.alerts.loadErrorDescription")}
        />
      ) : alerts.length === 0 ? (
        <EmptyState
          icon={ShieldAlert}
          title={t("dossier.alerts.emptyTitle")}
          description={t("dossier.alerts.emptyDescription")}
        />
      ) : (
        <div className="space-y-3">
          {alerts.map((alert) => (
            <Card key={alert.id}>
              <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <p className="font-medium text-foreground">
                      {t(`statuses.alertType.${alert.type}`)}
                    </p>
                    <StatusBadge
                      label={t(`statuses.alertLevel.${alert.level}`)}
                      className={ALERT_LEVEL_BADGE_CLASS[alert.level]}
                    />
                    <StatusBadge
                      label={alert.active ? t("dossier.alerts.active") : t("dossier.alerts.resolved")}
                      className={
                        alert.active
                          ? "bg-warning/10 text-warning border-warning/20"
                          : "bg-success/10 text-success border-success/20"
                      }
                    />
                  </div>
                  <p className="text-sm text-foreground">{alert.reason}</p>
                  {alert.observation && (
                    <p className="mt-1 text-sm text-muted-foreground">{alert.observation}</p>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    {formatDate(alert.createdAt, locale)} · {t("dossier.alerts.responsible")}:{" "}
                    {alert.createdByFullName}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0"
                  disabled={resolvingId === alert.id}
                  onClick={() => toggleResolved(alert)}
                >
                  {alert.active ? (
                    <>
                      <CheckCircle2 className="size-3.5" />
                      {t("dossier.alerts.markResolved")}
                    </>
                  ) : (
                    <>
                      <RotateCcw className="size-3.5" />
                      {t("dossier.alerts.reactivate")}
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
