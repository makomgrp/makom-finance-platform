import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { FileWarning, CheckCircle2, Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/config";
import type { MyDocumentRequestItem } from "@/lib/services/document-requests";

interface MyDocumentRequestsCardProps {
  items: MyDocumentRequestItem[];
}

/**
 * ============================================================================
 * MILESTONE 2.3 — A PERSISTENT PLACE FOR OUTSTANDING DOCUMENTS
 * ============================================================================
 *
 * Same UX principle 2.2 already established for follow-ups: the automated
 * cron (see document-requests.ts) pushes a one-time internal nudge, but a
 * toast is transient. This card answers "what documents are still outstanding
 * on my cases, and has an internal request already gone out for it" on every
 * dashboard load — independent of whether the cron ever ran.
 *
 * SELF ONLY, same gate as MyFollowUpsCard/AdvisorWorkloadCard's selfOnly
 * split — see dashboard/page.tsx.
 */
export async function MyDocumentRequestsCard({ items }: MyDocumentRequestsCardProps) {
  const t = await getTranslations();
  const locale = (await getLocale()) as Locale;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("dashboard.myDocumentRequests.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
            {t("dashboard.myDocumentRequests.empty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {items.map((item) => (
              <li key={item.requirementSlotId}>
                <Link
                  href={`/solicitudes/${item.applicationId}`}
                  className={cn(
                    "flex items-start gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-muted/60",
                    item.requestGenerated ? "bg-muted/40" : "bg-warning/10"
                  )}
                >
                  {item.requestGenerated ? (
                    <Send
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                      strokeWidth={1.75}
                    />
                  ) : (
                    <FileWarning
                      className="mt-0.5 size-4 shrink-0 text-warning"
                      aria-hidden="true"
                      strokeWidth={1.75}
                    />
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-medium text-foreground">
                      {item.clientFullName}
                      {item.applicationNumber && (
                        <span className="ml-1.5 font-normal text-muted-foreground">
                          {item.applicationNumber}
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      <span className="font-medium">
                        {locale === "en" ? item.slotNameEn : item.slotNameEs}
                      </span>
                      {" — "}
                      {item.requestGenerated
                        ? t("dashboard.myDocumentRequests.requestSent")
                        : t("dashboard.myDocumentRequests.requestPending")}
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
