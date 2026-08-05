import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { PENDING_TASKS } from "@/lib/demo-data";

export async function PendingTasksCard() {
  const t = await getTranslations("dashboard.pendingTasks");

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {PENDING_TASKS.map((task) => (
            <li key={task.id} className="flex items-center gap-3">
              <Checkbox id={task.id} />
              <label htmlFor={task.id} className="flex flex-1 items-center gap-2 text-sm text-foreground">
                <task.icon className="size-4 text-muted-foreground" strokeWidth={1.75} />
                {t(task.key)}
              </label>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
