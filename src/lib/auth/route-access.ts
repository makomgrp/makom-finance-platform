/**
 * ============================================================================
 * QUÉ RUTAS ATRAVIESAN LA PUERTA EXTERIOR — Y POR QUÉ PUERTA
 * ============================================================================
 *
 * Extraído de `src/proxy.ts` en 26B-26G.2. Módulo PURO a propósito: sin
 * `next/server`, sin `@supabase/ssr`, sin nada que necesite un runtime.
 *
 * La razón no es el orden. Es que este fichero decide QUÉ PETICIONES ENTRAN AL
 * CRM SIN SESIÓN, y una decisión así tiene que poder ejercitarse con
 * `node --test` sobre cada ruta, incluidas las que todavía no existen. Mientras
 * vivía dentro del proxy no se podía importar sin levantar medio Next, así que
 * la única «prueba» posible era leer el fuente y confiar.
 *
 * `src/proxy.ts` sigue siendo quien decide y quien redirige; aquí solo están
 * los predicados.
 */

const PUBLIC_PATHS = [
  "/",
  "/login",
  "/forgot-password",
  "/reset-password",
  "/auth/callback",
  // Milestone 15C: the public website loan-application form. Genuinely
  // public — a prospective applicant has no CRM session, and this is the
  // whole point of the page. Moved to /solicitud-clasico by 26B-1, which
  // gave /solicitud to the customer portal.
  "/solicitud-clasico",
];

// MILESTONE 26B-1 — the public customer portal.
//
// A PREFIX rather than an exact path, because the portal is a multi-page flow:
// /solicitud, /solicitud/continuar/<token> and every later step share one
// public boundary. Listing each page separately would mean a future step
// silently redirecting customers to /login the day it is added.
//
// Safe as a prefix precisely because nothing authenticated lives under it: the
// CRM's own application screens are /solicitudes (plural), a different path
// that this check does not match — `startsWith("/solicitud/")` requires the
// trailing slash, and "/solicitudes" does not contain it at that position.
const PORTAL_PATH = "/solicitud";

// Milestone 15C: every public-facing API route lives under this prefix,
// so future public channel adapters (this app's own future website
// features, never WhatsApp/email — those hit the Intake Engine through
// their own out-of-band transport, not this Next.js app's HTTP surface)
// don't each need their own PUBLIC_PATHS entry. Everything under here is
// untrusted-internet-facing by design; each route is responsible for its
// own input validation (see src/app/api/public/application-intake/route.ts).
const PUBLIC_API_PREFIX = "/api/public/";

/**
 * ============================================================================
 * MILESTONE 26B-26G.2 — RUTAS QUE SE AUTENTICAN SOLAS, SIN SESIÓN DE PERSONA
 * ============================================================================
 *
 * ESTO NO ES «PÚBLICO», y que sea una lista aparte con otro nombre es la mitad
 * del arreglo.
 *
 * El problema que resuelve: Vercel Cron invoca el cierre mensual SIN cookie de
 * Supabase —no es una persona, no tiene sesión— y solo con la cabecera
 * `Authorization: Bearer ${CRON_SECRET}`. El proxy la redirigía a /login con un
 * 307, y la documentación de Vercel dice que los cron jobs NO siguen
 * redirecciones y tratan un 3xx como respuesta final. Resultado: el trabajo
 * terminaba «correctamente» sin cerrar ningún mes, y en el registro solo se
 * veía un 307, que no parece un error. Un fallo silencioso.
 *
 * Lo que NO cambia: la ruta sigue protegida. La autoridad pasa a ser su
 * handler, que compara el secreto y falla cerrado si no existe. El proxy nunca
 * mira `Authorization` — no le corresponde decidir sobre el secreto, y tratar
 * un token de máquina como si fuera una sesión mezclaría dos mecanismos que
 * deben permanecer separados.
 *
 * ----------------------------------------------------------------------------
 * COMPARACIÓN EXACTA, NUNCA PREFIJO
 * ----------------------------------------------------------------------------
 * Con `startsWith` esta excepción también liberaría
 * `/api/cierres-mensuales/bootstrap` —que crea un cierre histórico atribuido a
 * una persona real y DEBE exigir sesión— y cualquier subruta que se añada
 * mañana. El portal público de arriba sí usa prefijo porque es un flujo de
 * varias páginas todas públicas; aquí es al revés: la excepción es una sola
 * dirección y el resto del árbol tiene que seguir cerrado.
 */
const MACHINE_AUTHENTICATED_PATHS = [
  // Cierre gerencial mensual automático. Ver src/app/api/cierres-mensuales.
  "/api/cierres-mensuales",
];

/** Rutas que no exigen nada a nadie. */
export function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.some((path) => pathname === path) ||
    pathname === PORTAL_PATH ||
    pathname.startsWith(`${PORTAL_PATH}/`) ||
    pathname.startsWith(PUBLIC_API_PREFIX)
  );
}

/**
 * Rutas que exigen un secreto que este módulo no conoce.
 *
 * Igualdad estricta, nunca prefijo. Ver la nota de arriba.
 */
export function isMachineAuthenticatedPath(pathname: string): boolean {
  return MACHINE_AUTHENTICATED_PATHS.some((path) => pathname === path);
}
