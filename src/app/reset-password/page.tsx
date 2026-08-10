import { Suspense } from "react";
import { ResetPasswordForm } from "./reset-password-form";

// ResetPasswordForm reads the `?error=1` query param via useSearchParams,
// which requires a Suspense boundary around it so the rest of the route
// can still prerender (see Next's useSearchParams docs).
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
