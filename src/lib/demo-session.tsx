"use client";

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
