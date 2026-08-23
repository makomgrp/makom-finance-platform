import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createAuthenticatedServerClient } from "@/lib/supabase/server-authenticated";

/**
 * ============================================================================
 * DONDE ATERRIZAN LOS ENLACES DE CORREO DE SUPABASE (26B-12C1)
 * ============================================================================
 *
 * Invitaciones y recuperación de contraseña llegan aquí. Antes esta ruta sólo
 * entendía `?code=` y lo canjeaba con exchangeCodeForSession, y por eso los dos
 * flujos fallaban en Production por motivos distintos:
 *
 *   INVITACIÓN — la genera el cliente admin (@supabase/supabase-js createClient),
 *   cuyo flowType por defecto es `implicit`. Ese flujo devuelve los tokens en el
 *   FRAGMENTO de la URL (#access_token=…), y un fragmento no se envía nunca al
 *   servidor. Este Route Handler no podía verlo aunque quisiera.
 *
 *   RECUPERACIÓN — la genera el cliente SSR, que fuerza `pkce`. Ese flujo sí
 *   manda `?code=`, pero canjearlo exige la cookie `code_verifier` guardada por
 *   el MISMO navegador que pidió el correo. Un enlace de email se abre a menudo
 *   en otra ventana, otro perfil o incluso otro dispositivo, y ahí el verifier
 *   no existe: el canje falla y el usuario ve "enlace inválido o expirado"
 *   aunque el enlace sea recién generado y perfectamente válido.
 *
 * LA FORMA CORRECTA PARA ENLACES DE CORREO ES `token_hash` + `type` CON
 * verifyOtp(): no necesita verifier, así que sobrevive a abrir el correo donde
 * sea — que es justamente lo que un enlace enviado por email tiene que hacer.
 * Es el patrón que Supabase documenta para SSR y está soportado por auth-js
 * 2.112, la versión instalada aquí.
 *
 * NO SE DEBILITA NADA: verifyOtp valida el token contra Supabase igual que el
 * canje. Lo que cambia es el formato aceptado, no el rigor de la comprobación.
 *
 * `?code=` se sigue aceptando para no romper ningún enlace ya emitido ni los
 * flujos que sí usan PKCE legítimamente.
 */

const DEFAULT_NEXT_PATH = "/reset-password";

/** Los únicos `type` que este callback acepta. Un valor fuera de esta lista no
 * se pasa a verifyOtp: el parámetro viene de una URL y no es de fiar. */
const EMAIL_OTP_TYPES = ["invite", "recovery", "signup", "magiclink", "email_change"] as const;

function isEmailOtpType(value: string | null): value is EmailOtpType {
  return value !== null && (EMAIL_OTP_TYPES as readonly string[]).includes(value);
}

function sanitizeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_NEXT_PATH;
  }
  return value;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const next = sanitizeNextPath(searchParams.get("next"));

  // Supabase rechazó el enlace antes de llegar aquí (caducado o ya usado).
  // No hay nada que verificar; se informa en vez de intentar un canje inútil.
  const providerError = searchParams.get("error") ?? searchParams.get("error_code");
  if (providerError) {
    console.error("[auth callback] Supabase rejected the link:", providerError);
    return NextResponse.redirect(`${origin}/reset-password?error=1`);
  }

  const supabase = await createAuthenticatedServerClient();

  // 1. Enlaces de correo modernos: token_hash + type.
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  if (tokenHash && isEmailOtpType(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    console.error("[auth callback] verifyOtp failed:", error.message);
    return NextResponse.redirect(`${origin}/reset-password?error=1`);
  }

  // 2. PKCE. Sólo funciona si el verifier sigue en este navegador; se conserva
  //    porque los enlaces emitidos antes de este cambio llegan así.
  const code = searchParams.get("code");
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    console.error("[auth callback] exchangeCodeForSession failed:", error.message);
  }

  return NextResponse.redirect(`${origin}/reset-password?error=1`);
}
