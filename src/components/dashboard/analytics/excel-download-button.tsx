"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * ============================================================================
 * MILESTONE 26B-26F — LA DESCARGA DEL EXTRACTO DETALLADO
 * ============================================================================
 *
 * Junto al botón del PDF y no en su lugar: son dos documentos distintos para
 * dos usos distintos. El PDF es el informe que se enseña; este es el detalle
 * que se trabaja, y lleva datos personales dentro.
 *
 * ESE BOTÓN SE DIBUJA SOLO SI EL SERVIDOR YA DIJO QUE SÍ. La página resuelve
 * `reports:export_sensitive` con `requireCapability` y pasa el resultado hasta
 * aquí; este componente no decide nada, solo obedece. Y aunque se dibujara por
 * error, la ruta vuelve a exigir la capacidad y devuelve 403: esto es una
 * cortesía visual, la defensa está en el servidor.
 *
 * EL `title` NO ES DECORATIVO. Avisa de que el archivo contiene datos
 * personales ANTES de pulsar, no después de tenerlo en la carpeta de descargas.
 *
 * Un enlace y no un `fetch`, igual que el PDF: la descarga la gestiona el
 * navegador con la cabecera `Content-Disposition`. Traer un libro con la
 * cartera de clientes a memoria de JavaScript para volver a ofrecerlo sería
 * exponerlo a todo lo que corre en la pestaña a cambio de nada.
 */
export function ExcelDownloadButton() {
  const t = useTranslations("dashboard.analytics.excel");
  const searchParams = useSearchParams();

  const query = new URLSearchParams();
  // Solo los tres parámetros del período, como el PDF. Nada más de la URL viaja:
  // la ruta no lo lee, y arrastrar parámetros que nadie interpreta sugiere que
  // hacen algo.
  for (const key of ["periodo", "desde", "hasta"]) {
    const value = searchParams.get(key);
    if (value) query.set(key, value);
  }
  const href = query.toString()
    ? `/api/exportacion-detallada?${query.toString()}`
    : "/api/exportacion-detallada";

  return (
    <Button
      variant="outline"
      size="sm"
      nativeButton={false}
      render={<a href={href} title={t("downloadTitle")} />}
    >
      <FileSpreadsheet className="size-4 shrink-0" aria-hidden="true" />
      <span>{t("download")}</span>
    </Button>
  );
}
