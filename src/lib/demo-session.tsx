"use client";

/**
 * TEMPORARY DEMO-SESSION COMPATIBILITY — status as of Milestone 5A.
 *
 * Since Milestone 4, real Supabase Auth (via proxy.ts's coarse gate and
 * src/app/(app)/layout.tsx's authoritative getCurrentProfile() check) is
 * the ONLY thing deciding whether protected CRM content renders.
 * `isAuthenticated`, `isChecking`, `login`, and `logout` have had zero
 * consumers since Milestone 4 — nothing calls `login()`/`logout()` or
 * reads `isAuthenticated`/`isChecking` anywhere in the app.
 *
 * As of Milestone 5A, `user` ALSO has zero consumers: Topbar, Sidebar,
 * MobileNav, and Settings > Profile were migrated to the real resolved
 * profile via useCurrentProfile() (src/lib/auth/current-profile-context.tsx).
 * Chat identity and other write-attribution modules (dossier notes,
 * documents, alerts) still read CURRENT_USER directly from
 * src/lib/demo-data, not through this provider — that migration is a
 * later Milestone 5 step.
 *
 * This provider is therefore currently unused end-to-end (still mounted
 * in app-providers.tsx, with zero remaining useDemoSession() call sites
 * anywhere — confirmed by grep). Left installed, not deleted, and its
 * value shape unchanged — do not delete or expand its role before that's
 * explicitly scheduled.
 */
import {
  createContext,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { CURRENT_USER } from "@/lib/demo-data";
import type { User } from "@/types";

const STORAGE_KEY = "odl_loanflow_demo_session";

type SessionStatus = "checking" | "authenticated" | "unauthenticated";

const listeners = new Set<() => void>();

function notifyListeners() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): SessionStatus {
  return window.localStorage.getItem(STORAGE_KEY) === "true"
    ? "authenticated"
    : "unauthenticated";
}

function getServerSnapshot(): SessionStatus {
  return "checking";
}

interface DemoSessionContextValue {
  isAuthenticated: boolean;
  isChecking: boolean;
  user: User;
  login: () => void;
  logout: () => void;
}

const DemoSessionContext = createContext<DemoSessionContextValue | null>(null);

export function DemoSessionProvider({ children }: { children: ReactNode }) {
  const status = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const login = () => {
    window.localStorage.setItem(STORAGE_KEY, "true");
    notifyListeners();
  };

  const logout = () => {
    window.localStorage.removeItem(STORAGE_KEY);
    notifyListeners();
  };

  return (
    <DemoSessionContext.Provider
      value={{
        isAuthenticated: status === "authenticated",
        isChecking: status === "checking",
        user: CURRENT_USER,
        login,
        logout,
      }}
    >
      {children}
    </DemoSessionContext.Provider>
  );
}

export function useDemoSession(): DemoSessionContextValue {
  const context = useContext(DemoSessionContext);
  if (!context) {
    throw new Error("useDemoSession debe usarse dentro de DemoSessionProvider");
  }
  return context;
}
