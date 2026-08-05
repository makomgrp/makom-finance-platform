import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface KpiCardProps {
  label: string;
  value: number | string;
  icon: LucideIcon;
  accentClass?: string;
  hint?: string;
}

export function KpiCard({ label, value, icon: Icon, accentClass, hint }: KpiCardProps) {
  return (
    <Card>
      <CardContent className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">{label}</p>
          <p className="mt-1.5 text-2xl font-semibold text-foreground">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary",
            accentClass
          )}
        >
          <Icon className="size-5" strokeWidth={1.75} />
        </div>
      </CardContent>
    </Card>
  );
}
