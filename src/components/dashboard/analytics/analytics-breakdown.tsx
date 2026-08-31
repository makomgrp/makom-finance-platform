import { getLocale, getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import { formatDurationHours, periodIsCoveredBy } from "@/lib/reporting/presentation";
import { BarRow, CoverageNotice, NoData, SectionHeading } from "./analytics-primitives";
import type { ReportingSnapshot } from "@/lib/reporting/types";

/**
 * ============================================================================
 * MILESTONE 26B-26D — EL DETALLE POR PRODUCTO, PROCESO Y ORIGEN
 * ============================================================================
 *
 * Las secciones que responden «¿en qué?», «¿cuánto tarda?» y «¿de dónde
 * viene?». Todas leen del mismo `ReportingSnapshot` y ninguna vuelve a agregar
 * nada: si una cifra de aquí no coincide con la de arriba, es que el contrato
 * está mal, no que dos pantallas calcularon distinto.
 */

/** Nombre visible de un producto, desde el catálogo — nunca un UUID en pantalla. */
function productLabel(code: string, applicationCode: string | null): string {
  return applicationCode ? `${code.replace(/_/g, " ")} (${applicationCode})` : code.replace(/_/g, " ");
}

export async function ProductSection({ snapshot }: { snapshot: ReportingSnapshot }) {
  const t = await getTranslations("dashboard.analytics.products");
  const rows = snapshot.products;
  const maxRequested = Math.max(0, ...rows.map((row) => row.requestedTotal));
  const anyActivity = rows.some((row) => row.created > 0);

  return (
    <section>
      <SectionHeading title={t("title")} description={t("description")} />
      <Card>
        <CardContent className="space-y-4">
          {!anyActivity ? (
            <NoData>{t("noActivity")}</NoData>
          ) : (
            <div>
              {rows.map((row) => (
                <BarRow
                  key={row.productId}
                  label={productLabel(row.productCode, row.applicationCode)}
                  value={row.requestedTotal}
                  displayValue={formatCurrency(row.requestedTotal)}
                  max={maxRequested}
                  labelClassName="capitalize"
                />
              ))}
            </div>
          )}

          {/* La tabla vive dentro de su propio contenedor con scroll: en móvil
              seis columnas no caben, y el remedio no puede ser que la PÁGINA
              entera se desplace de lado. */}
          <div className="-mx-2 overflow-x-auto px-2">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-medium">{t("product")}</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">{t("created")}</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">{t("formalized")}</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">{t("approved")}</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">{t("declined")}</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">{t("requested")}</th>
                  <th scope="col" className="py-2 text-right font-medium">{t("approvedAmount")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.productId} className="border-b border-border/60 last:border-0">
                    <td className="py-2 pr-3 capitalize">
                      {productLabel(row.productCode, row.applicationCode)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{row.created}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{row.formalized}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{row.approved}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{row.declined}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatCurrency(row.requestedTotal)}
                    </td>
                    <td className="py-2 text-right tabular-nums">
                      {formatCurrency(row.approvedTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * Solicitado frente a aprobado.
 *
 * ⚠️ LA DIFERENCIA ENTRE LOS DOS NO ES «LO QUE NO SE PRESTÓ». Una solicitud
 * puede seguir en revisión, y ODL no tiene todavía ningún registro de
 * desembolso — no hay tabla, no hay fecha, no hay saldo. La nota al pie lo dice
 * en la pantalla, no solo aquí, porque es la lectura equivocada más fácil de
 * hacer y la más cara.
 */
export async function FinancialSection({ snapshot }: { snapshot: ReportingSnapshot }) {
  const t = await getTranslations("dashboard.analytics.financial");
  const { financial } = snapshot;

  return (
    <section>
      <SectionHeading title={t("title")} description={t("description")} />
      <Card>
        <CardContent className="space-y-5">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <dt className="text-sm text-muted-foreground">{t("requestedTotal")}</dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums text-foreground">
                {formatCurrency(financial.requestedTotal)}
              </dd>
              <p className="text-xs text-muted-foreground">
                {t("count", { count: financial.requestedCount })}
              </p>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">{t("requestedMedian")}</dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums text-foreground">
                {financial.requestedMedian === null
                  ? t("noData")
                  : formatCurrency(financial.requestedMedian)}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">{t("approvedTotal")}</dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums text-foreground">
                {financial.approvedCount === 0
                  ? t("noApprovals")
                  : formatCurrency(financial.approvedTotal)}
              </dd>
              {financial.approvedCount > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t("count", { count: financial.approvedCount })}
                </p>
              )}
            </div>
            <div>
              <dt className="text-sm text-muted-foreground">{t("approvedMedian")}</dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums text-foreground">
                {financial.approvedMedian === null
                  ? t("noData")
                  : formatCurrency(financial.approvedMedian)}
              </dd>
            </div>
          </dl>

          <p className="border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
            {t("notDisbursedNote")}
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

export async function DocumentSection({ snapshot }: { snapshot: ReportingSnapshot }) {
  const t = await getTranslations("dashboard.analytics.documents");
  const d = snapshot.documents;

  const slotStates: { key: string; value: number }[] = [
    { key: "pending", value: d.slotsPendingNow },
    { key: "submitted", value: d.slotsSubmittedNow },
    { key: "underReview", value: d.slotsUnderReviewNow },
    { key: "satisfied", value: d.slotsSatisfiedNow },
    { key: "rejected", value: d.slotsRejectedNow },
    { key: "waived", value: d.slotsWaivedNow },
    { key: "missing", value: d.slotsMissingNow },
  ];

  return (
    <section>
      <SectionHeading title={t("title")} description={t("description")} />
      <Card>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-muted-foreground">{t("uploadedInPeriod")}</p>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums text-foreground">
                {d.uploadedInPeriod}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("awaitingReviewNow")}</p>
              <p className="mt-0.5 text-2xl font-semibold tabular-nums text-foreground">
                {d.documentsAwaitingReviewNow}
              </p>
            </div>
          </div>

          {/* Los estados de requisito son del PRESENTE, no del período. El
              subtítulo lo dice para que nadie los sume al recuento de arriba. */}
          <div className="border-t border-border pt-3">
            <p className="mb-2 text-xs text-muted-foreground">{t("slotsNowLabel")}</p>
            <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
              {slotStates.map((state) => (
                <li key={state.key} className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs text-muted-foreground">
                    {t(`slots.${state.key}`)}
                  </span>
                  <span className="text-sm font-medium tabular-nums text-foreground">
                    {state.value}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

export async function ProcessSpeedSection({ snapshot }: { snapshot: ReportingSnapshot }) {
  const t = await getTranslations("dashboard.analytics.speed");
  const tUnits = await getTranslations("dashboard.analytics.units");

  const render = (hours: number | null): string | null => {
    const formatted = formatDurationHours(hours);
    if (!formatted) return null;
    return tUnits(formatted.unit, { value: formatted.value });
  };

  return (
    <section>
      <SectionHeading title={t("title")} description={t("description")} />
      <Card>
        <CardContent>
          <ul className="divide-y divide-border">
            {snapshot.processDurations.map((duration) => {
              const median = render(duration.medianHours);
              const p90 = render(duration.p90Hours);
              return (
                <li key={duration.metric} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0">
                  <span className="text-sm text-foreground">{t(`metrics.${duration.metric}`)}</span>
                  {duration.sampleCount === 0 || median === null ? (
                    <span className="text-sm text-muted-foreground">{t("noSamples")}</span>
                  ) : (
                    <span className="flex items-baseline gap-3">
                      <span className="text-base font-semibold tabular-nums text-foreground">
                        {median}
                      </span>
                      {p90 && (
                        <span className="text-xs text-muted-foreground">
                          {t("p90", { value: p90 })}
                        </span>
                      )}
                      <span className="text-xs text-muted-foreground">
                        {t("samples", { count: duration.sampleCount })}
                      </span>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * De dónde llegan los solicitantes.
 *
 * TRES POBLACIONES, NUNCA DOS. «Sin medir» son los leads anteriores al corte de
 * atribución; «sin campaña» son llegadas directas u orgánicas que SÍ se
 * midieron. Fundirlas convertiría dieciséis leads históricos en «tráfico
 * directo», que es una afirmación que nadie ha comprobado nunca.
 */
export async function AcquisitionSection({ snapshot }: { snapshot: ReportingSnapshot }) {
  const t = await getTranslations("dashboard.analytics.acquisition");
  const locale = await getLocale();
  const { attributionCoverage: cov, attribution, coverage } = snapshot;
  const covered = periodIsCoveredBy(coverage.period, coverage.attributionTrackingStartedAt);
  const maxLeads = Math.max(0, ...attribution.map((row) => row.leads));

  return (
    <section>
      <SectionHeading title={t("title")} description={t("description")} />
      {!covered && coverage.attributionTrackingStartedAt && (
        <CoverageNotice>
          {t("coverageNotice", {
            date: new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-PA", {
              day: "numeric",
              month: "long",
              year: "numeric",
              timeZone: coverage.period.timeZone,
            }).format(new Date(coverage.attributionTrackingStartedAt)),
          })}
        </CoverageNotice>
      )}
      <Card>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">{t("unmeasured")}</dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums text-foreground">
                {cov.unmeasured}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("measuredWithoutUtm")}</dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums text-foreground">
                {cov.measuredWithoutUtm}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">{t("measuredWithUtm")}</dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums text-foreground">
                {cov.measuredWithUtm}
              </dd>
            </div>
          </dl>

          <div className="border-t border-border pt-3">
            {attribution.length === 0 ? (
              <NoData>{t("noCampaigns")}</NoData>
            ) : (
              <div>
                {attribution.slice(0, 8).map((row, index) => (
                  <BarRow
                    key={`${row.utmSource ?? "-"}|${row.utmCampaign ?? "-"}|${index}`}
                    label={
                      row.utmSource
                        ? row.utmCampaign
                          ? `${row.utmSource} · ${row.utmCampaign}`
                          : row.utmSource
                        : row.referrerHost ?? t("directArrival")
                    }
                    value={row.leads}
                    displayValue={t("leadsCount", { count: row.leads })}
                    max={maxLeads}
                  />
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * El equipo.
 *
 * SIN TASA DE APROBACIÓN Y SIN ORDEN POR RESULTADO. Esa cifra depende del
 * perfil de los clientes que a cada uno le tocaron, no de su criterio, y
 * publicarla como rendimiento empuja a aprobar de más. Aquí hay volumen y
 * carga; la interpretación es de ODL.
 *
 * Los nombres se resuelven en el servidor a partir del directorio de personal
 * que quien mira ya puede ver, y NO viajan en la capa agregada: el contrato de
 * 26B-26C lleva `profileId` y ningún dato personal, y así se queda.
 */
export async function TeamSection({
  snapshot,
  nameByProfileId,
}: {
  snapshot: ReportingSnapshot;
  nameByProfileId: Record<string, string>;
}) {
  const t = await getTranslations("dashboard.analytics.team");
  const rows = snapshot.team.filter((row) => nameByProfileId[row.profileId]);
  const anyWork = rows.some(
    (row) => row.assignedOpenNow > 0 || row.formalizedInPeriod > 0 || row.followUpsOpenNow > 0
  );

  return (
    <section>
      <SectionHeading title={t("title")} description={t("description")} />
      <Card>
        <CardContent>
          {rows.length === 0 ? (
            <NoData>{t("noProfiles")}</NoData>
          ) : !anyWork ? (
            <NoData>{t("noAssignments")}</NoData>
          ) : (
            <div className="-mx-2 overflow-x-auto px-2">
              <table className="w-full min-w-[30rem] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted-foreground">
                    <th scope="col" className="py-2 pr-3 font-medium">{t("person")}</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">{t("assignedOpen")}</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">{t("formalized")}</th>
                    <th scope="col" className="py-2 pr-3 text-right font-medium">{t("decisions")}</th>
                    <th scope="col" className="py-2 text-right font-medium">{t("followUpsOpen")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.profileId} className="border-b border-border/60 last:border-0">
                      <td className="py-2 pr-3">{nameByProfileId[row.profileId]}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{row.assignedOpenNow}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{row.formalizedInPeriod}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {row.approvedInPeriod + row.declinedInPeriod}
                      </td>
                      <td className="py-2 text-right tabular-nums">{row.followUpsOpenNow}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}

/**
 * Seguimientos y correo, juntos y en segundo plano.
 *
 * Del correo solo hay enviados, recibidos y vinculación. No hay tasa de
 * entrega, ni de rebote, ni de apertura, porque `email_messages` no guarda
 * estado de entrega — y un 0% de aperturas sería una medición inventada.
 * WhatsApp no aparece en absoluto: no hay ningún seguimiento estructurado, y un
 * gráfico vacío afirmaría que sí lo hay y que dio cero.
 */
export async function OperationsFooterSection({ snapshot }: { snapshot: ReportingSnapshot }) {
  const t = await getTranslations("dashboard.analytics.followUps");
  const tc = await getTranslations("dashboard.analytics.communications");
  const f = snapshot.followUps;
  const c = snapshot.communications;

  const stat = (label: string, value: number) => (
    <div key={label}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-foreground">{value}</p>
    </div>
  );

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section>
        <SectionHeading title={t("title")} />
        <Card>
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {stat(t("openNow"), f.openNow)}
            {stat(t("overdueNow"), f.overdueNow)}
            {stat(t("created"), f.createdInPeriod)}
            {stat(t("completed"), f.completedInPeriod)}
          </CardContent>
        </Card>
      </section>

      <section>
        <SectionHeading title={tc("title")} />
        <Card>
          <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {stat(tc("sent"), c.emailsSent)}
            {stat(tc("received"), c.emailsReceived)}
            {stat(tc("linked"), c.emailsLinked)}
            {stat(tc("unlinked"), c.emailsUnlinked)}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
