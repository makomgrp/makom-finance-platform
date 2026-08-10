import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser Supabase client — one leg of the three-client architecture (see
 * the Auth migration plan). Publishable key only; never imports or sees
 * SUPABASE_SECRET_KEY. `createBrowserClient` from @supabase/ssr manages its
 * own singleton and cookie sync internally (auth session cookies, once Auth
 * exists), so this wrapper doesn't need to cache the instance itself.
 *
 * Used today for Realtime subscriptions only (see chat-view.tsx); reserved
 * for future authenticated, RLS-protected browser queries once Supabase
 * Auth is wired in — not used for that yet.
 */
export function getSupabaseClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local."
    );
  }

  return createBrowserClient(supabaseUrl, supabasePublishableKey);
}
