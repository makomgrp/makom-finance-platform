import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Milestone 0 scope only: refreshes the Supabase Auth session cookie on
 * every request so a token doesn't silently expire mid-session later, once
 * real sessions exist. Deliberately does nothing else yet — no redirects,
 * no protected-route gating, no profile lookup (all later milestones, see
 * the Auth migration plan). Today no route actually has a session to
 * refresh, so this is a no-op in practice until Milestone 3 (real login)
 * exists; it's wired in now so the refresh behavior is already proven
 * before anything depends on it.
 *
 * Publishable key only — same rule as every non-admin client in this app.
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

  // Touching the session is what triggers @supabase/ssr to refresh and
  // rewrite the cookie via setAll above when the access token is near
  // expiry — this call's return value is unused on purpose.
  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
