import { NextResponse, type NextRequest } from "next/server";
import { createAuthenticatedServerClient } from "@/lib/supabase/server-authenticated";

/**
 * Supabase Auth's PKCE recovery/confirmation callback. Both the browser and
 * server Supabase clients in this app default to flowType: "pkce" (see
 * @supabase/ssr's createBrowserClient/createServerClient) — resetPasswordForEmail
 * "supports the PKCE flow" per its own docs, so the emailed link ultimately
 * redirects the browser here with a one-time `?code=` param, not a token in
 * the URL fragment. Exchanging that code for a session is the one thing
 * this route exists to do; a Route Handler (not a Server Component) is
 * required because it needs to write the session cookie.
 *
 * `next` controls where the user lands afterward — defaults to
 * /reset-password (the only flow that currently sends people through this
 * route), but is validated to a same-app relative path regardless, since
 * it comes from a URL query string.
 */
const DEFAULT_NEXT_PATH = "/reset-password";

function sanitizeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return DEFAULT_NEXT_PATH;
  }
  return value;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = sanitizeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createAuthenticatedServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
    console.error("[auth callback] exchangeCodeForSession failed:", error.message);
  }

  return NextResponse.redirect(`${origin}/reset-password?error=1`);
}
