"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { FileText, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * ============================================================================
 * MILESTONE 26B-27A — IMPRIMIR EL EXPEDIENTE
 * ============================================================================
 *
 * UN `fetch` Y NO UN ENLACE, al revés que el informe ejecutivo y el Excel.
 *
 * Aquellos son informes de gestión: se piden, tardan lo que tardan y no pasa
 * nada si el navegador se queda un momento pensando. Este se pulsa en mitad de
 * una llamada con un cliente o entrando a un comité, y necesita dos cosas que
 * un `<a href>` no da: un estado visible mientras se genera, y un mensaje
 * legible si algo falla. Con un enlace, un 500 abre una pestaña con un JSON.
 *
 * El coste es tener el PDF un momento en memoria del navegador. Es aceptable
 * aquí porque quien pulsa ya está viendo ese mismo expediente en pantalla: el
 * documento no le muestra nada que no tuviera delante.
 *
 * ESTE BOTÓN NO AUTORIZA NADA. La ruta repite el alcance de sucursal del
 * expediente y devuelve 404 a quien no deba verlo. Aquí solo se dibuja el
 * control, y eso es una cortesía.
 */
export function DossierPdfButton({ applicationId }: { applicationId: string }) {
  const t = useTranslations("applicationDossier.pdf");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function handleDownload() {
    setBusy(true);
    setError(false);
    try {
      const response = await fetch(`/api/solicitudes/${applicationId}/pdf`);
      if (!response.ok) throw new Error(String(response.status));

      // El nombre lo decide el servidor, que es quien sabe si hay número de
      // solicitud o si es un borrador. Aquí solo se lee la cabecera.
      const disposition = response.headers.get("content-disposition") ?? "";
      const match = /filename="([^"]+)"/.exec(disposition);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);

      const link = document.createElement("a");
      link.href = url;
      link.download = match?.[1] ?? "ODL.pdf";
      link.click();
      // Sin esto el blob se queda en memoria hasta recargar la página, y este
      // botón se pulsa varias veces en una misma sesión de trabajo.
      URL.revokeObjectURL(url);
    } catch {
      // Nada del error llega a la pantalla: puede llevar detalle del servidor.
      // El usuario necesita saber que falló y poder reintentar, no el porqué.
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        variant="outline"
        size="sm"
        onClick={handleDownload}
        disabled={busy}
        title={t("downloadTitle")}
      >
        {busy ? (
          <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden="true" />
        ) : (
          <FileText className="size-4 shrink-0" aria-hidden="true" />
        )}
        <span>{busy ? t("downloading") : t("download")}</span>
      </Button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {t("downloadError")}
        </p>
      )}
    </div>
  );
}
