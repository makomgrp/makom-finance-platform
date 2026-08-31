import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { deltaDirection, formatDeltaPercent } from "@/lib/reporting/presentation";
import type { MetricComparison } from "@/lib/reporting/period";

/**
 * ============================================================================
 * MILESTONE 26B-26D — LAS PIEZAS DE LAS QUE SE ARMA EL INFORME
 * ============================================================================
 *
 * Componentes de servidor, sin estado y sin cálculo. Todos comparten una regla:
 * cuando el contrato dice `null`, la pantalla dice por qué, no dice cero.
 *
 * ----------------------------------------------------------------------------
 * NADA DEPENDE SOLO DEL COLOR
 * ----------------------------------------------------------------------------
 * Una variación al alza lleva flecha, signo y color; a la baja, otra flecha,
 * otro signo y otro color. El verde y el rojo son el tercer refuerzo, nunca el
 * único: entre el 5% y el 8% de los hombres no distingue esos dos, y un informe
 * de dirección que solo se puede leer con visión cromática normal es un informe
 * que una parte de la gerencia no puede leer.
 */

/** Un rótulo de sección: título, y por debajo lo que la sección responde. */
export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
      <div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        {description && <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/**
 * Un aviso de cobertura.
 *
 * NO es un error y no se pinta como tal. Dice «esto todavía no se medía», que
 * es una verdad sobre el sistema, no un fallo. Pintarlo en rojo enseñaría a la
 * gerencia a ignorar los avisos rojos de verdad.
 */
export function CoverageNotice({ children }: { children: ReactNode }) {
  return (
    <p className="mb-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * Lo que se muestra cuando una cifra no se puede calcular.
 *
 * Una frase, no un guion. «—» obliga a cada lector a inventarse por qué está
 * vacío, y la mitad concluirá que el sistema falla.
 */
export function NoData({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted-foreground">{children}</p>;
}

interface DeltaProps {
  comparison: MetricComparison;
  /** Qué se muestra cuando no hay base de comparación. */
  noComparisonLabel: string;
  vsLabel: string;
}

/** La variación frente al período anterior, o la declaración de que no la hay. */
export function DeltaBadge({ comparison, noComparisonLabel, vsLabel }: DeltaProps) {
  const direction = deltaDirection(comparison);
  const percent = formatDeltaPercent(comparison);

  if (direction === "none" || percent === null) {
    return <span className="text-xs text-muted-foreground">{noComparisonLabel}</span>;
  }

  const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : Minus;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-xs font-medium",
        direction === "up" && "text-success",
        direction === "down" && "text-destructive",
        direction === "flat" && "text-muted-foreground"
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span>{percent}</span>
      <span className="font-normal text-muted-foreground">{vsLabel}</span>
    </span>
  );
}

interface MetricCardProps {
  label: string;
  /** Ya formateado. `null` significa que no se puede calcular. */
  value: string | null;
  /** Qué decir cuando `value` es null. */
  emptyLabel?: string;
  comparison?: MetricComparison;
  noComparisonLabel?: string;
  vsLabel?: string;
  footnote?: string;
}

/**
 * Una cifra ejecutiva.
 *
 * El número manda visualmente y la comparación es discreta: quien abre esto por
 * la mañana quiere leer seis cifras de un vistazo, no seis cifras compitiendo
 * con seis porcentajes del mismo tamaño.
 */
export function MetricCard({
  label,
  value,
  emptyLabel,
  comparison,
  noComparisonLabel,
  vsLabel,
  footnote,
}: MetricCardProps) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-1">
        <p className="text-sm text-muted-foreground">{label}</p>
        {value === null ? (
          <p className="mt-0.5 text-base font-medium text-muted-foreground">{emptyLabel}</p>
        ) : (
          <p className="mt-0.5 text-2xl font-semibold tracking-tight text-foreground tabular-nums">
            {value}
          </p>
        )}
        {comparison && noComparisonLabel && vsLabel && (
          <DeltaBadge
            comparison={comparison}
            noComparisonLabel={noComparisonLabel}
            vsLabel={vsLabel}
          />
        )}
        {footnote && <p className="text-xs text-muted-foreground">{footnote}</p>}
      </CardContent>
    </Card>
  );
}

/**
 * Una barra horizontal comparativa.
 *
 * Sin librería de gráficos: el proyecto no tiene ninguna instalada, y traer una
 * para dibujar rectángulos proporcionales sería añadir kilobytes y una
 * dependencia que mantener a cambio de nada. Estas barras son `<div>` con
 * anchura porcentual — accesibles, imprimibles y con el valor SIEMPRE escrito
 * al lado, para que el gráfico no sea la única forma de leer el dato.
 */
export function BarRow({
  label,
  value,
  displayValue,
  max,
  accentClass = "bg-primary",
  labelClassName,
}: {
  label: string;
  value: number;
  displayValue: string;
  max: number;
  accentClass?: string;
  labelClassName?: string;
}) {
  const width = max > 0 ? (Math.max(0, value) / max) * 100 : 0;
  return (
    <div className="flex items-center gap-3 py-1">
      <span className={cn("w-32 shrink-0 truncate text-sm text-muted-foreground sm:w-40", labelClassName)}>
        {label}
      </span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full", accentClass)} style={{ width: `${width}%` }} />
      </div>
      <span className="w-24 shrink-0 text-right text-sm font-medium tabular-nums text-foreground sm:w-32">
        {displayValue}
      </span>
    </div>
  );
}

/**
 * Una barra apilada con leyenda.
 *
 * Cada segmento lleva su cifra en la leyenda, así que la barra ilustra la
 * proporción y la leyenda da el dato. Quien no distinga los colores sigue
 * teniendo la respuesta completa en texto.
 */
export function StackedBar({
  segments,
}: {
  segments: { label: string; value: number; share: number; className: string }[];
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {total > 0 &&
          segments.map((segment) => (
            <div
              key={segment.label}
              className={segment.className}
              style={{ width: `${segment.share}%` }}
            />
          ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        {segments.map((segment) => (
          <li key={segment.label}>
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={cn("size-2 shrink-0 rounded-full", segment.className)} aria-hidden="true" />
              {segment.label}
            </span>
            <span className="mt-0.5 block text-lg font-semibold tabular-nums text-foreground">
              {segment.value}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
