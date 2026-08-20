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

function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.some((path) => pathname === path) ||
    pathname === PORTAL_PATH ||
    pathname.startsWith(`${PORTAL_PATH}/`) ||
    pathname.startsWith(PUBLIC_API_PREFIX)
  );
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
