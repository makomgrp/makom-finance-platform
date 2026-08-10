import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Authenticated Server Client — the second leg of the three-client
 * architecture (see the Auth migration plan). Cookie-aware, publishable
 * key only: it never touches SUPABASE_SECRET_KEY, and RLS (not a secret
 * key) is what's meant to scope what it can read/write, once policies
 * exist. This is the client Server Components, Server Actions, and Route
 * Handlers use to act as the current signed-in user — never as an admin.
 *
 * Must be created fresh per request (per @supabase/ssr's own contract —
 * never cached/shared across requests the way the Browser and Admin
 * clients are), since it closes over that request's cookies.
 *
 * Nothing calls this yet — it's infrastructure only until getCurrentProfile()
 * (a later milestone) becomes its first real consumer.
 */
export async function createAuthenticatedServerClient(): Promise<SupabaseClient> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local."
    );
  }

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies can't be
          // written — safe to ignore because proxy.ts refreshes the
          // session on every request instead.
        }
      },
    },
  });
}
