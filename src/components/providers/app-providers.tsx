"use client";

import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { DemoSessionProvider } from "@/lib/demo-session";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <DemoSessionProvider>
      <TooltipProvider delay={200}>
        {children}
        <Toaster position="top-right" richColors />
      </TooltipProvider>
    </DemoSessionProvider>
  );
}
