import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isMachineAuthenticatedPath, isPublicPath } from "./route-access.ts";

/**
 * ============================================================================
 * MILESTONE 26B-26G.2 — LA FRONTERA EXTERIOR
 * ============================================================================
 *
 * El proxy decide qué peticiones llegan a rendirse a su handler y cuáles se
 * redirigen a /login antes de tocar nada. Es la primera puerta de todo el CRM,
 * y una excepción mal escrita aquí abre rutas administrativas enteras.
 *
 * 26B-26G.2 añadió UNA excepción: el cierre mensual automático, que lo invoca
 * Vercel Cron sin cookie de sesión. Estas pruebas defienden que esa excepción
 * sea exactamente una dirección y no un árbol.
 *
 * La función del proxy no se puede ejecutar aquí —arrastra `@supabase/ssr` y
 * el runtime de Next—, así que se prueban los PREDICADOS que toman la decisión,
 * que es donde vive la lógica, y se comprueba sobre el fuente que la decisión
 * los usa.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const ACCESS = read("./route-access.ts");
const PROXY = read("../../proxy.ts");

// ---------------------------------------------------------------------------
// A–C. LA RUTA DEL CRON PASA EL PROXY
// ---------------------------------------------------------------------------

test("la ruta del cron atraviesa el proxy sin sesión de persona", () => {
  // Sin esto, Vercel Cron recibe un 307 a /login, no sigue redirecciones y el
  // cierre mensual no ocurre nunca — en silencio.
  assert.equal(isMachineAuthenticatedPath("/api/cierres-mensuales"), true);
});

test("pero NO es pública: el proxy la deja pasar por otra puerta", () => {
  // La distinción importa. Público = no exige nada. Máquina = exige un secreto
  // que este proxy no conoce y no debe conocer.
  assert.equal(isPublicPath("/api/cierres-mensuales"), false);
});

test("el proxy nunca mira la cabecera Authorization", () => {
  // Comparar el secreto es trabajo del handler. Que el proxy tratara un Bearer
  // como equivalente a una sesión mezclaría dos mecanismos que deben
  // permanecer separados.
  for (const prohibido of ["authorization", "Bearer", "CRON_SECRET"]) {
    assert.ok(!PROXY.includes(prohibido), `el proxy no debe conocer ${prohibido}`);
    assert.ok(!ACCESS.includes(`${prohibido} =`), `route-access no debe leer ${prohibido}`);
  }
});

test("el handler del cron sigue siendo la autoridad y falla cerrado", () => {
  const route = read("../../app/api/cierres-mensuales/route.ts");
  assert.ok(route.includes("if (!cronSecret || authorization !== `Bearer ${cronSecret}`)"));
  assert.ok(route.includes("status: 401"));
  // Sin secreto configurado no se abre: no hay modo permisivo transitorio.
  assert.ok(!/process\.env\.NODE_ENV/.test(route));
});

// ---------------------------------------------------------------------------
// D–E. EL BOOTSTRAP SIGUE EXIGIENDO SESIÓN
// ---------------------------------------------------------------------------

test("el bootstrap NO hereda la excepción del cron", () => {
  // Crea un cierre histórico atribuido a una persona real. Un secreto de
  // máquina no puede conceder permisos de acción humana.
  assert.equal(isMachineAuthenticatedPath("/api/cierres-mensuales/bootstrap"), false);
  assert.equal(isPublicPath("/api/cierres-mensuales/bootstrap"), false);
});

test("el bootstrap conserva su propia puerta de capacidad", () => {
  const route = read("../../app/api/cierres-mensuales/bootstrap/route.ts");
  assert.ok(route.includes('requireCapability("analytics:view")'));
  assert.ok(route.includes("actorProfileId: auth.profile.id"));
  // Y no acepta ningún secreto como sustituto de la sesión.
  for (const prohibido of ["CRON_SECRET", "authorization", "Bearer"]) {
    assert.ok(!route.includes(prohibido), `el bootstrap no debe aceptar ${prohibido}`);
  }
});

// ---------------------------------------------------------------------------
// 9. NINGUNA SUBRUTA FUTURA HEREDA EL PASE
// ---------------------------------------------------------------------------

test("la excepción es una dirección exacta, no un árbol", () => {
  for (const subruta of [
    "/api/cierres-mensuales/bootstrap",
    "/api/cierres-mensuales/borrar",
    "/api/cierres-mensuales/cualquier-cosa",
    "/api/cierres-mensuales/2026-08",
    "/api/cierres-mensuales/",
    "/api/cierres-mensuales-admin",
    "/api/cierres-mensualesX",
  ]) {
    assert.equal(isMachineAuthenticatedPath(subruta), false, subruta);
  }
});

test("la comparación es por igualdad, no por prefijo", () => {
  // Con `startsWith` toda la familia quedaria abierta el dia que alguien
  // añada una subruta administrativa sin acordarse de esta lista.
  assert.ok(
    ACCESS.includes("MACHINE_AUTHENTICATED_PATHS.some((path) => pathname === path)"),
    "debe compararse con ==="
  );
  // Se aisla el CUERPO de la funcion en vez de mirar una ventana de caracteres:
  // `isPublicPath` vive justo debajo y usa `startsWith` con toda la razon.
  const cuerpo = ACCESS.slice(
    ACCESS.indexOf("export function isMachineAuthenticatedPath")
  );
  const hasta = cuerpo.indexOf("\n}");
  assert.ok(hasta > 0, "no se pudo aislar la funcion");
  assert.ok(
    !cuerpo.slice(0, hasta).includes("startsWith"),
    "la excepcion de maquina no debe usar startsWith"
  );
});

// ---------------------------------------------------------------------------
// 10. EL PROXY NO SE VOLVIÓ PERMISIVO
// ---------------------------------------------------------------------------

test("las rutas privadas del CRM siguen cerradas sin sesión", () => {
  for (const privada of [
    "/dashboard",
    "/clientes",
    "/solicitudes",
    "/expedientes/abc",
    "/documentos",
    "/configuracion",
    "/correo",
    "/chat",
    "/alertas",
    "/api/informe-ejecutivo",
    "/api/exportacion-detallada",
    "/api/correo/1",
    "/api/translate",
  ]) {
    assert.equal(isPublicPath(privada), false, privada);
    assert.equal(isMachineAuthenticatedPath(privada), false, privada);
  }
});

test("lo que ya era público lo sigue siendo", () => {
  for (const publica of [
    "/",
    "/login",
    "/forgot-password",
    "/reset-password",
    "/auth/callback",
    "/solicitud-clasico",
    "/solicitud",
    "/solicitud/continuar/token",
    "/api/public/application-intake",
  ]) {
    assert.equal(isPublicPath(publica), true, publica);
  }
});

test("«/solicitudes» del CRM no se cuela por el prefijo del portal público", () => {
  // Regresión histórica: el portal es /solicitud y el CRM /solicitudes.
  assert.equal(isPublicPath("/solicitudes"), false);
  assert.equal(isPublicPath("/solicitudes/abc"), false);
});

test("la redirección sigue existiendo y solo se salta por las dos excepciones", () => {
  assert.ok(
    PROXY.includes(
      "if (!user && !isPublicPath(pathname) && !isMachineAuthenticatedPath(pathname))"
    ),
    "la guarda debe seguir redirigiendo a todo lo demas"
  );
  assert.ok(PROXY.includes("NextResponse.redirect(loginUrl)"));
});

// ---------------------------------------------------------------------------
// 11. MILESTONE 2.2 — EL RECORDATORIO DE SEGUIMIENTO ES LA MISMA EXCEPCIÓN,
//     NO UNA SEGUNDA
// ---------------------------------------------------------------------------

test("la ruta del recordatorio de seguimiento atraviesa el proxy sin sesión de persona", () => {
  assert.equal(isMachineAuthenticatedPath("/api/recordatorios-seguimiento"), true);
});

test("pero tampoco es pública", () => {
  assert.equal(isPublicPath("/api/recordatorios-seguimiento"), false);
});

test("el handler del recordatorio también falla cerrado con el mismo patrón", () => {
  const route = read("../../app/api/recordatorios-seguimiento/route.ts");
  assert.ok(route.includes("if (!cronSecret || authorization !== `Bearer ${cronSecret}`)"));
  assert.ok(route.includes("status: 401"));
  assert.ok(!/process\.env\.NODE_ENV/.test(route));
});

// ---------------------------------------------------------------------------
// 12. MILESTONE 2.3 — LA SOLICITUD DE DOCUMENTOS ES LA MISMA EXCEPCIÓN,
//     NO UNA TERCERA
// ---------------------------------------------------------------------------

test("la ruta de solicitud de documentos atraviesa el proxy sin sesión de persona", () => {
  assert.equal(isMachineAuthenticatedPath("/api/recordatorios-documentos"), true);
});

test("pero tampoco es pública (documentos)", () => {
  assert.equal(isPublicPath("/api/recordatorios-documentos"), false);
});

test("el handler de solicitud de documentos también falla cerrado con el mismo patrón", () => {
  const route = read("../../app/api/recordatorios-documentos/route.ts");
  assert.ok(route.includes("if (!cronSecret || authorization !== `Bearer ${cronSecret}`)"));
  assert.ok(route.includes("status: 401"));
  assert.ok(!/process\.env\.NODE_ENV/.test(route));
});
