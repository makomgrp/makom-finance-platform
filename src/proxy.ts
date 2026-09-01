import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isMachineAuthenticatedPath, isPublicPath } from "@/lib/auth/route-access";

/**
 * Milestone 4: proxy.ts is the fast, coarse outer gate — not the
 * authoritative one. It keeps its Milestone 0 job (refreshing the Supabase
 * session cookie every request) and adds exactly one more: if a route
 * isn't public and there is clearly no valid Supabase Auth user, redirect
 * to /login before any rendering starts.
 *
 * Deliberately shallow on purpose:
 *   - no profiles query, no role/active check — that's a database read,
 *     and this is meant to stay a cheap, per-request cookie/JWT check.
 *   - no Admin Client, no SUPABASE_SECRET_KEY — publishable key only, same
 *     rule as every non-admin client in this app.
 *
 * The REAL, authoritative access-control boundary — session + linked
 * profile + active=true, all three — is src/app/(app)/layout.tsx's server
 * component check (getCurrentProfile()). This file only ever needs to
 * catch the common, cheap case ("no session at all") early; anything more
 * subtle (valid session, no/inactive profile) is the layout's job, not
 * this one's. See the Auth migration plan.
 *
 * MILESTONE 26B-26G.2 — qué rutas cruzan esta puerta sin sesión vive ahora en
 * `src/lib/auth/route-access.ts`. Se movió allí para poder ejercitarlo con
 * `node --test` ruta por ruta: aquí dentro no se podía importar sin arrastrar
 * Next entero, así que la única comprobación posible era leer el fuente y
 * confiar. La decisión y la redirección siguen siendo de este fichero.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() re-validates against the Auth server rather than trusting a
  // cookie's mere presence — same reasoning as getCurrentProfile()'s own
  // use of it. Also what triggers @supabase/ssr to refresh and rewrite the
  // cookie via setAll above when the access token is near expiry.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Las dos excepciones se comprueban por separado y significan cosas
  // distintas: una ruta pública no exige nada a nadie; una de máquina exige un
  // secreto que este proxy no conoce y no debe conocer — comprobarlo es trabajo
  // de su handler.
  if (!user && !isPublicPath(pathname) && !isMachineAuthenticatedPath(pathname)) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
