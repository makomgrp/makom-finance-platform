import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | undefined;

/**
 * Server-only Supabase client, authenticated with the project's secret key.
 * `import "server-only"` makes Next.js throw a build-time error if this
 * module is ever imported into a Client Component — the secret key must
 * never reach the browser.
 *
 * This client bypasses Row Level Security by design (that's what a secret
 * key is for), which is why it's restricted to the server.
 *
 * TODO(pre-auth): this is a temporary stand-in for real access control.
 * `profiles` has RLS enabled with zero client policies — nothing with the
 * publishable key can read it. Once Supabase Auth is implemented, normal
 * profile reads should move to the publishable-key client running under
 * the user's real session, scoped by RLS policies (see the migration plan
 * in supabase/migrations/20260808032630_add_legacy_id_and_auth_user_id_to_profiles.sql).
 * This secret-key client should then be reserved for genuinely admin-only
 * actions that need to bypass RLS on purpose — not for routine reads.
 */
export function getSupabaseServerClient(): SupabaseClient {
  if (client) return client;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl || !supabaseSecretKey) {
    throw new Error(
      "Supabase server client is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local."
    );
  }

  client = createClient(supabaseUrl, supabaseSecretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}
