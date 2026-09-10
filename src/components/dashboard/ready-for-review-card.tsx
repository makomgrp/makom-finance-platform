import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ClipboardCheck, CheckCircle2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDateTime } from "@/lib/format";
import type { Locale } from "@/i18n/config";
import type { MyReadyForReviewItem } from "@/lib/services/document-completeness-workflow";

interface ReadyForReviewCardProps {
  items: MyReadyForReviewItem[];
}

/**
 * ============================================================================
 * MILESTONE 2.4 — "READY FOR REVIEW" IS NOT "APPROVED"
 * ============================================================================
 *
 * Same UX principle 2.2/2.3 already established: the workflow's internal
 * nudge is a one-time push (a toast can be missed); this card answers "which
 * of my cases have a complete document package and are still awaiting my
 * review" on every dashboard load, independent of whether the nudge was seen.
 *
 * DELIBERATE WORD CHOICE. This card, and its translations, say only "ready
 * for review" / "listo para revisar" — never "approved", "eligible", or
 * anything implying a credit decision. The workflow that populates this list
 * identified a complete document package, nothing about creditworthiness.
 *
 * SELF ONLY, same gate as MyFollowUpsCard/MyDocumentRequestsCard's selfOnly
 * split — see dashboard/page.tsx.
 */
export async function ReadyForReviewCard({ items }: ReadyForReviewCardProps) {
  const t = await getTranslations();
  const locale = (await getLocale()) as Locale;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("dashboard.readyForReview.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
            {t("dashboard.readyForReview.empty")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {items.map((item) => (
              <li key={item.applicationId}>
                <Link
                  href={`/solicitudes/${item.applicationId}`}
                  className="flex items-start gap-2.5 rounded-md bg-navy/10 px-2.5 py-2 text-sm transition-colors hover:bg-muted/60"
                >
                  <ClipboardCheck
                    className="mt-0.5 size-4 shrink-0 text-navy"
                    aria-hidden="true"
                    strokeWidth={1.75}
                  />
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
                      {t("dashboard.readyForReview.readySince", {
                        date: formatDateTime(item.documentsCompleteNotifiedAt, locale),
                      })}
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
