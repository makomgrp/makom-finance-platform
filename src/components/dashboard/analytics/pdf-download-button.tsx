"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * ============================================================================
 * MILESTONE 26B-26E — LA DESCARGA DEL INFORME
 * ============================================================================
 *
 * PROPAGA EL PERÍODO QUE ESTÁ VIENDO, no uno propio. Lee los mismos parámetros
 * de la URL que ya resolvió el servidor para pintar la pantalla, así que el PDF
 * cubre exactamente lo que hay delante: si el Dashboard muestra «este
 * trimestre», el archivo también.
 *
 * Un enlace y no un `fetch`: la descarga la gestiona el navegador con la
 * cabecera `Content-Disposition` que devuelve la ruta. Traer los bytes a
 * JavaScript para volver a ofrecerlos añadiría un blob en memoria y un estado
 * de carga que administrar, a cambio de nada.
 *
 * ESTE BOTÓN NO AUTORIZA NADA. La ruta exige `analytics:view` en el servidor;
 * si alguien copia la dirección, recibe un 403. Aquí solo se decide si el
 * control se dibuja, y eso es una cortesía, no una defensa.
 */
export function PdfDownloadButton() {
  const t = useTranslations("dashboard.analytics.pdf");
  const searchParams = useSearchParams();

  const query = new URLSearchParams();
  // Solo los tres parámetros del período. `sucursal` y cualquier otra cosa que
  // lleve la URL se quedan fuera a propósito: la ruta no los lee, y arrastrar
  // parámetros que nadie interpreta sugiere que hacen algo.
  for (const key of ["periodo", "desde", "hasta"]) {
    const value = searchParams.get(key);
    if (value) query.set(key, value);
  }
  const href = query.toString()
    ? `/api/informe-ejecutivo?${query.toString()}`
    : "/api/informe-ejecutivo";

  return (
    <Button variant="outline" size="sm" nativeButton={false} render={<a href={href} />}>
      <FileDown className="size-4 shrink-0" aria-hidden="true" />
      <span>{t("download")}</span>
    </Button>
  );
}
