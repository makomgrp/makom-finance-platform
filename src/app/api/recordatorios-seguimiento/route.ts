import { NextResponse, type NextRequest } from "next/server";
import { processDueFollowUpReminders } from "@/lib/services/follow-up-reminders";

/**
 * ============================================================================
 * MILESTONE 2.2 — EL RECORDATORIO AUTOMÁTICO INTERNO
 * ============================================================================
 *
 * Lo invoca Vercel Cron. Ver `vercel.json`.
 *
 * ----------------------------------------------------------------------------
 * MISMO PATRÓN DE SEGURIDAD QUE /api/cierres-mensuales
 * ----------------------------------------------------------------------------
 * `CRON_SECRET` en `Authorization: Bearer`, comparado solo después de
 * confirmar que la variable existe — para que `Bearer undefined` no pueda
 * colar una autorización fabricada. Sin el secreto configurado, este endpoint
 * responde 401, sin excepción "mientras se configura".
 *
 * ----------------------------------------------------------------------------
 * SOLO INTERNO
 * ----------------------------------------------------------------------------
 * `processDueFollowUpReminders` empuja un aviso al canal del asesor
 * asignado. No envía correo ni WhatsApp al cliente — esos canales existen
 * como tipo en el diseño (§ arquitectura de canales de 2.2) pero no se
 * activan en este milestone.
 *
 * ----------------------------------------------------------------------------
 * IDEMPOTENTE E INOFENSIVO SI SE DISPARA DOS VECES
 * ----------------------------------------------------------------------------
 * Vercel Cron es *best effort* y puede invocar la misma ejecución más de una
 * vez. La segunda invocación no reclama nada que la primera ya haya
 * reclamado — ver `internal_reminder_sent_at` en
 * `follow-up-reminders.ts`.
 *
 * ----------------------------------------------------------------------------
 * FRECUENCIA: DIARIA, CONSERVADORA A PROPÓSITO
 * ----------------------------------------------------------------------------
 * Un recordatorio interno no necesita más granularidad que "una vez al día"
 * mientras Damion no confirme una cadencia distinta — inventar una frecuencia
 * horaria sería una regla de negocio no confirmada disfrazada de detalle
 * técnico. Cambiar la cadencia después es una línea en `vercel.json`, no un
 * cambio de esquema.
 */
export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (!cronSecret || authorization !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const result = await processDueFollowUpReminders();

  return NextResponse.json(
    {
      status: "ok",
      candidatesRead: result.candidatesRead,
      claimed: result.claimed,
      skippedUnassigned: result.skippedUnassigned,
      skippedNotDueYet: result.skippedNotDueYet,
      notifyFailures: result.notifyFailures,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
