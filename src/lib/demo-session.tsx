"use client";

/**
 * TEMPORARY DEMO-SESSION COMPATIBILITY — status as of Milestone 4.
 *
 * As of Milestone 4, real Supabase Auth (via proxy.ts's coarse gate and
 * src/app/(app)/layout.tsx's authoritative getCurrentProfile() check) is
 * the ONLY thing deciding whether protected CRM content renders.
 * `isAuthenticated`, `isChecking`, `login`, and `logout` below no longer
 * have any bearing on that decision — nothing in the app calls `login()`
 * or reads `isAuthenticated`/`isChecking` anymore.
 *
 * `user` is the one field still consumed (by Topbar, Sidebar, MobileNav,
 * and the Settings > Profile section) — purely for display (name,
 * initials, role), still hardcoded to CURRENT_USER regardless of who's
 * really signed in. Replacing it with the real resolved profile is
 * Milestone 5's job, alongside removing this provider entirely.
 *
 * Left installed, not deleted, per the Milestone 4 scope — do not remove
 * before Milestone 5.
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
