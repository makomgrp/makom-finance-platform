import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

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
 */
const PUBLIC_PATHS = ["/", "/login", "/forgot-password", "/reset-password", "/auth/callback"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((path) => pathname === path);
}

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

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
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
