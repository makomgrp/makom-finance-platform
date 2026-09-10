import { NextResponse, type NextRequest } from "next/server";
import { processDueDocumentRequests } from "@/lib/services/document-requests";

/**
 * ============================================================================
 * MILESTONE 2.3 — LA SOLICITUD AUTOMÁTICA INTERNA DE DOCUMENTOS
 * ============================================================================
 *
 * Lo invoca Vercel Cron. Ver `vercel.json`.
 *
 * ----------------------------------------------------------------------------
 * MISMO PATRÓN DE SEGURIDAD QUE /api/recordatorios-seguimiento
 * ----------------------------------------------------------------------------
 * `CRON_SECRET` en `Authorization: Bearer`, comparado solo después de
 * confirmar que la variable existe. Sin el secreto configurado, este endpoint
 * responde 401, sin excepción "mientras se configura".
 *
 * ----------------------------------------------------------------------------
 * SOLO INTERNO — SIN COMUNICACIÓN AL CLIENTE
 * ----------------------------------------------------------------------------
 * `processDueDocumentRequests` empuja un aviso al canal del asesor asignado.
 * No envía correo ni WhatsApp al cliente — esa activación es una decisión de
 * negocio separada, pendiente de confirmación (ver auditoría de arquitectura
 * de 2.3).
 *
 * ----------------------------------------------------------------------------
 * IDEMPOTENTE E INOFENSIVO SI SE DISPARA DOS VECES
 * ----------------------------------------------------------------------------
 * Vercel Cron es *best effort* y puede invocar la misma ejecución más de una
 * vez. La segunda invocación no reclama nada que la primera ya haya
 * reclamado — ver `document_request_generated_at` en `document-requests.ts`.
 *
 * ----------------------------------------------------------------------------
 * FRECUENCIA: DIARIA, CONSERVADORA A PROPÓSITO
 * ----------------------------------------------------------------------------
 * Misma cadencia que `recordatorios-seguimiento` mientras Damion no confirme
 * otra cosa — cambiarla después es una línea en `vercel.json`.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const result = await processDueDocumentRequests();

  return NextResponse.json(
    {
      status: "ok",
      candidatesRead: result.candidatesRead,
      claimed: result.claimed,
      skippedUnassigned: result.skippedUnassigned,
      skippedNotEligible: result.skippedNotEligible,
      notifyFailures: result.notifyFailures,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
