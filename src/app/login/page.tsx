import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/auth/get-current-profile";
import { LoginForm } from "./login-form";

/**
 * Milestone 4: if an already-authenticated, active CRM user visits
 * /login, send them straight to /dashboard — decided via the real
 * session/profile (getCurrentProfile()), not the demo-session flag. A
 * technically-valid Supabase session with no usable profile (e.g. an
 * inactive account) resolves to null here too, so it falls through to
 * rendering the login form rather than being redirected — the correct
 * "stay at /login" behavior for that case.
 */
export default async function LoginPage() {
  const profile = await getCurrentProfile();

  if (profile) {
    redirect("/dashboard");
  }

  return <LoginForm />;
}
