"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { CalendarRange, Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { periodParamFor, SELECTABLE_PERIOD_KINDS } from "@/lib/reporting/period-params";
import type { ReportingPeriodKind } from "@/lib/reporting/period";

/**
 * ============================================================================
 * MILESTONE 26B-26D — EL SELECTOR NO CALCULA NADA
 * ============================================================================
 *
 * Escribe un nombre de período en la URL y ya está. Quien resuelve qué fechas
 * son y en qué zona horaria es el servidor, con el modelo de 26B-26C.
 *
 * Es la misma disciplina que el selector de sucursal: si este control
 * calculara «este mes» por su cuenta, lo haría en la zona del NAVEGADOR, y un
 * gerente conectándose desde Madrid vería un mes distinto del que ve su
 * compañero en Panamá. La respuesta tiene que ser una sola, y por tanto tiene
 * que venir de un solo sitio.
 *
 * `personalizado` no aparece en el menú a propósito: un rango libre necesita un
 * calendario, y esta fase no lo construye. La URL SÍ lo acepta
 * (`?periodo=personalizado&desde=…&hasta=…`), así que un enlace guardado o
 * compartido sigue funcionando — y cuando llegue el selector de fechas no habrá
 * que cambiar nada del servidor.
 */
interface PeriodSelectorProps {
  activeKind: ReportingPeriodKind;
  /** El rango ya resuelto y formateado, para mostrarlo junto al control. */
  rangeLabel: string;
}

export function PeriodSelector({ activeKind, rangeLabel }: PeriodSelectorProps) {
  const t = useTranslations("dashboard.analytics.period");
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const labelFor = (kind: ReportingPeriodKind): string => t(kind);

  const select = (kind: ReportingPeriodKind) => {
    if (kind === activeKind) return;
    const next = new URLSearchParams(searchParams.toString());
    next.set("periodo", periodParamFor(kind));
    // Un período con nombre no lleva fechas. Dejarlas puestas haría que volver a
    // «personalizado» reviviera un rango que el usuario ya había abandonado.
    next.delete("desde");
    next.delete("hasta");
    router.push(`${pathname}?${next.toString()}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button variant="outline" size="sm" className="gap-1.5">
              <CalendarRange className="size-4 shrink-0" />
              <span>{activeKind === "custom" ? t("custom") : labelFor(activeKind)}</span>
              <ChevronDown className="size-3.5 shrink-0 opacity-60" />
              <span className="sr-only">{t("srSelect")}</span>
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="min-w-48">
          {SELECTABLE_PERIOD_KINDS.map((kind) => (
            <DropdownMenuItem key={kind} onClick={() => select(kind)}>
              <Check
                className={kind === activeKind ? "size-4 shrink-0" : "size-4 shrink-0 opacity-0"}
              />
              <span>{labelFor(kind)}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* El rango efectivo, discreto pero siempre visible: «este mes» significa
          cosas distintas el día 1 y el día 30, y un informe sin fechas a la
          vista es un informe que no se puede citar. */}
      <span className="text-sm text-muted-foreground">{rangeLabel}</span>
    </div>
  );
}
